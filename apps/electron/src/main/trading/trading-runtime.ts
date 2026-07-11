import { existsSync } from 'node:fs'
import path from 'node:path'

import { OrderFlowSidecarManager } from './order-flow-sidecar-manager.ts'
import { registerTradingIpc, type IpcMainLike } from './trading-ipc.ts'

interface ResolveLaunchOptions {
  rootCandidates: string[]
  runtimeExecutable: string
}

interface RuntimeOptions extends ResolveLaunchOptions {
  ipcMain: IpcMainLike
  now: () => string
}

export function resolveOrderFlowLaunch(options: ResolveLaunchOptions): {
  command: [string, string]
  cwd: string
} {
  for (const root of options.rootCandidates) {
    const entrypoint = path.join(root, 'sidecars', 'order-flow-engine', 'src', 'cli.ts')
    if (existsSync(entrypoint)) return { command: [options.runtimeExecutable, entrypoint], cwd: root }
  }
  throw new Error('Order Flow sidecar entrypoint was not found in the configured RunnerOS roots.')
}

export function createTradeGodRuntime(options: RuntimeOptions): {
  manager: OrderFlowSidecarManager
  dispose: () => Promise<void>
} {
  const launch = resolveOrderFlowLaunch(options)
  const manager = new OrderFlowSidecarManager({
    command: launch.command,
    cwd: launch.cwd,
    requestTimeoutMs: 5_000,
    maxLineBytes: 1_000_000,
    maxStderrBytes: 16_384,
    env: { TRADE_GOD_SIDECAR_INSTANCE_ID: 'electron-order-flow-1' },
    now: options.now,
  })
  return { manager, dispose: registerTradingIpc(options.ipcMain, manager) }
}
