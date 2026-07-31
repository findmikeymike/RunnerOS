import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  CANONICAL_ORDER_FLOW_CONFIGURATION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  buildDiscordManagementMessage,
  FileTradingConnectionStore,
} from '@trade-god/execution'
import { loadEsDemoFixture } from '@trade-god/testkit'

import { TRADE_GOD_IPC } from '../trading-ipc.ts'
import {
  createTradeGodRuntime,
  resolveMarketDataLaunch,
  resolveOrderFlowLaunch,
  resolveTradeGodHostConfig,
} from '../trading-runtime.ts'

class FakeIpcMain {
  readonly handlers = new Map<string, (...args: any[]) => any>()
  handle(channel: string, handler: (...args: any[]) => any): void { this.handlers.set(channel, handler) }
  removeHandler(channel: string): void { this.handlers.delete(channel) }
}

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')

test('resolves and runs the development sidecar from an explicit RunnerOS root', async () => {
  const runtimeNow = new Date().toISOString()
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
  const runtime = createTradeGodRuntime({
    ipcMain: ipc,
    rootCandidates: [repoRoot],
    runtimeExecutable: process.execPath,
    now: () => runtimeNow,
    contextDirectory,
    alertDirectory,
    connectionDirectory,
    executionDirectory,
    alertPort: -1,
  })

  const health = await ipc.handlers.get(TRADE_GOD_IPC.HEALTH)!({})
  expect(health).toMatchObject({ state: 'ready' })
  expect(runtime.marketDataManager).toBeDefined()
  expect(runtime.canonicalPipeline).toBeDefined()
  expect(runtime.specialistContextPipeline).toBeDefined()
  expect(runtime.alertLedger).toBeDefined()
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
        authorId: 'discord-user-1',
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
      source: { type: 'discord', source_id: 'discord-entry-runtime-1' },
      connection_id: connection.connection_id,
      instrument: { canonical_id: 'CME:MNQ', symbol: 'MNQ', exchange: 'XCME' },
      quantity: 2,
    },
  })
  const cbotEntry = await runtime.ingestDiscoTraderTicketPush!({
    ...entryPush,
    summary: 'LONG 1xMYM',
    ticket: {
      ...entryPush.ticket,
      id: 'ticket-runtime-entry-2',
      action: {
        ...entryPush.ticket.action,
        symbol: 'YM',
      },
      symbol: 'YM',
      tradedSymbol: 'MYM',
      contracts: 1,
      stop: undefined,
      provenance: {
        ...entryPush.ticket.provenance,
        messageId: 'discord-entry-runtime-2',
        rawText: 'YM long 21450 stop 21440 target 21470',
      },
    },
  })
  expect(cbotEntry.intent.instrument).toEqual({
    canonical_id: 'CBOT:MYM',
    symbol: 'MYM',
    exchange: 'XCBT',
  })
  expect(cbotEntry.intent.protection.stop_loss).toEqual({ type: 'ticks', value: '10' })

  const managementMessage = buildDiscordManagementMessage({
    message_id: 'runtime-followup-1',
    author_id: 'discord-user-1',
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
    candidate_intent_ids: [],
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
