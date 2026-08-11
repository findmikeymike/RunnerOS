import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  CANONICAL_ORDER_FLOW_CONFIGURATION,
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  buildDiscordManagementMessage,
  FileExecutionStore,
  FileMirrorGroupStore,
  FileTradingConnectionStore,
} from '@trade-god/execution'
import { loadEsDemoFixture } from '@trade-god/testkit'

import { TRADE_GOD_IPC } from '../trading-ipc.ts'
import {
  createTradeGodRuntime,
  resolveMarketDataLaunch,
  resolveOrderFlowLaunch,
  resolveTradeGodHostConfig,
  TradingRouteMutationCoordinator,
} from '../trading-runtime.ts'
import { resolveFuturesContractIdentity } from '@trade-god/execution'
import type { TradingSignalRoute } from '../trading-signal-route-store.ts'
import { TradingSignalRouteStore } from '../trading-signal-route-store.ts'

class FakeIpcMain {
  readonly handlers = new Map<string, (...args: any[]) => any>()
  handle(channel: string, handler: (...args: any[]) => any): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')

test('resolves and runs the development sidecar from an explicit RunnerOS root', async () => {
  let runtimeNow = new Date().toISOString()
  const contextDirectory = mkdtempSync(path.join(tmpdir(), 'trade-god-agent-context-'))
  const alertDirectory = mkdtempSync(path.join(tmpdir(), 'trade-god-alerts-'))
  const connectionDirectory = mkdtempSync(path.join(tmpdir(), 'trade-god-connections-'))
  const executionDirectory = mkdtempSync(path.join(tmpdir(), 'trade-god-execution-'))
  const launch = resolveOrderFlowLaunch({ rootCandidates: [repoRoot], runtimeExecutable: process.execPath })
  expect(launch.command).toEqual([process.execPath, path.join(repoRoot, 'sidecars/order-flow-engine/src/cli.ts')])
  const marketLaunch = resolveMarketDataLaunch({ rootCandidates: [repoRoot], platform: process.platform })
  expect(marketLaunch.command).toEqual([
    path.join(repoRoot, 'sidecars/market-data-engine/.venv/bin/python'),
    '-m', 'trade_god_market_data.cli', '--fixture-root',
    path.join(repoRoot, 'packages/trading-testkit/fixtures/es-demo'),
  ])

  const ipc = new FakeIpcMain()
  const vault = new Map<string, string>()
  const runtime = createTradeGodRuntime({
    ipcMain: ipc,
    rootCandidates: [repoRoot],
    runtimeExecutable: process.execPath,
    now: () => runtimeNow,
    contextDirectory,
    alertDirectory,
    connectionDirectory,
    executionDirectory,
    credentialVault: {
      getSecret: async (name) => vault.get(name) ?? null,
      setSecret: async (name, value) => { vault.set(name, value) },
      compareAndSetSecret: async (name, _expected, value) => {
        if (!vault.has(name)) return false
        vault.set(name, value)
        return true
      },
      deleteSecret: async (name) => vault.delete(name),
    },
    tradingBrowserSessionLauncher: {
      open: async ({ connectionId, sessionRef }) => ({
        browser_instance_id: `browser-${connectionId}`, session_ref: sessionRef,
      }),
      inspect: async () => ({ url: 'https://www.wealthcharts.com/', title: 'WealthCharts' }),
      clear: async () => undefined,
    },
    alertPort: -1,
  })

  const health = await ipc.handlers.get(TRADE_GOD_IPC.HEALTH)!({})
  expect(health).toMatchObject({ state: 'ready' })
  expect(runtime.marketDataManager).toBeDefined()
  expect(runtime.canonicalPipeline).toBeDefined()
  expect(runtime.specialistContextPipeline).toBeDefined()
  expect(runtime.alertLedger).toBeDefined()
  expect(await ipc.handlers.get(TRADE_GOD_IPC.EXECUTION_CONTROL)!({}))
    .toMatchObject({ provider_adapters_attached: false, global_kill: true })
  expect(await ipc.handlers.get(TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION)!({}))
    .toMatchObject({ ready: false, blockers: [{ code: 'no-enabled-paper-account' }] })
  expect(await runtime.marketDataManager!.health()).toMatchObject({ state: 'ready' })
  const chartPreview = await ipc.handlers.get(TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE)!({}, {
    symbol: 'ES', timeframe: '5m', sessionMode: 'RTH',
  })
  expect(chartPreview).toMatchObject({
    instrument_id: 'CME:ESU6',
    interval_ns: '300000000000',
    quality_flags: ['synthetic-project-fixture'],
  })
  expect(chartPreview.closed).toHaveLength(78)

  const fixture = await loadEsDemoFixture()
  const artifact = await ipc.handlers.get(TRADE_GOD_IPC.ANALYZE_FIXTURE)!({}, {
    fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
    instrument: fixture.manifest.instrument,
    session: fixture.manifest.session,
    analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
    timeoutMs: 5_000,
    traceId: 'trace-runtime-canonical',
  })
  expect(artifact).toMatchObject({
    artifact_schema_version: 'order-flow-artifact@2',
    input: { kind: 'canonical-market-batch' },
    summary: { event_count: 4, total_volume: '28', delta: '6' },
  })

  const delivery = await runtime.specialistContextPipeline!.routeFixtureSnapshot({
    fixtureId: fixture.manifest.fixture_id,
    traceId: 'trace-specialist-context',
    batchId: 'batch-specialist-context',
    snapshotId: 'snapshot-specialist-context',
    intervalNs: '20000000000',
    watermarkNs: '1783780230000000000',
    staleAfterNs: '5000000000',
    sessionWindow: fixture.manifest.session_window,
    recentTradeLimit: 2,
    closedCandleLimit: 1,
    consumerAgentId: 'order-flow-specialist',
    capability: 'order-flow-interpretation',
  })
  expect(delivery).toMatchObject({
    delivery_mode: 'reference', status: 'queued',
    consumer: { agent_id: 'order-flow-specialist', capability: 'order-flow-interpretation' },
    context: {
      context_schema_version: 'agent-market-snapshot@2',
      trace_id: 'trace-specialist-context',
      authority: { purpose: 'analysis', execution_allowed: false, order_submission_allowed: false },
    },
  })
  expect(delivery).not.toHaveProperty('snapshot')
  const resolved = await runtime.contextStore!.resolveForConsumer(delivery.delivery_id, 'order-flow-specialist')
  expect(resolved.receipt.status).toBe('resolved')
  expect(resolved.snapshot).toMatchObject({
    snapshot_id: 'snapshot-specialist-context',
    trades: { returned_count: 2, visible_count: 4, truncated: true },
  })

  await runtime.alertLedger!.ingestTradingView({
    secret: '1234567890abcdef',
    ticker: 'CME_MINI:ES1!',
    message: 'Runtime alert proof',
  })
  expect(await ipc.handlers.get(TRADE_GOD_IPC.LIST_ALERTS)!({}, 10)).toMatchObject([
    { source: 'tradingview', symbol: 'CME_MINI:ES1-', title: 'Runtime alert proof' },
  ])
  expect(await ipc.handlers.get(TRADE_GOD_IPC.ALERT_INGESTION_STATUS)!({})).toMatchObject({
    state: 'disabled',
    public_relay_connected: false,
  })

  const connection: TradingConnection = {
    connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
    connection_id: 'connection-discotrader-paper',
    display_name: 'DiscoTrader Paper',
    firm: { slug: 'apex', name: 'Apex Trader Funding' },
    platform: { slug: 'tradovate', name: 'Tradovate' },
    environment: 'paper',
    environment_class: 'rehearsal',
    transport_preference: 'api',
    account_ref: 'account-paper',
    account_display: { label: 'Paper account' },
    credential_ref: 'credential-paper',
    risk_policy_ref: 'risk-paper',
    authorization_basis_ref: 'authorization-paper',
    approval_policy_ref: 'approval-paper',
    state: 'ready',
    capabilities: {
      read_accounts: true,
      read_orders: true,
      read_positions: true,
      read_executions: true,
      submit_market: true,
      submit_limit: true,
      submit_stop: true,
      submit_stop_limit: true,
      native_bracket: true,
      native_oco: true,
      modify_order: true,
      cancel_order: true,
      partial_close: true,
      flatten: true,
      streaming_events: true,
    },
    certifications: ['read-certified', 'paper-entry-certified', 'paper-lifecycle-certified'],
    enabled: true,
    created_at: runtimeNow,
    updated_at: runtimeNow,
  }
  await new FileTradingConnectionStore(connectionDirectory, () => runtimeNow).save(connection)
  await new TradingSignalRouteStore(connectionDirectory, () => runtimeNow).save({
    route_schema_version: 'trading-signal-route@2',
    route_id: 'route-runtime-discord-one',
    display_name: 'Jordan V signals',
    source_type: 'discord',
    server_id: '1',
    channel_id: '2',
    trader_author_id: '123456789012345678',
    target: { type: 'connection', connection_id: connection.connection_id },
    enabled: true,
    created_at: runtimeNow,
    updated_at: runtimeNow,
  })
  const mandateEnd = new Date(Date.parse(runtimeNow) + 60 * 60 * 1_000).toISOString()
  await ipc.handlers.get(TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION)!({}, {
    authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: 'mandate-runtime-paper',
    connection_id: connection.connection_id,
    mode: 'standing-mandate',
    scope: {
      symbols: ['ESZ27'],
      max_contracts: 2,
      allowed_sides: ['buy', 'sell'],
      allowed_order_types: ['market', 'limit'],
      session_start: runtimeNow,
      session_end: mandateEnd,
      max_daily_loss: '500',
      max_open_risk: '100',
    },
    issued_by: 'operator-test',
    issued_at: runtimeNow,
    expires_at: mandateEnd,
  })
  expect(await ipc.handlers.get(TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS)!({}))
    .toMatchObject([{ authorization_id: 'mandate-runtime-paper' }])
  const externalExecutionStore = new FileExecutionStore(executionDirectory, () => runtimeNow)
  await externalExecutionStore.setGlobalKill(false)
  await expect(ipc.handlers.get(TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION)!({}, {
    authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: 'mandate-runtime-replacement',
    connection_id: connection.connection_id,
    mode: 'standing-mandate',
    scope: {
      symbols: ['ESZ27'], max_contracts: 2, allowed_sides: ['buy', 'sell'],
      allowed_order_types: ['market', 'limit'], session_start: runtimeNow,
      session_end: mandateEnd, max_daily_loss: '500', max_open_risk: '100',
    },
    issued_by: 'operator-test', issued_at: runtimeNow, expires_at: mandateEnd,
  })).rejects.toThrow('persistent global new-entry halt')
  await externalExecutionStore.setGlobalKill(true)
  await expect(ipc.handlers.get(TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL)!({}, false))
    .rejects.toThrow('exact paper activation review')
  await expect(ipc.handlers.get(TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL)!({}, connection.connection_id, false))
    .rejects.toThrow('exact paper activation review')
  expect(runtime.ingestDiscoTraderTicketPush).toBeDefined()
  const entryPush = {
    kind: 'ticket',
    severity: 'action_required',
    summary: 'LONG 2xMNQ',
    ticket: {
      id: 'ticket-runtime-entry-1',
      createdAt: runtimeNow,
      mode: 'alert-only',
      action: {
        intent: 'entry',
        symbol: 'NQ',
        side: 'long',
        entry: 21450,
        stop: 21440,
        targets: [21470],
        confidence: 0.9,
        evidence: ['entry phrase'],
      },
      symbol: 'NQ',
      tradedSymbol: 'MNQ',
      side: 'long',
      contracts: 2,
      entry: 21450,
      stop: 21440,
      stopDistancePoints: 10,
      targets: [21470],
      riskUsd: 40,
      provenance: {
        messageId: 'discord-entry-runtime-1',
        author: 'Jordan V',
        authorId: '123456789012345678',
        channelUrl: 'https://discord.com/channels/1/2',
        rawText: 'NQ long 21450 stop 21440 target 21470',
        postedAt: runtimeNow,
        observedAt: runtimeNow,
        latencyMs: 0,
      },
      gateTrail: ['sizing:pass(2xMNQ, $40)'],
      llmVeto: {
        decision: 'accept',
        reason: 'No deterministic objection.',
        model: 'gpt-test',
        ms: 1,
      },
    },
    at: runtimeNow,
  }
  const entry = await runtime.ingestDiscoTraderTicketPush!(entryPush)
  expect(entry).toMatchObject({
    state: 'created',
    intent: {
      source: { type: 'discord', source_id: 'route-runtime-discord-one' },
      connection_id: connection.connection_id,
      instrument: { canonical_id: 'CME:MNQ', symbol: 'MNQ', exchange: 'XCME' },
      quantity: 2,
    },
  })
  const entryReceivedAt = runtimeNow
  runtimeNow = '2027-01-15T15:05:00.000Z'
  expect(await runtime.ingestDiscoTraderTicketPush!(entryPush)).toEqual(entry)
  runtimeNow = entryReceivedAt
  expect(await ipc.handlers.get(TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION)!({}, connection.connection_id))
    .toBe(true)
  const cbotEntry = await runtime.ingestDiscoTraderTicketPush!({
    ...entryPush,
    summary: 'LONG 1xMYM',
    ticket: {
      ...entryPush.ticket,
      id: 'ticket-runtime-entry-2',
      action: {
        ...entryPush.ticket.action,
        symbol: 'YM',
        stop: undefined,
        stopPoints: 10,
      },
      symbol: 'YM',
      tradedSymbol: 'MYMU6',
      contracts: 1,
      stop: undefined,
      provenance: {
        ...entryPush.ticket.provenance,
        messageId: 'discord-entry-runtime-2',
        rawText: 'YM long 21450 stop 21440 target 21470',
      },
    },
  })
  if (!('intent' in cbotEntry)) throw new Error('Expected a single-account execution record.')
  expect(cbotEntry.intent.instrument).toEqual({
    canonical_id: 'CBOT:MYMU6',
    symbol: 'MYMU6',
    exchange: 'XCBT',
    expiry: '2026-09',
    tick_size: '1',
    point_value_usd: '0.5',
  })
  expect(cbotEntry.intent.protection.stop_loss).toEqual({ type: 'ticks', value: '10' })

  const mirrorConnection = {
    ...connection,
    connection_id: 'connection-discotrader-paper-two',
    display_name: 'DiscoTrader Paper Two',
    account_ref: 'account-paper-two',
    account_display: { label: 'Paper account two' },
    credential_ref: 'credential-paper-two',
  }
  const connectionStore = new FileTradingConnectionStore(connectionDirectory, () => runtimeNow)
  await connectionStore.save(mirrorConnection)
  const group = await new FileMirrorGroupStore(
    executionDirectory,
    (connectionId) => connectionStore.get(connectionId),
    () => runtimeNow,
  ).save({
    mirror_group_id: 'mirror-runtime-paper',
    display_name: 'Runtime paper mirrors',
    environment: 'paper',
    state: 'active',
    dispatch_max_concurrency: 2,
    max_aggregate_initial_risk: '100',
    max_active_parent_trades: 1,
    members: [connection, mirrorConnection].map((member) => ({
      connection_id: member.connection_id,
      enabled: true,
      quantity_rule: { mode: 'fixed-contracts' as const, contracts: 1, max_contracts: 1 },
    })),
  })
  await new TradingSignalRouteStore(connectionDirectory, () => runtimeNow).save({
    route_schema_version: 'trading-signal-route@2',
    route_id: 'route-runtime-discord-one',
    display_name: 'Jordan V signals',
    source_type: 'discord',
    server_id: '1',
    channel_id: '2',
    trader_author_id: '123456789012345678',
    target: { type: 'mirror-group', mirror_group_id: group.mirror_group_id },
    enabled: true,
    created_at: runtimeNow,
    updated_at: runtimeNow,
  }, { expected_previous_target_key: `connection:${connection.connection_id}` })
  expect(await runtime.ingestDiscoTraderTicketPush!(entryPush)).toEqual(entry)
  const mirrorPreview = await runtime.ingestDiscoTraderTicketPush!({
    ...entryPush,
    ticket: {
      ...entryPush.ticket,
      id: 'ticket-runtime-mirror-1',
      riskUsd: 80,
      provenance: {
        ...entryPush.ticket.provenance,
        messageId: 'discord-entry-runtime-mirror-1',
      },
    },
  })
  expect(mirrorPreview).toMatchObject({
    mirror_execution_preview_schema_version: 'mirror-execution-preview@1',
    state: 'ready',
    order_mutation_allowed: false,
    children: [
      { connection_id: connection.connection_id, planned_quantity: 1 },
      { connection_id: mirrorConnection.connection_id, planned_quantity: 1 },
    ],
  })
  expect('intent' in mirrorPreview).toBe(false)
  await new TradingSignalRouteStore(connectionDirectory, () => runtimeNow).save({
    route_schema_version: 'trading-signal-route@2',
    route_id: 'route-runtime-discord-one',
    display_name: 'Jordan V signals',
    source_type: 'discord',
    server_id: '1', channel_id: '2', trader_author_id: '123456789012345678',
    target: { type: 'connection', connection_id: connection.connection_id },
    enabled: true, created_at: runtimeNow, updated_at: runtimeNow,
  }, { expected_previous_target_key: `mirror-group:${group.mirror_group_id}` })
  const originalRuntimeNow = runtimeNow
  runtimeNow = '2027-01-15T15:05:00.000Z'
  expect(await runtime.ingestDiscoTraderTicketPush!({
    ...entryPush,
    ticket: {
      ...entryPush.ticket,
      id: 'ticket-runtime-mirror-1',
      riskUsd: 80,
      provenance: {
        ...entryPush.ticket.provenance,
        messageId: 'discord-entry-runtime-mirror-1',
      },
    },
  })).toEqual(mirrorPreview)
  runtimeNow = originalRuntimeNow

  const mirrorContextManagement = buildDiscordManagementMessage({
    message_id: 'runtime-followup-mirror-context',
    author_id: '123456789012345678',
    channel_id: '2',
    guild_id: '1',
    reply_to_message_id: 'discord-entry-runtime-mirror-1',
    raw_text: 'all out',
    posted_at: runtimeNow,
    observed_at: runtimeNow,
    is_edit: false,
  })
  await expect(runtime.ingestDiscordManagementPush!({
    kind: 'management', severity: 'action_required', summary: 'Mirror follow-up',
    management: mirrorContextManagement, at: runtimeNow,
  })).resolves.toMatchObject({
    status: 'deferred',
    error: expect.stringContaining('Reply target is not an accepted entry'),
  })

  const managementMessage = buildDiscordManagementMessage({
    message_id: 'runtime-followup-1',
    author_id: '123456789012345678',
    channel_id: 'discord-channel-1',
    raw_text: 'all out',
    posted_at: runtimeNow,
    observed_at: runtimeNow,
    is_edit: false,
  })
  expect(runtime.ingestDiscordManagementPush).toBeDefined()
  expect(await runtime.ingestDiscordManagementPush!({
    kind: 'management',
    severity: 'action_required',
    summary: 'Discord trade follow-up',
    management: managementMessage,
    at: runtimeNow,
  })).toMatchObject({
    status: 'blocked',
    candidates: [],
    error: 'No active trade matches this author and Discord channel context.',
  })

  await runtime.dispose()
  rmSync(contextDirectory, { recursive: true, force: true })
  rmSync(alertDirectory, { recursive: true, force: true })
  rmSync(connectionDirectory, { recursive: true, force: true })
  rmSync(executionDirectory, { recursive: true, force: true })
  expect(ipc.handlers.size).toBe(0)
})

test('fails clearly when no sidecar entrypoint exists', () => {
  expect(() => resolveOrderFlowLaunch({ rootCandidates: ['/definitely/missing'], runtimeExecutable: process.execPath }))
    .toThrow('Order Flow sidecar entrypoint was not found')
  expect(() => resolveMarketDataLaunch({ rootCandidates: ['/definitely/missing'], platform: process.platform }))
    .toThrow('Market Data sidecar runtime was not found')
})

test('resolves only explicit futures month/year symbols to canonical expiry', () => {
  expect(resolveFuturesContractIdentity('ESU6', '2026-08-10T00:00:00.000Z')).toEqual({
    root: 'ES', symbol: 'ESU6', expiry: '2026-09', active: true,
  })
  expect(resolveFuturesContractIdentity('M2KZ26', '2026-08-10T00:00:00.000Z')).toEqual({
    root: 'M2K', symbol: 'M2KZ26', expiry: '2026-12', active: true,
  })
  expect(resolveFuturesContractIdentity('ESH6', '2026-08-10T00:00:00.000Z')).toEqual({
    root: 'ES', symbol: 'ESH6', expiry: '2026-03', active: false,
  })
  expect(resolveFuturesContractIdentity('MNQ', '2026-08-10T00:00:00.000Z'))
    .toEqual({ root: 'MNQ', symbol: 'MNQ' })
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
    appPath: '/Applications/Trade God.app/Contents/Resources/app',
    resourcesPath: '/Applications/Trade God.app/Contents/Resources',
    cwd: '/untrusted/launch-directory',
    homeDir: '/Users/tester',
    env: {},
    platform: 'darwin',
  })).toEqual({
    rootCandidates: ['/Applications/Trade God.app/Contents/Resources/app'],
    runtimeExecutable: '/Applications/Trade God.app/Contents/Resources/app/vendor/bun/bun',
  })
})

