import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

import type { RpcRequest, RpcTransport } from '@trade-god/client'


export type SidecarProcessState = 'stopped' | 'starting' | 'ready' | 'stopping' | 'failed'

export interface JsonlSidecarProcessOptions {
  serviceLabel: string
  command: [string, ...string[]]
  cwd: string
  requestTimeoutMs: number
  maxLineBytes: number
  maxStderrBytes: number
  env?: Record<string, string>
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class JsonlSidecarRequestTimeoutError extends Error {
  constructor(serviceLabel: string) {
    super(`${serviceLabel} sidecar request timed out.`)
    this.name = 'JsonlSidecarRequestTimeoutError'
  }
}

export class JsonlSidecarExitedError extends Error {
  constructor(serviceLabel: string, code: number | null, signal: NodeJS.Signals | null) {
    super(`${serviceLabel} sidecar exited before responding (code=${String(code)}, signal=${String(signal)}).`)
    this.name = 'JsonlSidecarExitedError'
  }
}

export class JsonlSidecarProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonlSidecarProtocolError'
  }
}

export class JsonlSidecarProcess implements RpcTransport {
  private child: ChildProcessWithoutNullStreams | null = null
  private lifecycle: SidecarProcessState = 'stopped'
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly options: JsonlSidecarProcessOptions) {}

  request(request: RpcRequest, requestTimeoutMs = this.options.requestTimeoutMs): Promise<unknown> {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new TypeError('requestTimeoutMs must be a positive finite number.')
    }
    const child = this.ensureStarted()
    const id = String(request.id)
    if (this.pending.has(id)) {
      throw new JsonlSidecarProtocolError(`Duplicate pending request id: ${id}`)
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new JsonlSidecarRequestTimeoutError(this.options.serviceLabel))
      }, requestTimeoutMs)
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

  status(): { state: SidecarProcessState; pid?: number; stderr: string } {
    return {
      state: this.lifecycle,
      ...(this.child?.pid ? { pid: this.child.pid } : {}),
      stderr: this.stderrBuffer,
    }
  }

  async stop(shutdownRequest?: RpcRequest): Promise<void> {
    const child = this.child
    if (!child) {
      this.lifecycle = 'stopped'
      return
    }

    this.lifecycle = 'stopping'
    if (shutdownRequest && child.exitCode === null && child.signalCode === null) {
      try {
        await this.request(shutdownRequest)
      } catch {
        child.kill('SIGTERM')
      }
    } else if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
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

    this.rejectAll(new JsonlSidecarExitedError(this.options.serviceLabel, child.exitCode, child.signalCode))
    this.child = null
    this.lifecycle = 'stopped'
    this.stdoutBuffer = ''
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && (this.lifecycle === 'ready' || this.lifecycle === 'stopping')) return this.child

    this.lifecycle = 'starting'
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
    const [command, ...args] = this.options.command
    const child = spawn(command, args, {
      cwd: this.options.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
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
      this.rejectAll(new JsonlSidecarExitedError(this.options.serviceLabel, code, signal))
    })
    return child
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (Buffer.byteLength(line) > this.options.maxLineBytes) {
        this.failProtocol(`${this.options.serviceLabel} sidecar emitted an oversized protocol line.`)
        return
      }
      if (line.trim()) this.consumeLine(line)
      if (this.lifecycle === 'failed') return
      newline = this.stdoutBuffer.indexOf('\n')
    }
    if (Buffer.byteLength(this.stdoutBuffer) > this.options.maxLineBytes) {
      this.failProtocol(`${this.options.serviceLabel} sidecar emitted an oversized protocol line.`)
    }
  }

  private consumeLine(line: string): void {
    let response: unknown
    try {
      response = JSON.parse(line)
    } catch {
      this.failProtocol(`${this.options.serviceLabel} sidecar emitted malformed JSON.`)
      return
    }
    if (!response || typeof response !== 'object' || !Object.hasOwn(response, 'id')) {
      this.failProtocol(`${this.options.serviceLabel} sidecar response is missing an id.`)
      return
    }
    const id = String((response as Record<string, unknown>).id)
    const pending = this.pending.get(id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(response)
  }

  private failProtocol(message: string): void {
    const error = new JsonlSidecarProtocolError(message)
    this.rejectAll(error)
    this.child?.kill('SIGKILL')
    this.lifecycle = 'failed'
    this.stdoutBuffer = ''
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
