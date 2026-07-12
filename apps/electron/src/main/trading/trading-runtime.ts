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

interface HostConfigOptions {
  isPackaged: boolean
  appPath: string
  resourcesPath: string
  cwd: string
  homeDir: string
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
}

export function resolveTradeGodHostConfig(options: HostConfigOptions): ResolveLaunchOptions {
  const bunBinary = options.platform === 'win32' ? 'bun.exe' : 'bun'
  if (options.isPackaged) {
    return {
      rootCandidates: [options.appPath],
      runtimeExecutable: path.join(options.resourcesPath, 'app', 'vendor', 'bun', bunBinary),
    }
  }

  return {
    rootCandidates: [
      options.env.RUNNEROS_ROOT,
      options.cwd,
      options.appPath,
      path.join(options.appPath, '..', '..'),
    ].filter((candidate): candidate is string => Boolean(candidate)),
    runtimeExecutable: options.env.TRADE_GOD_RUNTIME_EXECUTABLE
      || options.env.CRAFT_BUN
      || path.join(options.homeDir, '.bun', 'bin', bunBinary),
  }
}

export function resolveOrderFlowLaunch(options: ResolveLaunchOptions): {
  command: [string, string]
  cwd: string
  mode: 'development' | 'packaged'
} {
  for (const root of options.rootCandidates) {
    const packagedEntrypoint = path.join(root, 'dist', 'trade-god', 'order-flow-engine.mjs')
    if (existsSync(packagedEntrypoint)) {
      return { command: [options.runtimeExecutable, packagedEntrypoint], cwd: root, mode: 'packaged' }
    }
    const entrypoint = path.join(root, 'sidecars', 'order-flow-engine', 'src', 'cli.ts')
    if (existsSync(entrypoint)) {
      return { command: [options.runtimeExecutable, entrypoint], cwd: root, mode: 'development' }
    }
  }
  throw new Error('Order Flow sidecar entrypoint was not found (source or packaged bundle) in the configured RunnerOS roots.')
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