const coordinatorRoute = (connectionId = 'connection-one'): TradingSignalRoute => ({
  route_schema_version: 'trading-signal-route@2',
  route_id: 'route-one', display_name: 'Trader one', source_type: 'discord',
  server_id: '1', channel_id: '2', trader_author_id: '3',
  target: { type: 'connection', connection_id: connectionId }, enabled: true,
  created_at: '2026-08-03T12:00:00.000Z', updated_at: '2026-08-03T12:00:00.000Z',
})

test('route coordinator rejects missing account targets and blocks deletion with attached routes', async () => {
  let saveCalled = false
  let removeConnectionCalled = false
  const routes = [coordinatorRoute()]
  const coordinator = new TradingRouteMutationCoordinator({
    get: async (connectionId) => {
      if (connectionId === 'missing') throw new Error('not found')
      return {} as TradingConnection
    },
  }, {
    list: async () => routes,
    save: async (route) => { saveCalled = true; return route },
    remove: async () => true,
  })

  await expect(coordinator.saveRoute(coordinatorRoute('missing'))).rejects.toThrow('not found')
  expect(saveCalled).toBe(false)
  await expect(coordinator.removeConnection('connection-one', async () => {
    removeConnectionCalled = true
    return true
  })).rejects.toThrow('Remove this account’s Discord sources')
  expect(removeConnectionCalled).toBe(false)
})

