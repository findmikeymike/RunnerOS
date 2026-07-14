import { expect, test } from 'bun:test'

import { TRADE_GOD_IPC } from '../trading-ipc.ts'
import { createTradingPreloadApi } from '../trading-preload.ts'

test('preload adapter invokes only the three local Trade God channels', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const api = createTradingPreloadApi(async (channel, ...args) => {
    calls.push({ channel, args })
    return channel === TRADE_GOD_IPC.HEALTH ? { state: 'ready' } : { artifact_id: 'artifact-preload' }
  })
  const input = { timeoutMs: 500 } as any

  expect(await api.getTradeGodHealth() as any).toEqual({ state: 'ready' })
  expect(await api.analyzeTradeGodFixture(input) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.cancelTradeGodAnalysis('cancel-preload') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(calls).toEqual([
    { channel: TRADE_GOD_IPC.HEALTH, args: [] },
    { channel: TRADE_GOD_IPC.ANALYZE_FIXTURE, args: [input] },
    { channel: TRADE_GOD_IPC.CANCEL_ANALYSIS, args: ['cancel-preload'] },
  ])
})
