import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'

const QUICK_TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const CONNECTED_MESSAGE = 'Registered tunnel connection'
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
const MAX_DIAGNOSTIC_BYTES = 8_192

export interface TradeAlertTunnelHandle {
  publicUrl: string
  webhookUrl: string
  isConnected(): boolean
  stop(): Promise<void>
}

interface TradeAlertTunnelOptions {
  localUrl: string
  webhookPath: string
  executable?: string
  configDirectory?: string
  startupTimeoutMs?: number
  logger?: {
    info(message: string): void
    warn(message: string): void
  }
}

export interface CloudflaredLogState {
  publicUrl?: string
  connected: boolean
}

export function parseCloudflaredLogLine(line: string): CloudflaredLogState {
  let message = line
  try {
    const parsed = JSON.parse(line) as { message?: unknown }
    if (typeof parsed.message === 'string') message = parsed.message
  } catch {
    // cloudflared can emit either JSON or plain text depending on version.
  }
  const publicUrl = message.match(QUICK_TUNNEL_URL_PATTERN)?.[0]
  return {
    ...(publicUrl ? { publicUrl } : {}),
    connected: message.includes(CONNECTED_MESSAGE),
  }
}

export async function startTradeAlertTunnel(
  options: TradeAlertTunnelOptions,
): Promise<TradeAlertTunnelHandle> {
  const logger = options.logger ?? { info: () => {}, warn: () => {} }
  const executable = options.executable ?? 'cloudflared'
  const args = ['tunnel']

  if (options.configDirectory) {
    await mkdir(options.configDirectory, { recursive: true })
    const configPath = path.join(options.configDirectory, 'cloudflared-quick-tunnel.yml')
    await writeFile(configPath, 'no-autoupdate: true\n', { mode: 0o600 })
    args.push('--config', configPath)
  }

  args.push(
    '--no-autoupdate',
    '--url', options.localUrl,
    '--loglevel', 'info',
    '--output', 'json',
  )

  const child = spawn(executable, args, {
    env: { ...process.env, NO_AUTOUPDATE: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return waitForTunnelReady(child, {
    webhookPath: options.webhookPath,
    startupTimeoutMs: options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    logger,
  })
}

async function waitForTunnelReady(
  child: ChildProcessByStdio<null, Readable, Readable>,
  options: {
    webhookPath: string
    startupTimeoutMs: number
    logger: { info(message: string): void; warn(message: string): void }
  },
): Promise<TradeAlertTunnelHandle> {
  let publicUrl: string | undefined
  let connected = false
  let stopped = false
  let diagnostic = ''
  let stdoutRemainder = ''
  let stderrRemainder = ''

  const ready = new Promise<TradeAlertTunnelHandle>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`Cloudflare tunnel did not become ready within ${options.startupTimeoutMs} ms.${diagnostic ? ` ${diagnostic}` : ''}`))
    }, options.startupTimeoutMs)

    const maybeResolve = () => {
      if (settled || !publicUrl || !connected) return
      settled = true
      clearTimeout(timer)
      const resolvedPublicUrl = publicUrl
      options.logger.info(`[trade-alert-tunnel] Public relay ready at ${resolvedPublicUrl}`)
      resolve({
        publicUrl: resolvedPublicUrl,
        webhookUrl: `${resolvedPublicUrl}${options.webhookPath}`,
        isConnected: () => connected && !stopped,
        stop: () => stopChild(child, () => {
          stopped = true
          connected = false
        }),
      })
    }

    const inspectChunk = (source: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const combined = (source === 'stdout' ? stdoutRemainder : stderrRemainder) + chunk.toString('utf8')
      const lines = combined.split(/\r?\n/)
      const remainder = lines.pop() ?? ''
      if (source === 'stdout') stdoutRemainder = remainder
      else stderrRemainder = remainder
      for (const line of lines) {
        if (!line.trim()) continue
        diagnostic = `${diagnostic}\n${line}`.slice(-MAX_DIAGNOSTIC_BYTES).trim()
        const state = parseCloudflaredLogLine(line)
        if (state.publicUrl) publicUrl = state.publicUrl
        if (state.connected) connected = true
        maybeResolve()
      }
    }

    child.stdout.on('data', inspectChunk('stdout'))
    child.stderr.on('data', inspectChunk('stderr'))
    child.once('error', (error) => {
      if (settled) {
        options.logger.warn(`[trade-alert-tunnel] Process error: ${error.message}`)
        connected = false
        return
      }
      settled = true
      clearTimeout(timer)
      reject(new Error(`Cloudflare tunnel could not start: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      stopped = true
      connected = false
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`Cloudflare tunnel exited before it was ready (${signal ?? `code ${code ?? 'unknown'}`}).${diagnostic ? ` ${diagnostic}` : ''}`))
    })
  })

  return ready
}

async function stopChild(
  child: ChildProcessByStdio<null, Readable, Readable>,
  markStopped: () => void,
): Promise<void> {
  markStopped()
  if (child.exitCode !== null || child.signalCode !== null) return

  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      child.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    if (!child.kill()) {
      clearTimeout(forceTimer)
      resolve()
    }
  })
}
