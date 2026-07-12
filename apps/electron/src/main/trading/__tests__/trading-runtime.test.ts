import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { TRADE_GOD_IPC } from '../trading-ipc.ts'
import { createTradeGodRuntime, resolveOrderFlowLaunch, resolveTradeGodHostConfig } from '../trading-runtime.ts'

class FakeIpcMain {
  readonly handlers = new Map<string, (...args: any[]) => any>()
  handle(channel: string, handler: (...args: any[]) => any): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')

test('resolves and runs the development sidecar from an explicit RunnerOS root', async () => {
  const launch = resolveOrderFlowLaunch({ rootCandidates: [repoRoot], runtimeExecutable: process.execPath })
  expect(launch.command).toEqual([process.execPath, path.join(repoRoot, 'sidecars/order-flow-engine/src/cli.ts')])

  const ipc = new FakeIpcMain()
  const runtime = createTradeGodRuntime({
    ipcMain: ipc,
    rootCandidates: [repoRoot],
    runtimeExecutable: process.execPath,
    now: () => new Date().toISOString(),
  })

  const health = await ipc.handlers.get(TRADE_GOD_IPC.HEALTH)!({})
  expect(health).toMatchObject({ state: 'ready' })

  await runtime.dispose()
  expect(ipc.handlers.size).toBe(0)
})

test('fails clearly when no sidecar entrypoint exists', () => {
  expect(() => resolveOrderFlowLaunch({ rootCandidates: ['/definitely/missing'], runtimeExecutable: process.execPath }))
    .toThrow('Order Flow sidecar entrypoint was not found')
})

test('resolves the packaged sidecar bundle before source candidates', () => {
  const packagedRoot = mkdtempSync(path.join(tmpdir(), 'trade-god-packaged-'))
  const packagedEntrypoint = path.join(packagedRoot, 'dist', 'trade-god', 'order-flow-engine.mjs')
  mkdirSync(path.dirname(packagedEntrypoint), { recursive: true })
  writeFileSync(packagedEntrypoint, '// packaged fixture')

  try {
    const launch = resolveOrderFlowLaunch({
      rootCandidates: [packagedRoot, repoRoot],
      runtimeExecutable: '/packaged/vendor/bun/bun',
    })

    expect(launch).toEqual({
      command: ['/packaged/vendor/bun/bun', packagedEntrypoint],
      cwd: packagedRoot,
      mode: 'packaged',
    })
  } finally {
    rmSync(packagedRoot, { recursive: true, force: true })
  }
})

test('uses only packaged app assets and bundled Bun in packaged mode', () => {
  expect(resolveTradeGodHostConfig({
    isPackaged: true,
    appPath: '/Applications/Runner.app/Contents/Resources/app',
    resourcesPath: '/Applications/Runner.app/Contents/Resources',
    cwd: '/untrusted/launch-directory',
    homeDir: '/Users/tester',
    env: {},
    platform: 'darwin',
  })).toEqual({
    rootCandidates: ['/Applications/Runner.app/Contents/Resources/app'],
    runtimeExecutable: '/Applications/Runner.app/Contents/Resources/app/vendor/bun/bun',
  })
})
