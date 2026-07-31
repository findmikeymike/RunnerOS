import { describe, expect, test } from 'bun:test'

import { registerTradingIpc, TRADE_GOD_IPC, type TradingIpcManager } from '../trading-ipc.ts'

class FakeIpcMain {
  readonly handlers = new Map<string, (...args: any[]) => any>()
  readonly removed: string[] = []
  handle(channel: string, handler: (...args: any[]) => any): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel); this.removed.push(channel) }
}

describe('Trade God IPC registration', () => {
  test('registers analysis and alert handlers', async () => {
    const ipc = new FakeIpcMain()
    const calls: string[] = []
    const manager: TradingIpcManager = {
      health: async () => { calls.push('health'); return { state: 'ready' } as any },
      analyzeFixture: async (input) => { calls.push(`analyze:${input.timeoutMs}`); return { artifact_id: 'artifact-ipc' } as any },
      interpretFixture: async (input) => { calls.push(`interpret:${input.assignment.horizon}`); return { interpretation_id: 'interpretation-ipc' } as any },
      cancelAnalysis: async (id) => { calls.push(`cancel:${id}`); return { cancellation_id: id, state: 'canceled' } as any },
      listAlerts: async (limit) => { calls.push(`alerts:${limit}`); return [{ id: 'tv-alert' }] as any },
      acknowledgeAlert: async (id) => { calls.push(`ack:${id}`); return { id, status: 'acknowledged' } as any },
      getAlertIngestionStatus: async () => { calls.push('alert-status'); return { state: 'ready' } as any },
      getAlertWebhookSetup: async () => { calls.push('alert-setup'); return { local_url: 'http://127.0.0.1:9102' } as any },
      getIbkrGatewayHealth: async (environment) => {
        calls.push(`ibkr:${environment}`)
        return { state: 'ready', environment } as any
      },
      getSyntheticChartFixture: async (input) => {
        calls.push(`chart:${input.symbol}:${input.timeframe}:${input.sessionMode}`)
        return { snapshot_id: 'snapshot-chart-ipc' } as any
      },
      stop: async () => { calls.push('stop') },
    }

    registerTradingIpc(ipc, manager)

    expect([...ipc.handlers.keys()]).toEqual([
      TRADE_GOD_IPC.HEALTH,
      TRADE_GOD_IPC.ANALYZE_FIXTURE,
      TRADE_GOD_IPC.INTERPRET_FIXTURE,
      TRADE_GOD_IPC.CANCEL_ANALYSIS,
      TRADE_GOD_IPC.LIST_ALERTS,
      TRADE_GOD_IPC.ACKNOWLEDGE_ALERT,
      TRADE_GOD_IPC.ALERT_INGESTION_STATUS,
      TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP,
      TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH,
      TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE,
    ])
    expect(await ipc.handlers.get(TRADE_GOD_IPC.HEALTH)!({})).toEqual({ state: 'ready' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.ANALYZE_FIXTURE)!({}, { timeoutMs: 500 })).toEqual({ artifact_id: 'artifact-ipc' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.INTERPRET_FIXTURE)!({}, { assignment: { horizon: 'immediate' } })).toEqual({ interpretation_id: 'interpretation-ipc' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.CANCEL_ANALYSIS)!({}, 'cancel-ipc')).toEqual({ cancellation_id: 'cancel-ipc', state: 'canceled' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.LIST_ALERTS)!({}, 20)).toEqual([{ id: 'tv-alert' }])
    expect(await ipc.handlers.get(TRADE_GOD_IPC.ACKNOWLEDGE_ALERT)!({}, 'tv-alert')).toEqual({ id: 'tv-alert', status: 'acknowledged' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.ALERT_INGESTION_STATUS)!({})).toEqual({ state: 'ready' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP)!({})).toEqual({ local_url: 'http://127.0.0.1:9102' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH)!({}, 'paper')).toEqual({
      state: 'ready', environment: 'paper',
    })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE)!({}, {
      symbol: 'ES', timeframe: '5m', sessionMode: 'RTH',
    })).toEqual({ snapshot_id: 'snapshot-chart-ipc' })
    expect(calls).toEqual([
      'health',
      'analyze:500',
      'interpret:immediate',
      'cancel:cancel-ipc',
      'alerts:20',
      'ack:tv-alert',
      'alert-status',
      'alert-setup',
      'ibkr:paper',
      'chart:ES:5m:RTH',
    ])
  })

  test('disposal removes handlers and stops the manager once', async () => {
    const ipc = new FakeIpcMain()
    let stops = 0
    const manager: TradingIpcManager = {
      health: async () => ({}) as any,
      analyzeFixture: async () => ({}) as any,
      cancelAnalysis: async () => ({}) as any,
      getSyntheticChartFixture: async () => null,
      stop: async () => { stops += 1 },
    }
    const dispose = registerTradingIpc(ipc, manager)

    await dispose()
    await dispose()

    expect(ipc.removed).toEqual([
      TRADE_GOD_IPC.HEALTH,
      TRADE_GOD_IPC.ANALYZE_FIXTURE,
      TRADE_GOD_IPC.INTERPRET_FIXTURE,
      TRADE_GOD_IPC.CANCEL_ANALYSIS,
      TRADE_GOD_IPC.LIST_ALERTS,
      TRADE_GOD_IPC.ACKNOWLEDGE_ALERT,
      TRADE_GOD_IPC.ALERT_INGESTION_STATUS,
      TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP,
      TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH,
      TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE,
    ])
    expect(stops).toBe(1)
  })
})