test('route save and account deletion are serialized so a new route cannot be orphaned', async () => {
  const routes: TradingSignalRoute[] = []
  let releaseSave!: () => void
  let markSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve })
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
  let removeConnectionCalled = false
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => ({} as TradingConnection),
  }, {
    list: async () => routes,
    save: async (route) => {
      markSaveStarted()
      await saveGate
      routes.push(route)
      return route
    },
    remove: async () => true,
  })

  const saving = coordinator.saveRoute(coordinatorRoute())
  await saveStarted
  const removing = coordinator.removeConnection('connection-one', async () => {
    removeConnectionCalled = true
    return true
  })
  releaseSave()
  await saving
  await expect(removing).rejects.toThrow('Remove this account’s Discord sources')
  expect(removeConnectionCalled).toBe(false)
})

test('account save and deletion are serialized so a deleted account cannot be resurrected', async () => {
  let releaseSave!: () => void
  let markSaveStarted!: () => void
  const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve })
  const saveGate = new Promise<void>((resolve) => { releaseSave = resolve })
  const operations: string[] = []
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => ({} as TradingConnection),
  }, {
    list: async () => [],
    save: async (route) => route,
    remove: async () => true,
  })

  const saving = coordinator.saveConnection('connection-one', async () => {
    operations.push('save-start')
    markSaveStarted()
    await saveGate
    operations.push('save-finish')
    return true
  })
  await saveStarted
  const removing = coordinator.removeConnection('connection-one', async () => {
    operations.push('remove')
    return true
  })
  expect(operations).toEqual(['save-start'])
  releaseSave()
  await saving
  expect(await removing).toBe(true)
  expect(operations).toEqual(['save-start', 'save-finish', 'remove'])

  await expect(coordinator.saveConnection('connection-one', async () => {
    operations.push('resurrect')
    return true
  })).rejects.toThrow('removed in the current app session')
  expect(operations).not.toContain('resurrect')
})

