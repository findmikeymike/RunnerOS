import { describe, expect, test } from 'bun:test'

import { registerTradingIpc, TRADE_GOD_IPC, type TradingIpcManager } from '../trading-ipc.ts'

class FakeIpcMain {
  readonly handlers = new Map<string, (...args: any[]) => any>()
  readonly removed: string[] = []
  handle(channel: string, handler: (...args: any[]) => any): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel); this.removed.push(channel) }
}

describe('Trade God IPC registration', () => {
  test('registers only health, fixture-analysis, and cancellation handlers', async () => {
    const ipc = new FakeIpcMain()
    const calls: string[] = []
    const manager: TradingIpcManager = {
      health: async () => { calls.push('health'); return { state: 'ready' } as any },
      analyzeFixture: async (input) => { calls.push(`analyze:${input.timeoutMs}`); return { artifact_id: 'artifact-ipc' } as any },
      cancelAnalysis: async (id) => { calls.push(`cancel:${id}`); return { cancellation_id: id, state: 'canceled' } as any },
      stop: async () => { calls.push('stop') },
    }

    registerTradingIpc(ipc, manager)

    expect([...ipc.handlers.keys()]).toEqual([TRADE_GOD_IPC.HEALTH, TRADE_GOD_IPC.ANALYZE_FIXTURE, TRADE_GOD_IPC.CANCEL_ANALYSIS])
    expect(await ipc.handlers.get(TRADE_GOD_IPC.HEALTH)!({})).toEqual({ state: 'ready' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.ANALYZE_FIXTURE)!({}, { timeoutMs: 500 })).toEqual({ artifact_id: 'artifact-ipc' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.CANCEL_ANALYSIS)!({}, 'cancel-ipc')).toEqual({ cancellation_id: 'cancel-ipc', state: 'canceled' })
    expect(calls).toEqual(['health', 'analyze:500', 'cancel:cancel-ipc'])
  })

  test('disposal removes handlers and stops the manager once', async () => {
    const ipc = new FakeIpcMain()
    let stops = 0
    const manager: TradingIpcManager = {
      health: async () => ({}) as any,
      analyzeFixture: async () => ({}) as any,
      cancelAnalysis: async () => ({}) as any,
      stop: async () => { stops += 1 },
    }
    const dispose = registerTradingIpc(ipc, manager)

    await dispose()
    await dispose()

    expect(ipc.removed).toEqual([TRADE_GOD_IPC.HEALTH, TRADE_GOD_IPC.ANALYZE_FIXTURE, TRADE_GOD_IPC.CANCEL_ANALYSIS])
    expect(stops).toBe(1)
  })
})
