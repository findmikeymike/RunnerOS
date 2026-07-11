import { expect, test } from 'bun:test'
import path from 'node:path'

import { TRADE_GOD_IPC } from '../trading-ipc.ts'
import { createTradeGodRuntime, resolveOrderFlowLaunch } from '../trading-runtime.ts'

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