test('browser confirmation uses the same deletion-safe connection mutation boundary', async () => {
  let releaseConfirmation!: () => void
  let markConfirmationStarted!: () => void
  const confirmationStarted = new Promise<void>((resolve) => { markConfirmationStarted = resolve })
  const confirmationGate = new Promise<void>((resolve) => { releaseConfirmation = resolve })
  const operations: string[] = []
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => ({} as TradingConnection),
  }, {
    list: async () => [], save: async (route) => route, remove: async () => true,
  })
  const confirming = coordinator.saveConnection('connection-one', async () => {
    operations.push('confirm-start')
    markConfirmationStarted()
    await confirmationGate
    operations.push('confirm-save')
    return true
  })
  await confirmationStarted
  const removing = coordinator.removeConnection('connection-one', async () => {
    operations.push('remove')
    return true
  })
  releaseConfirmation()
  await confirming
  await removing
  expect(operations).toEqual(['confirm-start', 'confirm-save', 'remove'])
  await expect(coordinator.saveConnection('connection-one', async () => true))
    .rejects.toThrow('removed in the current app session')
})

test('account deletion is blocked while an execution is active or unresolved', async () => {
  let removeConnectionCalled = false
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => ({} as TradingConnection),
  }, {
    list: async () => [],
    save: async (route) => route,
    remove: async () => true,
  }, async (connectionId) => connectionId === 'connection-one')

  await expect(coordinator.removeConnection('connection-one', async () => {
    removeConnectionCalled = true
    return true
  })).rejects.toThrow('Resolve or close this account’s execution records')
  expect(removeConnectionCalled).toBe(false)
})

