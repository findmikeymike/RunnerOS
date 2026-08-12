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
      listTradingConnections: async () => { calls.push('connections:list'); return [] },
      saveTradingConnection: async () => {
        calls.push('connections:save')
        return { connection: { connection_id: 'connection-1' } } as any
      },
      removeTradingConnection: async (id) => { calls.push(`connections:remove:${id}`); return true },
      openTradingConnectionLogin: async (id) => {
        calls.push(`connections:login:${id}`)
        return { browser_instance_id: 'browser-1', session_ref: 'session-1' }
      },
      confirmTradingConnectionLogin: async (id) => {
        calls.push(`connections:confirm-login:${id}`)
        return { browser_login_confirmed: true } as any
      },
      verifyTradingConnection: async (id) => {
        calls.push(`connections:verify:${id}`)
        return { provider_read_verified: true } as any
      },
      applyTradingConnectionCertification: async (id, certificationId) => {
        calls.push(`connections:certify:${id}:${certificationId}`)
        return { connection: { connection_id: id, state: 'ready' } } as any
      },
      setTradingConnectionPaperExecution: async (id, enabled) => {
        calls.push(`connections:paper:${id}:${enabled}`)
        return { connection: { connection_id: id, enabled } } as any
      },
      listTradingSignalRoutes: async () => { calls.push('routes:list'); return [] },
      saveTradingSignalRoute: async (route, expectedPreviousConnectionId) => {
        calls.push(`routes:save:${expectedPreviousConnectionId ?? 'new'}`)
        return route
      },
      removeTradingSignalRoute: async (id) => { calls.push(`routes:remove:${id}`); return true },
      listMirrorGroups: async () => { calls.push('mirror-groups:list'); return [] },
      saveMirrorGroup: async (input) => {
        calls.push('mirror-groups:save')
        return { mirror_group_id: input.mirror_group_id } as any
      },
      getDiscoTraderWebhookSecretStatus: async () => {
        calls.push('discotrader-secret:status')
        return { configured: true }
      },
      saveDiscoTraderWebhookSecret: async () => {
        calls.push('discotrader-secret:save')
        return { configured: true }
      },
      getExecutionControl: async () => {
        calls.push('execution-control:get')
        return {
          global_kill: false,
          connection_kills: [],
          source_kills: [],
          updated_at: '2026-08-10T00:00:00.000Z',
          provider_adapters_attached: false,
        }
      },
      setGlobalExecutionKill: async (enabled) => {
        calls.push(`execution-control:set:${enabled}`)
        return { global_kill: enabled }
      },
      setConnectionExecutionKill: async (connectionId, enabled) => {
        calls.push(`execution-control:set-connection:${connectionId}:${enabled}`)
        return { connection_id: connectionId, killed: enabled }
      },
      preparePaperActivation: async () => {
        calls.push('paper-activation:prepare')
        return { review_id: 'review-1' } as any
      },
      commitPaperActivation: async (reviewId, reviewChecksum) => {
        calls.push(`paper-activation:commit:${reviewId}:${reviewChecksum}`)
        return { status: 'released' } as any
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
      TRADE_GOD_IPC.LIST_CONNECTIONS,
      TRADE_GOD_IPC.LIST_EXECUTIONS,
      TRADE_GOD_IPC.SAVE_CONNECTION,
      TRADE_GOD_IPC.REMOVE_CONNECTION,
      TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN,
      TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN,
      TRADE_GOD_IPC.VERIFY_CONNECTION,
      TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION,
      TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION,
      TRADE_GOD_IPC.LIST_SIGNAL_ROUTES,
      TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE,
      TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE,
      TRADE_GOD_IPC.LIST_MIRROR_GROUPS,
      TRADE_GOD_IPC.SAVE_MIRROR_GROUP,
      TRADE_GOD_IPC.DISCOTRADER_WEBHOOK_SECRET_STATUS,
      TRADE_GOD_IPC.SAVE_DISCOTRADER_WEBHOOK_SECRET,
      TRADE_GOD_IPC.EXECUTION_CONTROL,
      TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL,
      TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL,
      TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION,
      TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION,
      TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS,
      TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION,
      TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION,
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
    expect(await ipc.handlers.get(TRADE_GOD_IPC.LIST_CONNECTIONS)!({})).toEqual([])
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SAVE_CONNECTION)!({}, { connection: {} }))
      .toMatchObject({ connection: { connection_id: 'connection-1' } })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.REMOVE_CONNECTION)!({}, 'connection-1')).toBe(true)
    expect(await ipc.handlers.get(TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN)!({}, 'connection-1'))
      .toEqual({ browser_instance_id: 'browser-1', session_ref: 'session-1' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN)!({}, 'connection-1'))
      .toEqual({ browser_login_confirmed: true })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.VERIFY_CONNECTION)!({}, 'connection-1'))
      .toEqual({ provider_read_verified: true })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION)!(
      {},
      'connection-1',
      'certification-1',
    )).toMatchObject({ connection: { state: 'ready' } })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION)!(
      {},
      'connection-1',
      true,
    )).toMatchObject({ connection: { enabled: true } })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.LIST_SIGNAL_ROUTES)!({})).toEqual([])
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE)!(
      {},
      { route_id: 'route-1' },
      'connection-old',
    )).toEqual({ route_id: 'route-1' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE)!({}, 'route-1')).toBe(true)
    expect(await ipc.handlers.get(TRADE_GOD_IPC.LIST_MIRROR_GROUPS)!({})).toEqual([])
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SAVE_MIRROR_GROUP)!({}, {
      mirror_group_id: 'mirror-group-one',
    })).toEqual({ mirror_group_id: 'mirror-group-one' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.DISCOTRADER_WEBHOOK_SECRET_STATUS)!({}))
      .toEqual({ configured: true })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SAVE_DISCOTRADER_WEBHOOK_SECRET)!(
      {},
      'a'.repeat(32),
    )).toEqual({ configured: true })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.EXECUTION_CONTROL)!({})).toMatchObject({
      global_kill: false,
    })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL)!({}, true))
      .toEqual({ global_kill: true })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION)!({}))
      .toEqual({ review_id: 'review-1' })
    expect(await ipc.handlers.get(TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION)!({}, 'review-1', 'a'.repeat(64)))
      .toEqual({ status: 'released' })
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
      'connections:list',
      'connections:save',
      'connections:remove:connection-1',
      'connections:login:connection-1',
      'connections:confirm-login:connection-1',
      'connections:verify:connection-1',
      'connections:certify:connection-1:certification-1',
      'connections:paper:connection-1:true',
      'routes:list',
      'routes:save:connection-old',
      'routes:remove:route-1',
      'mirror-groups:list',
      'mirror-groups:save',
      'discotrader-secret:status',
      'discotrader-secret:save',
      'execution-control:get',
      'execution-control:set:true',
      'paper-activation:prepare',
      `paper-activation:commit:review-1:${'a'.repeat(64)}`,
    ])
  })

  test('rejects invalid route reassignment confirmation before reaching the manager', () => {
    const ipc = new FakeIpcMain()
    const manager: TradingIpcManager = {
      health: async () => ({}) as any,
      analyzeFixture: async () => ({}) as any,
      cancelAnalysis: async () => ({}) as any,
      getSyntheticChartFixture: async () => null,
      saveTradingSignalRoute: async (route) => route,
      stop: async () => {},
    }
    registerTradingIpc(ipc, manager)
    expect(() => ipc.handlers.get(TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE)!({}, {}, 42))
      .toThrow('Expected previous target key is invalid')
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
      TRADE_GOD_IPC.LIST_CONNECTIONS,
      TRADE_GOD_IPC.LIST_EXECUTIONS,
      TRADE_GOD_IPC.SAVE_CONNECTION,
      TRADE_GOD_IPC.REMOVE_CONNECTION,
      TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN,
      TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN,
      TRADE_GOD_IPC.VERIFY_CONNECTION,
      TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION,
      TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION,
      TRADE_GOD_IPC.LIST_SIGNAL_ROUTES,
      TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE,
      TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE,
      TRADE_GOD_IPC.LIST_MIRROR_GROUPS,
      TRADE_GOD_IPC.SAVE_MIRROR_GROUP,
      TRADE_GOD_IPC.DISCOTRADER_WEBHOOK_SECRET_STATUS,
      TRADE_GOD_IPC.SAVE_DISCOTRADER_WEBHOOK_SECRET,
      TRADE_GOD_IPC.EXECUTION_CONTROL,
      TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL,
      TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL,
      TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION,
      TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION,
      TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS,
      TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION,
      TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION,
    ])
    expect(stops).toBe(1)
  })
})
