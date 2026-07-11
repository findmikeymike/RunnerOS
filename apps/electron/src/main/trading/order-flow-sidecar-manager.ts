import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import {
  TradingClient,
  type AnalyzeFixtureInput,
  type RpcRequest,
  type RpcTransport,
} from '@trade-god/client'
import { PROTOCOL_VERSION, type AnalysisArtifact, type HealthResponse } from '@trade-god/contracts'

type ManagerState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'

interface ManagerOptions {
  command: [string, ...string[]]
  cwd: string
  requestTimeoutMs: number
  maxLineBytes: number
  maxStderrBytes: number
  env?: Record<string, string>
  now: () => string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SidecarRequestTimeoutError extends Error {
  constructor() {
    super('Order Flow sidecar request timed out.')
    this.name = 'SidecarRequestTimeoutError'
  }
}

export class SidecarExitedError extends Error {
  constructor(code: number | null, signal: NodeJS.Signals | null) {
    super(`Order Flow sidecar exited before responding (code=${String(code)}, signal=${String(signal)}).`)
    this.name = 'SidecarExitedError'
  }
}

export class SidecarProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SidecarProtocolError'
  }
}

export class OrderFlowSidecarManager implements RpcTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private lifecycle: ManagerState = 'stopped'
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private sequence = 0
  private readonly pending = new Map<string, PendingRequest>()
  private readonly client: TradingClient

  constructor(private readonly options: ManagerOptions) {
    this.client = new TradingClient({
      transport: this,
      now: options.now,
      nextId: (prefix) => this.nextId(prefix),
      producer: { name: 'trade-god-electron', version: '0.1.0', instance_id: 'electron-main' },
    })
  }

  health(): Promise<HealthResponse> {
    return this.client.health()
  }

  analyzeFixture(input: AnalyzeFixtureInput): Promise<AnalysisArtifact> {
    return this.client.analyzeFixture(input)
  }

  async request(request: RpcRequest): Promise<unknown> {
    const child = this.ensureStarted()
    const id = String(request.id)
    if (this.pending.has(id)) throw new SidecarProtocolError(`Duplicate pending request id: ${id}`)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new SidecarRequestTimeoutError())
      }, this.options.requestTimeoutMs)
      this.pending.set(id, { resolve, reject, timer })

      child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  status(): { state: ManagerState; pid?: number; stderr: string } {
    return {
      state: this.lifecycle,
      ...(this.child?.pid ? { pid: this.child.pid } : {}),
      stderr: this.stderrBuffer,
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      this.lifecycle = 'stopped'
      return
    }

    this.lifecycle = 'stopping'
    if (child.exitCode === null && child.signalCode === null) {
      try {
        const traceId = this.nextId('trace')
        await this.request({
          jsonrpc: '2.0',
          id: this.nextId('rpc'),
          method: 'trade.shutdown',
          params: {
            meta: {
              schema_version: PROTOCOL_VERSION,
              trace_id: traceId,
              created_at: this.options.now(),
              producer: { name: 'trade-god-electron', version: '0.1.0', instance_id: 'electron-main' },
            },
          },
        })
      } catch {
        child.kill('SIGTERM')
      }
    }

    if (child.exitCode === null && child.signalCode === null) {
      await Promise.race([
        new Promise<void>((resolve) => child.once('close', () => resolve())),
        new Promise<void>((resolve) => setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, Math.min(this.options.requestTimeoutMs, 250))),
      ])
    }

    this.rejectAll(new SidecarExitedError(child.exitCode, child.signalCode))
    this.child = null
    this.lifecycle = 'stopped'
    this.stdoutBuffer = ''
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && (this.lifecycle === 'ready' || this.lifecycle === 'stopping')) return this.child

    this.lifecycle = 'starting'
    const [command, ...args] = this.options.command
    const child = spawn(command, args, {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ELECTRON_RUN_AS_NODE: '1',
        ...this.options.env,
      },
    })
    this.child = child
    this.lifecycle = 'ready'

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-this.options.maxStderrBytes)
    })
    child.on('error', (error) => {
      this.lifecycle = 'failed'
      this.rejectAll(error)
    })
    child.on('close', (code, signal) => {
      if (this.lifecycle !== 'stopping' && this.lifecycle !== 'stopped') this.lifecycle = 'failed'
      this.rejectAll(new SidecarExitedError(code, signal))
    })

    return child
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    if (Buffer.byteLength(this.stdoutBuffer) > this.options.maxLineBytes) {
      const error = new SidecarProtocolError('Order Flow sidecar emitted an oversized protocol line.')
      this.rejectAll(error)
      this.child?.kill('SIGKILL')
      this.lifecycle = 'failed'
      this.stdoutBuffer = ''
      return
    }

    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line.trim()) this.consumeLine(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private consumeLine(line: string): void {
    let response: unknown
    try {
      response = JSON.parse(line)
    } catch {
      this.rejectAll(new SidecarProtocolError('Order Flow sidecar emitted malformed JSON.'))
      return
    }
    if (!response || typeof response !== 'object' || !Object.hasOwn(response, 'id')) {
      this.rejectAll(new SidecarProtocolError('Order Flow sidecar response is missing an id.'))
      return
    }
    const id = String((response as Record<string, unknown>).id)
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(response)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}