test('route coordinator validates Mirror Group targets and protects current group members', async () => {
  let connectionLookup = 0
  let groupLookup = 0
  let removeConnectionCalled = false
  const groupRoute: TradingSignalRoute = {
    ...coordinatorRoute(),
    target: { type: 'mirror-group', mirror_group_id: 'mirror-group-one' },
  }
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => { connectionLookup += 1; return {} as TradingConnection },
  }, {
    list: async () => [],
    save: async (route) => route,
    remove: async () => true,
  }, async () => false, {
    get: async (groupId) => {
      groupLookup += 1
      if (groupId !== 'mirror-group-one') throw new Error('missing group')
      return { state: 'active' } as any
    },
    list: async () => [{
      state: 'active',
      members: [{ connection_id: 'connection-one' }],
    }] as any,
    save: async (input) => ({ ...input, revision: 1 }) as any,
  })

  expect(await coordinator.saveRoute(groupRoute)).toEqual(groupRoute)
  expect(groupLookup).toBe(1)
  expect(connectionLookup).toBe(0)
  await expect(coordinator.removeConnection('connection-one', async () => {
    removeConnectionCalled = true
    return true
  })).rejects.toThrow('active Mirror Group revisions')
  expect(removeConnectionCalled).toBe(false)
})

test('route coordinator rejects enabled inactive and all archived Mirror Group routes', async () => {
  let groupState: 'draft' | 'archived' = 'draft'
  let saveCalled = false
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => ({} as TradingConnection),
  }, {
    list: async () => [],
    save: async (route) => { saveCalled = true; return route },
    remove: async () => true,
  }, async () => false, {
    get: async () => ({ state: groupState }) as any,
    list: async () => [],
    save: async (input) => ({ ...input, revision: 1 }) as any,
  })
  const groupRoute: TradingSignalRoute = {
    ...coordinatorRoute(),
    target: { type: 'mirror-group', mirror_group_id: 'mirror-group-one' },
  }
  await expect(coordinator.saveRoute(groupRoute)).rejects.toThrow('only after its Mirror Group is active')
  groupState = 'archived'
  await expect(coordinator.saveRoute({ ...groupRoute, enabled: false })).rejects.toThrow('Archived Mirror Groups')
  expect(saveCalled).toBe(false)
})

