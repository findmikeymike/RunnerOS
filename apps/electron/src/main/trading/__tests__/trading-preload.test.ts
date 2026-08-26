import { expect, test } from 'bun:test'

import { TRADE_GOD_IPC } from '../trading-ipc.ts'
import { createTradingPreloadApi } from '../trading-preload.ts'

test('preload adapter invokes only the local Trade God channels', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  let subscribedChannel = ''
  let subscribedPayload: unknown
  const api = createTradingPreloadApi(async (channel, ...args) => {
    calls.push({ channel, args })
    return channel === TRADE_GOD_IPC.HEALTH ? { state: 'ready' } : { artifact_id: 'artifact-preload' }
  }, (channel, callback) => {
    subscribedChannel = channel
    callback({ id: 'tv-preload' })
    return () => {}
  })
  const input = { timeoutMs: 500 } as any
  const chartInput = { symbol: 'ES', timeframe: '5m', sessionMode: 'RTH' } as const

  expect(await api.getTradeGodHealth() as any).toEqual({ state: 'ready' })
  expect(await api.analyzeTradeGodFixture(input) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.interpretTradeGodFixture(input) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.cancelTradeGodAnalysis('cancel-preload') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.listTradeGodAlerts(20) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.acknowledgeTradeGodAlert('tv-preload') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.getTradeGodAlertIngestionStatus() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.getTradeGodAlertWebhookSetup() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.getIbkrGatewayHealth() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.getSyntheticTradeGodChartFixture(chartInput) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.listTradingConnections() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.saveTradingConnection({ connection: {} } as any) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.removeTradingConnection('connection-1') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.openTradingConnectionLogin('connection-1') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.confirmTradingConnectionLogin('connection-1') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.verifyTradingConnection('connection-1') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.applyTradingConnectionCertification('connection-1', 'certification-1') as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.setTradingConnectionPaperExecution('connection-1', true) as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.listTradingSignalRoutes() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.saveTradingSignalRoute(
    { route_id: 'route-1' } as any,
    'connection-old',
  ) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.removeTradingSignalRoute('route-1') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.listMirrorGroups() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.saveMirrorGroup({ mirror_group_id: 'group-one' } as any) as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.getTradeGodExecutionControl() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.setTradeGodGlobalExecutionKill(true) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.setTradeGodConnectionExecutionKill('connection-1', false) as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.prepareTradeGodPaperActivation() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.commitTradeGodPaperActivation('review-1', 'a'.repeat(64)) as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.listTradeGodStandingAuthorizations() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.saveTradeGodStandingAuthorization({ authorization_id: 'mandate-1' } as any) as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.revokeTradeGodStandingAuthorization('connection-1') as any)
    .toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.listOptionsConnections() as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.saveOptionsConnection({ provider: 'ibkr' } as any) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.verifyOptionsConnection('options-one') as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.removeOptionsConnection('options-one') as any).toEqual({ artifact_id: 'artifact-preload' })
  const optionsCertificationInput = {
    connection_id: 'options-one', max_test_debit: '150', expires_at: '2026-08-26T01:15:00.000Z',
    contract: { underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' as const }, operator_confirmed: true as const,
  }
  expect(await api.startOptionsCertification(optionsCertificationInput) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.applyOptionsCertification('options-one', 'options-cert-one', true) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.activateOptionsManualAuthority(
    'options-one', '100', '2026-08-26T01:30:00.000Z', true,
  ) as any).toEqual({ artifact_id: 'artifact-preload' })
  expect(await api.revokeOptionsManualAuthority('options-one') as any).toEqual({ artifact_id: 'artifact-preload' })
  api.onTradeGodAlert((payload) => { subscribedPayload = payload })
  expect(subscribedChannel).toBe(TRADE_GOD_IPC.ALERT_RECEIVED)
  expect(subscribedPayload).toEqual({ id: 'tv-preload' })
  expect(calls).toEqual([
    { channel: TRADE_GOD_IPC.HEALTH, args: [] },
    { channel: TRADE_GOD_IPC.ANALYZE_FIXTURE, args: [input] },
    { channel: TRADE_GOD_IPC.INTERPRET_FIXTURE, args: [input] },
    { channel: TRADE_GOD_IPC.CANCEL_ANALYSIS, args: ['cancel-preload'] },
    { channel: TRADE_GOD_IPC.LIST_ALERTS, args: [20] },
    { channel: TRADE_GOD_IPC.ACKNOWLEDGE_ALERT, args: ['tv-preload'] },
    { channel: TRADE_GOD_IPC.ALERT_INGESTION_STATUS, args: [] },
    { channel: TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP, args: [] },
    { channel: TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH, args: ['paper'] },
    { channel: TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE, args: [chartInput] },
    { channel: TRADE_GOD_IPC.LIST_CONNECTIONS, args: [] },
    { channel: TRADE_GOD_IPC.SAVE_CONNECTION, args: [{ connection: {} }] },
    { channel: TRADE_GOD_IPC.REMOVE_CONNECTION, args: ['connection-1'] },
    { channel: TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN, args: ['connection-1'] },
    { channel: TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN, args: ['connection-1'] },
    { channel: TRADE_GOD_IPC.VERIFY_CONNECTION, args: ['connection-1'] },
    { channel: TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION, args: ['connection-1', 'certification-1'] },
    { channel: TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION, args: ['connection-1', true] },
    { channel: TRADE_GOD_IPC.LIST_SIGNAL_ROUTES, args: [] },
    { channel: TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE, args: [{ route_id: 'route-1' }, 'connection-old'] },
    { channel: TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE, args: ['route-1'] },
    { channel: TRADE_GOD_IPC.LIST_MIRROR_GROUPS, args: [] },
    { channel: TRADE_GOD_IPC.SAVE_MIRROR_GROUP, args: [{ mirror_group_id: 'group-one' }] },
    { channel: TRADE_GOD_IPC.EXECUTION_CONTROL, args: [] },
    { channel: TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL, args: [true] },
    { channel: TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL, args: ['connection-1', false] },
    { channel: TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION, args: [] },
    { channel: TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION, args: ['review-1', 'a'.repeat(64)] },
    { channel: TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS, args: [] },
    { channel: TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION, args: [{ authorization_id: 'mandate-1' }] },
    { channel: TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION, args: ['connection-1'] },
    { channel: TRADE_GOD_IPC.LIST_OPTIONS_CONNECTIONS, args: [] },
    { channel: TRADE_GOD_IPC.SAVE_OPTIONS_CONNECTION, args: [{ provider: 'ibkr' }] },
    { channel: TRADE_GOD_IPC.VERIFY_OPTIONS_CONNECTION, args: ['options-one'] },
    { channel: TRADE_GOD_IPC.REMOVE_OPTIONS_CONNECTION, args: ['options-one'] },
    { channel: TRADE_GOD_IPC.START_OPTIONS_CERTIFICATION, args: [optionsCertificationInput] },
    { channel: TRADE_GOD_IPC.APPLY_OPTIONS_CERTIFICATION, args: ['options-one', 'options-cert-one', true] },
    { channel: TRADE_GOD_IPC.ACTIVATE_OPTIONS_MANUAL_AUTHORITY, args: ['options-one', '100', '2026-08-26T01:30:00.000Z', true] },
    { channel: TRADE_GOD_IPC.REVOKE_OPTIONS_MANUAL_AUTHORITY, args: ['options-one'] },
  ])
})