test('routing capture serializes Mirror Group edits and account deletion', async () => {
  let releaseCapture!: () => void
  let markCaptureStarted!: () => void
  const captureStarted = new Promise<void>((resolve) => { markCaptureStarted = resolve })
  const captureGate = new Promise<void>((resolve) => { releaseCapture = resolve })
  let groupSaved = false
  const groups: any[] = []
  const coordinator = new TradingRouteMutationCoordinator({
    get: async () => ({} as TradingConnection),
  }, {
    list: async () => [], save: async (route) => route, remove: async () => true,
  }, async () => false, {
    get: async () => ({ state: 'active' }) as any,
    list: async () => groups,
    save: async (input) => {
      groupSaved = true
      const group = {
        ...input, revision: 1, state: 'active',
        members: [{ connection_id: 'connection-one' }, { connection_id: 'connection-two' }],
      }
      groups.push(group)
      return group as any
    },
  })

  const capture = coordinator.captureRoutingSnapshot(async () => {
    markCaptureStarted()
    await captureGate
    return 'captured'
  })
  await captureStarted
  const save = coordinator.saveMirrorGroup({} as any)
  let removed = false
  const remove = coordinator.removeConnection('connection-one', async () => {
    removed = true
    return true
  })
  expect(groupSaved).toBe(false)
  releaseCapture()
  expect(await capture).toBe('captured')
  await save
  await expect(remove).rejects.toThrow('active Mirror Group revisions')
  expect(removed).toBe(false)
})
