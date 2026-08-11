import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import {
  discoTraderPushPayloadSchema,
  MARKET_JSONL_SUPERVISOR_MAX_LINE_BYTES,
  type DiscoTraderTicket,
  type ExecutionRecord,
  type TradeAlert,
  type TradeAlertIngestionStatus,
  type TradeAlertWebhookSetup,
} from '@trade-god/contracts'

import { OrderFlowSidecarManager } from './order-flow-sidecar-manager.ts'
import { MarketDataSidecarManager } from './market-data-sidecar-manager.ts'
import { registerTradingIpc, type IpcMainLike } from './trading-ipc.ts'
import { TradingRunReceiptStore } from './run-receipt-store.ts'
import { CanonicalOrderFlowPipeline } from './canonical-order-flow-pipeline.ts'
import type { TradingIpcManager } from './trading-ipc.ts'
import { AgentContextStore } from './agent-context-store.ts'
import { SpecialistContextPipeline } from './specialist-context-pipeline.ts'
import { OrderFlowSpecialist, type SpecialistModel } from './order-flow-specialist.ts'
import { OrderFlowSpecialistPipeline } from './order-flow-specialist-pipeline.ts'
import { TradeAlertLedger } from './trade-alert-ledger.ts'
import {
  startTradeAlertServer,
  toTradeAlertIngestionStatus,
  type TradeAlertServerHandle,
} from './trade-alert-server.ts'
import {
  startTradeAlertTunnel,
  type TradeAlertTunnelHandle,
} from './trade-alert-tunnel.ts'
import { buildSyntheticEsChartFixture } from './synthetic-chart-fixture.ts'
import { DISCOTRADER_WEBHOOK_SECRET_REF } from './discotrader-webhook-secret.ts'
import {
  TradingConnectionService,
  type TradingBrowserSessionLauncher,
  type TradingCredentialVault,
} from './trading-connection-service.ts'
import {
  TradingSignalRouteStore,
  type TradingSignalRoute,
} from './trading-signal-route-store.ts'
import {
  ExecutionGateway,
  ExecutionGatewayError,
  resolveFuturesContractIdentity,
  resolveFuturesEconomicSpec,
  FileAdapterCertificationStore,
  FileDiscoTraderIntentSource,
  FileDiscordTradeManager,
  FileMirrorDiscordTradeManager,
  FileDiscordManagementFamilyResolver,
  FileExecutionStore,
  FileTradingConnectionStore,
  FileStandingAuthorizationStore,
  FileMirrorGroupStore,
  FileMirrorPreviewCoordinator,
  FileSourceExecutionBindingStore,
  FileMirrorExecutionStore,
  convertDiscoTraderTicket,
  mirrorExecutionIdFor,
  sha256,
  PaperExecutionCoordinator,
  ExecutionReconciliationSupervisor,
  type DiscoTraderIntentRoute,
  type ExecutionAdapter,
  type DiscordManagementDispatchResult,
  type SaveMirrorGroupInput,
} from '@trade-god/execution'
import type {
  ExecutionAuthorization,
  MirrorExecutionPreview,
  MirrorGroup,
  SourceExecutionBinding,
} from '@trade-god/contracts'

interface ResolveLaunchOptions {
  rootCandidates: string[]
  runtimeExecutable: string
}

interface ResolveMarketDataLaunchOptions {
  rootCandidates: string[]
  platform: NodeJS.Platform
}

interface RuntimeOptions extends ResolveLaunchOptions {
  ipcMain: IpcMainLike
  now: () => string
  receiptDirectory?: string
  contextDirectory?: string
  interpretationDirectory?: string
  alertDirectory?: string
  connectionDirectory?: string
  executionDirectory?: string
  executionAdapters?: ExecutionAdapter[]
  discoTraderConnectionId?: string
  discoTraderIntentValidityMs?: number
  credentialVault?: TradingCredentialVault
  tradingBrowserSessionLauncher?: TradingBrowserSessionLauncher
  alertPort?: number
  alertHost?: string
  alertToken?: string
  alertTunnelEnabled?: boolean
  alertTunnelExecutable?: string
  alertTunnelLogger?: {
    info(message: string): void
    warn(message: string): void
  }
  onAlert?: (alert: TradeAlert) => void
  specialistModel?: SpecialistModel
  log?: (entry: { event: string; traceId: string; receiptId: string; artifactId?: string; errorCode?: string }) => void
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

export class TradingRouteMutationCoordinator {
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly connections: Pick<FileTradingConnectionStore, 'get'>,
    private readonly routes: Pick<TradingSignalRouteStore, 'list' | 'save' | 'remove'>,
    private readonly hasUnresolvedExecution: (connectionId: string) => Promise<boolean> = async () => false,
    private readonly groups?: Pick<FileMirrorGroupStore, 'get' | 'list' | 'save'>,
  ) {}

  async captureRoutingSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLock(operation)
  }

  async saveMirrorGroup(input: SaveMirrorGroupInput): Promise<MirrorGroup> {
    if (!this.groups) throw new Error('Mirror Groups are unavailable.')
    return this.withLock(() => this.groups!.save(input))
  }

  async saveRoute(
    route: TradingSignalRoute,
    expectedPreviousTargetKey?: string,
  ): Promise<TradingSignalRoute> {
    return this.withLock(async () => {
      if (route.target.type === 'connection') await this.connections.get(route.target.connection_id)
      else {
        if (!this.groups) throw new Error('Mirror Groups are unavailable.')
        const group = await this.groups.get(route.target.mirror_group_id)
        if (group.state === 'archived') {
          throw new Error('Archived Mirror Groups cannot receive Discord sources.')
        }
        if (route.enabled && group.state !== 'active') {
          throw new Error('Enable this Discord source only after its Mirror Group is active.')
        }
      }
      return this.routes.save(route, {
        ...(expectedPreviousTargetKey
          ? { expected_previous_target_key: expectedPreviousTargetKey }
          : {}),
      })
    })
  }

  async removeRoute(routeId: string): Promise<boolean> {
    return this.withLock(() => this.routes.remove(routeId))
  }

  async removeConnection(
    connectionId: string,
    remove: () => Promise<boolean>,
  ): Promise<boolean> {
    return this.withLock(async () => {
      const attachedRoutes = (await this.routes.list())
        .filter((route) => route.target.type === 'connection' && route.target.connection_id === connectionId)
      if (attachedRoutes.length > 0) {
        throw new Error('Remove this account’s Discord sources before removing the trading account.')
      }
      if (await this.hasUnresolvedExecution(connectionId)) {
        throw new Error('Resolve or close this account’s execution records before removing the trading account.')
      }
      const attachedGroups = this.groups
        ? (await this.groups.list()).filter((group) => (
            group.state !== 'archived'
            && group.members.some((member) => member.connection_id === connectionId)
          ))
        : []
      if (attachedGroups.length > 0) {
        throw new Error('Remove this account from active Mirror Group revisions before removing it.')
      }
      return remove()
    })
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined)
      .then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
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

export function resolveMarketDataLaunch(options: ResolveMarketDataLaunchOptions): {
  command: [string, ...string[]]
  cwd: string
  mode: 'development'
} {
  for (const root of options.rootCandidates) {
    const sidecarRoot = path.join(root, 'sidecars', 'market-data-engine')
    const python = options.platform === 'win32'
      ? path.join(sidecarRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(sidecarRoot, '.venv', 'bin', 'python')
    const moduleEntrypoint = path.join(sidecarRoot, 'src', 'trade_god_market_data', 'cli.py')
    const fixtureRoot = path.join(root, 'packages', 'trading-testkit', 'fixtures', 'es-demo')
    if (existsSync(python) && existsSync(moduleEntrypoint) && existsSync(path.join(fixtureRoot, 'manifest.json'))) {
      return {
        command: [python, '-m', 'trade_god_market_data.cli', '--fixture-root', fixtureRoot],
        cwd: sidecarRoot,
        mode: 'development',
      }
    }
  }
  throw new Error('Market Data sidecar runtime was not found in the configured RunnerOS roots.')
}

export function createTradeGodRuntime(options: RuntimeOptions): {
  manager: OrderFlowSidecarManager
  marketDataManager?: MarketDataSidecarManager
  canonicalPipeline?: CanonicalOrderFlowPipeline
  contextStore?: AgentContextStore
  specialistContextPipeline?: SpecialistContextPipeline
  orderFlowSpecialist?: OrderFlowSpecialist
  orderFlowSpecialistPipeline?: OrderFlowSpecialistPipeline
  alertLedger?: TradeAlertLedger
  ingestDiscoTraderTicketPush?: (input: unknown) => Promise<ExecutionRecord | MirrorExecutionPreview>
  ingestDiscordManagementPush?: (input: unknown) => Promise<DiscordManagementDispatchResult>
  emergencyHalt: () => Promise<void>
  setSpecialistModel: (model: SpecialistModel) => void
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
    ...(options.receiptDirectory ? { receiptWriter: new TradingRunReceiptStore(options.receiptDirectory) } : {}),
    ...(options.log ? { log: options.log } : {}),
  })
  let marketDataManager: MarketDataSidecarManager | undefined
  try {
    const marketLaunch = resolveMarketDataLaunch({
      rootCandidates: options.rootCandidates,
      platform: process.platform,
    })
    marketDataManager = new MarketDataSidecarManager({
      command: marketLaunch.command,
      cwd: marketLaunch.cwd,
      requestTimeoutMs: 5_000,
      maxLineBytes: MARKET_JSONL_SUPERVISOR_MAX_LINE_BYTES,
      maxStderrBytes: 16_384,
      env: { PYTHONUNBUFFERED: '1' },
    })
  } catch {
    // Packaged Python assets are intentionally unavailable until their bundle is built and smoked.
  }

  const canonicalPipeline = marketDataManager
    ? new CanonicalOrderFlowPipeline(marketDataManager, manager)
    : undefined
  const contextStore = options.contextDirectory ? new AgentContextStore(options.contextDirectory, options.now) : undefined
  const specialistContextPipeline = marketDataManager && contextStore
    ? new SpecialistContextPipeline(marketDataManager, contextStore)
    : undefined
  let specialistModel = options.specialistModel
  const modelGateway: SpecialistModel = (request) => {
    if (!specialistModel) throw new Error('Trade God specialist model provider is not configured.')
    return specialistModel(request)
  }
  const orderFlowSpecialist = canonicalPipeline && specialistContextPipeline && contextStore
    ? new OrderFlowSpecialist(modelGateway, options.now, options.interpretationDirectory)
    : undefined
  const orderFlowSpecialistPipeline = canonicalPipeline && specialistContextPipeline && contextStore && orderFlowSpecialist
    ? new OrderFlowSpecialistPipeline(canonicalPipeline, contextStore, orderFlowSpecialist, options.now)
    : undefined
  const alertLedger = options.alertDirectory
    ? new TradeAlertLedger(options.alertDirectory, options.now)
    : undefined
  const tradingConnectionStore = options.connectionDirectory
    ? new FileTradingConnectionStore(options.connectionDirectory, options.now)
    : undefined
  const tradingSignalRouteStore = options.connectionDirectory
    ? new TradingSignalRouteStore(options.connectionDirectory, options.now)
    : undefined
  const mirrorGroupStore = options.executionDirectory && tradingConnectionStore
    ? new FileMirrorGroupStore(
        options.executionDirectory,
        (connectionId) => tradingConnectionStore.get(connectionId),
        options.now,
      )
    : undefined
  const mirrorPreviewCoordinator = options.executionDirectory && tradingConnectionStore
    ? new FileMirrorPreviewCoordinator(
        options.executionDirectory,
        (connectionId) => tradingConnectionStore.get(connectionId),
      )
    : undefined
  const sourceExecutionBindingStore = options.executionDirectory
    ? new FileSourceExecutionBindingStore(options.executionDirectory, options.now)
    : undefined
  const executionProcessInstanceId = randomUUID()
  const mirrorExecutionStore = options.executionDirectory
    ? new FileMirrorExecutionStore(options.executionDirectory, options.now, executionProcessInstanceId)
    : undefined
  const executionStore = options.executionDirectory
    ? new FileExecutionStore(options.executionDirectory, options.now, executionProcessInstanceId)
    : undefined
  const tradingConnectionService = (
    tradingConnectionStore
    && options.credentialVault
    && options.tradingBrowserSessionLauncher
  )
    ? new TradingConnectionService(
        tradingConnectionStore,
        options.credentialVault,
        options.tradingBrowserSessionLauncher,
        new FileAdapterCertificationStore(options.connectionDirectory!, options.now),
        undefined,
        options.now,
      )
    : undefined
  const executionGateway = executionStore && tradingConnectionStore
    ? new ExecutionGateway({
        store: executionStore,
        resolveConnection: (connectionId) => tradingConnectionStore.get(connectionId),
        // Observe-only receiver foundation. Provider adapters are attached only
        // after their exact paper connection has passed certification.
        adapters: options.executionAdapters ?? [],
        ...(mirrorExecutionStore
          ? { resolveMirrorDispatchGrant: (grantId: string) => mirrorExecutionStore.getGrant(grantId) }
          : {}),
        now: options.now,
      })
    : undefined
  const standingAuthorizationStore = options.executionDirectory
    ? new FileStandingAuthorizationStore(
        path.join(options.executionDirectory, 'authorizations'),
        options.now,
      )
    : undefined
  const paperExecutionCoordinator = executionGateway && standingAuthorizationStore
    ? new PaperExecutionCoordinator(
        executionGateway,
        standingAuthorizationStore,
        () => Boolean(options.executionAdapters?.length),
      )
    : undefined
  const reconciliationSupervisor = executionGateway && options.executionAdapters?.length
    ? new ExecutionReconciliationSupervisor({ gateway: executionGateway, now: options.now })
    : undefined
  const removableExecutionStates = new Set([
    'risk-denied', 'closed', 'rejected', 'canceled', 'expired', 'error',
  ])
  const tradingRouteMutations = tradingConnectionStore && tradingSignalRouteStore
    ? new TradingRouteMutationCoordinator(
        tradingConnectionStore,
        tradingSignalRouteStore,
        async (connectionId) => executionGateway
          ? (await executionGateway.list()).some((record) => (
              record.intent.connection_id === connectionId
              && !removableExecutionStates.has(record.state)
            ))
          : false,
        mirrorGroupStore,
      )
    : undefined
  const discordManagementSource = executionGateway && options.executionDirectory
    ? new FileDiscoTraderIntentSource(
        path.join(options.executionDirectory, 'discotrader-sources'),
        executionGateway,
        options.now,
      )
    : undefined
  const resolveDiscoTraderRoute = discordManagementSource && tradingConnectionStore
    ? async (ticket: DiscoTraderTicket): Promise<
        | { type: 'connection'; route: DiscoTraderIntentRoute; binding?: SourceExecutionBinding }
        | {
            type: 'mirror-group'
            routeId: string
            group: MirrorGroup
            instrument: DiscoTraderIntentRoute['instrument']
            binding?: SourceExecutionBinding
          }
      > => {
        const sourceIdentity = resolveDiscordSourceIdentity(ticket)
        const binding = await sourceExecutionBindingStore?.getBySource(sourceIdentity)
          ?? await sourceExecutionBindingStore?.getByTicket(ticket.id)
        if (binding && binding.ticket_checksum !== sha256(ticket)) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            'Discord source event was replayed with different ticket evidence.',
          )
        }
        let resolvedInstrument = binding?.instrument
        if (!resolvedInstrument) {
          const contract = resolveFuturesContractIdentity(ticket.tradedSymbol, options.now())
          if (contract.expiry && contract.active === false) {
            throw new ExecutionGatewayError(
              'CAPABILITY_UNAVAILABLE',
              `DiscoTrader contract ${contract.symbol} is expired for the current trading month.`,
            )
          }
          const instrument = DISCOTRADER_FUTURES_INSTRUMENT[contract.root]
          const economics = resolveFuturesEconomicSpec(contract.root)
          if (!instrument || !economics) {
            throw new ExecutionGatewayError(
              'CAPABILITY_UNAVAILABLE',
              `DiscoTrader symbol ${contract.symbol} has no configured Trade God instrument route.`,
            )
          }
          resolvedInstrument = {
            canonical_id: `${instrument.venue}:${contract.symbol}`,
            symbol: contract.symbol,
            exchange: instrument.exchange,
            ...(contract.expiry ? { expiry: contract.expiry } : {}),
            tick_size: economics.tick_size,
            point_value_usd: economics.point_value_usd,
          }
        }
        if (binding?.target.type === 'mirror-group') {
          if (!mirrorGroupStore || !mirrorPreviewCoordinator) {
            throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', 'Mirror Group preview is unavailable.')
          }
          const group = await mirrorGroupStore.getRevision(
            binding.target.mirror_group_id,
            binding.target.mirror_group_revision,
          )
          if (group.content_checksum !== binding.target.group_snapshot_checksum) {
            throw new ExecutionGatewayError(
              'RECORD_INTEGRITY_FAILURE',
              'Frozen Mirror Group revision no longer matches its source binding.',
            )
          }
          return {
            type: 'mirror-group',
            routeId: binding.route_id,
            group,
            instrument: resolvedInstrument,
            binding,
          }
        }
        if (binding?.target.type === 'connection') {
          const selected = await tradingConnectionStore.get(binding.target.connection_id).catch(() => undefined)
          if (!selected) {
            throw new ExecutionGatewayError(
              'CONNECTION_UNAVAILABLE',
              `Frozen Discord source binding targets missing connection ${binding.target.connection_id}.`,
            )
          }
          if (!selected.enabled || selected.state !== 'ready') {
            throw new ExecutionGatewayError(
              'CONNECTION_UNAVAILABLE',
              'Frozen DiscoTrader connection is not enabled and ready.',
            )
          }
          return {
            type: 'connection',
            route: {
              connection_id: selected.connection_id,
              source_id: binding.route_id,
              instrument: resolvedInstrument,
              valid_for_ms: options.discoTraderIntentValidityMs ?? 60_000,
            },
            binding,
          }
        }
        const sourceRoute = await tradingSignalRouteStore?.resolve(
          ticket.provenance.channelUrl,
          ticket.provenance.authorId,
        )
        if (!sourceRoute) {
          throw new ExecutionGatewayError(
            'CONNECTION_UNAVAILABLE',
            'DiscoTrader entry requires an explicit enabled Discord source route.',
          )
        }
        if (sourceRoute.target.type === 'mirror-group') {
          if (!mirrorGroupStore || !mirrorPreviewCoordinator) {
            throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', 'Mirror Group preview is unavailable.')
          }
          return {
            type: 'mirror-group',
            routeId: sourceRoute.route_id,
            group: await mirrorGroupStore.get(sourceRoute.target.mirror_group_id),
            instrument: resolvedInstrument,
          }
        }
        const selected = await tradingConnectionStore.get(sourceRoute.target.connection_id).catch(() => undefined)
        if (!selected) {
          throw new ExecutionGatewayError(
            'CONNECTION_UNAVAILABLE',
            `Discord route ${sourceRoute.display_name} targets missing connection ${sourceRoute.target.connection_id}.`,
          )
        }
        if (!selected.enabled || selected.state !== 'ready') {
          throw new ExecutionGatewayError(
            'CONNECTION_UNAVAILABLE',
            'Configured DiscoTrader connection is not enabled and ready.',
          )
        }
        return {
          type: 'connection',
          route: {
            connection_id: selected.connection_id,
            source_id: sourceRoute.route_id,
            instrument: resolvedInstrument,
            valid_for_ms: options.discoTraderIntentValidityMs ?? 60_000,
          },
        }
      }
    : undefined
  const discordTradeManager = executionGateway && discordManagementSource && options.executionDirectory
    ? new FileDiscordTradeManager({
        directory: path.join(options.executionDirectory, 'discord-management'),
        gateway: executionGateway,
        source: discordManagementSource,
        now: options.now,
      })
    : undefined
  const mirrorDiscordTradeManager = executionGateway && mirrorExecutionStore && options.executionDirectory
    ? new FileMirrorDiscordTradeManager({
        directory: path.join(options.executionDirectory, 'discord-mirror-management'),
        gateway: executionGateway,
        store: mirrorExecutionStore,
        now: options.now,
      })
    : undefined
  const discordManagementFamilyResolver = (
    discordTradeManager
    && mirrorDiscordTradeManager
    && options.executionDirectory
  ) ? new FileDiscordManagementFamilyResolver({
      directory: path.join(options.executionDirectory, 'discord-management-families'),
      single: discordTradeManager,
      mirror: mirrorDiscordTradeManager,
      now: options.now,
    }) : undefined
  let executionRecoveryError: unknown
  const executionRecoveryReady = executionGateway && executionStore
    ? Promise.all([
        executionStore.recoverStaleLocks(),
        mirrorExecutionStore?.recoverStaleLocks() ?? Promise.resolve(0),
      ]).then(() => executionGateway.recoverNonTerminal()).catch((error) => {
        executionRecoveryError = error
      })
    : Promise.resolve()
  const executionSupervisionReady = executionRecoveryReady.then(() => {
    if (executionRecoveryError) throw executionRecoveryError
    reconciliationSupervisor?.start()
  })
  let discordManagementRecoveryError: unknown
  const discordManagementReady = discordTradeManager && mirrorDiscordTradeManager && discordManagementFamilyResolver
    ? executionSupervisionReady.then(async () => {
        if (executionRecoveryError) throw executionRecoveryError
        await discordTradeManager.recoverPending()
        await mirrorDiscordTradeManager.recoverPending()
        await discordManagementFamilyResolver.recoverPending()
      }).catch((error) => {
          discordManagementRecoveryError = error
        })
    : Promise.resolve()
  const unsubscribeAlert = alertLedger && options.onAlert
    ? alertLedger.subscribe(options.onAlert)
    : undefined
  let alertServerError: unknown
  const alertPort = Number.isFinite(options.alertPort) ? Number(options.alertPort) : 9102
  const alertServerPromise: Promise<TradeAlertServerHandle | null> = alertLedger
    ? startTradeAlertServer({
        port: alertPort,
        host: options.alertHost ?? '127.0.0.1',
        ledger: alertLedger,
        ...(options.alertToken ? { token: options.alertToken } : {}),
      }).catch((error) => {
        alertServerError = error
        return null
      })
    : Promise.resolve(null)
  let alertTunnelError: unknown
  const alertTunnelPromise: Promise<TradeAlertTunnelHandle | null> = options.alertTunnelEnabled
    ? alertServerPromise.then((server) => {
        if (!server) return null
        return startTradeAlertTunnel({
          localUrl: server.url,
          webhookPath: new URL(server.webhookUrl).pathname,
          ...(options.alertTunnelExecutable ? { executable: options.alertTunnelExecutable } : {}),
          ...(options.alertDirectory ? { configDirectory: options.alertDirectory } : {}),
          ...(options.alertTunnelLogger ? { logger: options.alertTunnelLogger } : {}),
        })
      }).catch((error) => {
        alertTunnelError = error
        return null
      })
    : Promise.resolve(null)

  const getAlertStatus = async (): Promise<TradeAlertIngestionStatus> => {
    const [server, tunnel] = await Promise.all([alertServerPromise, alertTunnelPromise])
    return toTradeAlertIngestionStatus(server, alertServerError, tunnel, alertTunnelError)
  }
  const getAlertSetup = async (): Promise<TradeAlertWebhookSetup> => {
    const [server, tunnel] = await Promise.all([alertServerPromise, alertTunnelPromise])
    if (!server) throw new Error('Trade God alert receiver is unavailable.')
    const publicUrl = tunnel?.isConnected() ? tunnel.webhookUrl : undefined
    return {
      delivery_url: publicUrl ?? server.webhookUrl,
      local_url: server.webhookUrl,
      ...(publicUrl ? { public_url: publicUrl } : {}),
      json_body_template: JSON.stringify({
        secret: server.token,
        ticker: '{{ticker}}',
        exchange: '{{exchange}}',
        interval: '{{interval}}',
        price: '{{close}}',
        time: '{{time}}',
        message: 'TradingView alert for {{ticker}} at {{close}}',
      }, null, 2),
    }
  }

  const ipcManager: TradingIpcManager = {
    health: () => manager.health(),
    analyzeFixture: (input) => canonicalPipeline
      ? canonicalPipeline.analyzeFixture(input)
      : manager.analyzeFixture(input),
    ...(orderFlowSpecialistPipeline
      ? { interpretFixture: (input) => orderFlowSpecialistPipeline.interpretFixture(input) }
      : {}),
    cancelAnalysis: (cancellationId) => manager.cancelAnalysis(cancellationId),
    ...(alertLedger
      ? {
          listAlerts: (limit) => alertLedger.list(limit),
          acknowledgeAlert: (alertId) => alertLedger.acknowledge(alertId),
          getAlertIngestionStatus: getAlertStatus,
          getAlertWebhookSetup: getAlertSetup,
        }
      : {}),
    ...(marketDataManager
      ? { getIbkrGatewayHealth: (environment) => marketDataManager.ibkrGatewayHealth(environment) }
      : {}),
    getSyntheticChartFixture: (input) => Promise.resolve(buildSyntheticEsChartFixture(input)),
    ...(tradingConnectionService
      ? {
          listTradingConnections: () => tradingConnectionService.list(),
          saveTradingConnection: (input) => tradingConnectionService.save(input),
          removeTradingConnection: (connectionId) => tradingRouteMutations!.removeConnection(
            connectionId,
            () => tradingConnectionService.remove(connectionId),
          ),
          openTradingConnectionLogin: (connectionId) => (
            tradingConnectionService.openBrowserLogin(connectionId)
          ),
          confirmTradingConnectionLogin: (connectionId) => (
            tradingConnectionService.confirmBrowserLogin(connectionId)
          ),
          listTradingSignalRoutes: () => tradingSignalRouteStore!.list(),
          saveTradingSignalRoute: (route, expectedPreviousTargetKey) => (
            tradingRouteMutations!.saveRoute(route, expectedPreviousTargetKey)
          ),
          removeTradingSignalRoute: (routeId) => tradingRouteMutations!.removeRoute(routeId),
          ...(mirrorGroupStore
            ? {
                listMirrorGroups: () => mirrorGroupStore.list(),
                saveMirrorGroup: (input: SaveMirrorGroupInput) => tradingRouteMutations!.saveMirrorGroup(input),
              }
            : {}),
        }
      : {}),
    ...(options.credentialVault
      ? {
          getDiscoTraderWebhookSecretStatus: async () => ({
            configured: Boolean(await options.credentialVault!.getSecret(DISCOTRADER_WEBHOOK_SECRET_REF)),
          }),
          saveDiscoTraderWebhookSecret: async (secret: string) => {
            await options.credentialVault!.setSecret(DISCOTRADER_WEBHOOK_SECRET_REF, secret)
            return { configured: true as const }
          },
        }
      : {}),
    ...(executionGateway
      ? {
          getExecutionControl: async () => ({
            ...await executionGateway.readControl(),
            provider_adapters_attached: Boolean(options.executionAdapters?.length),
            ...(reconciliationSupervisor
              ? { reconciliation_health: reconciliationSupervisor.health() }
              : {}),
          }),
          setGlobalExecutionKill: async (enabled: boolean) => {
            await executionGateway.setGlobalKill(enabled)
            if (!enabled) await paperExecutionCoordinator?.coordinatePending()
            return { global_kill: enabled }
          },
          setConnectionExecutionKill: async (connectionId: string, enabled: boolean) => {
            await tradingConnectionStore!.get(connectionId)
            if (
              !enabled
              && !reconciliationSupervisor?.canReleaseConnectionHalt(connectionId)
            ) {
              throw new ExecutionGatewayError(
                'CONNECTION_UNAVAILABLE',
                'Account halt release requires fresh reconciled provider truth from the active adapter.',
              )
            }
            await executionGateway.setConnectionKill(connectionId, enabled)
            return { connection_id: connectionId, killed: enabled }
          },
        }
      : {}),
    ...(standingAuthorizationStore && tradingConnectionStore
      ? {
          listStandingAuthorizations: () => standingAuthorizationStore.list(),
          saveStandingAuthorization: async (authorization: ExecutionAuthorization) => {
            const connection = await tradingConnectionStore.get(authorization.connection_id)
            if (
              connection.environment !== 'paper'
              || connection.environment_class !== 'rehearsal'
              || !connection.enabled
              || connection.state !== 'ready'
              || !connection.certifications.includes('paper-lifecycle-certified')
            ) {
              throw new ExecutionGatewayError(
                'CERTIFICATION_REQUIRED',
                'Standing mandates require an enabled, ready, paper-lifecycle-certified paper account.',
              )
            }
            const saved = await paperExecutionCoordinator!.saveAuthorization(authorization)
            await paperExecutionCoordinator?.coordinatePending()
            return saved
          },
          revokeStandingAuthorization: (connectionId: string) => (
            paperExecutionCoordinator!.revokeAuthorization(connectionId)
          ),
        }
      : {}),
    stop: () => manager.stop(),
  }
  const disposeTradingIpc = registerTradingIpc(options.ipcMain, ipcManager)
  return {
    manager,
    ...(marketDataManager ? { marketDataManager } : {}),
    ...(canonicalPipeline ? { canonicalPipeline } : {}),
    ...(contextStore ? { contextStore } : {}),
    ...(specialistContextPipeline ? { specialistContextPipeline } : {}),
    ...(orderFlowSpecialist ? { orderFlowSpecialist } : {}),
    ...(orderFlowSpecialistPipeline ? { orderFlowSpecialistPipeline } : {}),
    ...(alertLedger ? { alertLedger } : {}),
    ...(discordTradeManager && discordManagementFamilyResolver
      ? {
          ingestDiscoTraderTicketPush: async (input: unknown) => {
            await executionSupervisionReady
            if (executionRecoveryError) throw executionRecoveryError
            const payload = discoTraderPushPayloadSchema.parse(input)
            if (payload.kind !== 'ticket' || !payload.ticket || !resolveDiscoTraderRoute) {
              throw new ExecutionGatewayError(
                'CAPABILITY_UNAVAILABLE',
                'Only a configured DiscoTrader ticket push can create a gateway intent.',
              )
            }
            const sourceIdentity = resolveDiscordSourceIdentity(payload.ticket)
            const captured = await tradingRouteMutations!.captureRoutingSnapshot(async () => {
              const resolved = await resolveDiscoTraderRoute(payload.ticket!)
              if (resolved.type === 'mirror-group') {
                if (!resolved.binding && resolved.group.state !== 'active') {
                  throw new ExecutionGatewayError(
                    'CONNECTION_UNAVAILABLE',
                    'Mirror Group must be active before a Discord ticket can bind to it.',
                  )
                }
                const receivedAt = resolved.binding?.received_at ?? options.now()
                if (!resolved.binding) {
                  convertDiscoTraderTicket(payload.ticket!, {
                    connection_id: 'mirror-preview-validation',
                    source_id: resolved.routeId,
                    instrument: resolved.instrument,
                    valid_for_ms: 5 * 60_000,
                  }, receivedAt)
                }
                const binding = resolved.binding ?? await sourceExecutionBindingStore!.bind({
                  source_type: 'discord',
                  ...sourceIdentity,
                  ticket_id: payload.ticket!.id,
                  ticket_checksum: sha256(payload.ticket),
                  route_id: resolved.routeId,
                  instrument: resolved.instrument,
                  received_at: receivedAt,
                  target: {
                    type: 'mirror-group',
                    mirror_group_id: resolved.group.mirror_group_id,
                    mirror_group_revision: resolved.group.revision,
                    group_snapshot_checksum: resolved.group.content_checksum,
                    mirror_execution_id: mirrorExecutionIdFor(payload.ticket!, resolved.group),
                  },
                })
                return { type: 'mirror-group' as const, resolved, binding }
              }
              const receivedAt = resolved.binding?.received_at ?? options.now()
              const projected = convertDiscoTraderTicket(
                payload.ticket!,
                resolved.route,
                receivedAt,
              )
              const binding = resolved.binding ?? await sourceExecutionBindingStore!.bind({
                source_type: 'discord',
                ...sourceIdentity,
                ticket_id: payload.ticket!.id,
                ticket_checksum: sha256(payload.ticket),
                route_id: resolved.route.source_id,
                instrument: resolved.route.instrument,
                received_at: receivedAt,
                target: {
                  type: 'connection',
                  connection_id: resolved.route.connection_id,
                  intent_id: projected.intent.intent_id,
                },
              })
              return { type: 'connection' as const, resolved, binding, projected }
            })
            const { resolved, binding } = captured
            if (resolved.type === 'mirror-group') {
              const preview = await mirrorPreviewCoordinator!.preview({
                ticket: payload.ticket,
                route_id: resolved.routeId,
                group: resolved.group,
                instrument: resolved.instrument,
                received_at: binding.received_at,
              })
              if (
                binding.target.type !== 'mirror-group'
                || preview.mirror_execution_id !== binding.target.mirror_execution_id
              ) {
                throw new ExecutionGatewayError(
                  'RECORD_INTEGRITY_FAILURE',
                  'Mirror preview does not match its frozen source binding.',
                )
              }
              await sourceExecutionBindingStore!.markMaterialized(binding.binding_id, sourceIdentity)
              return preview
            }
            const result = await discordManagementSource!.ingestPush(
              input,
              resolved.route,
              undefined,
              binding.received_at,
            )
            if (
              binding.target.type !== 'connection'
              || result.record.intent.intent_id !== binding.target.intent_id
            ) {
              throw new ExecutionGatewayError(
                'RECORD_INTEGRITY_FAILURE',
                'Gateway intent does not match its frozen source binding.',
              )
            }
            await sourceExecutionBindingStore!.markMaterialized(binding.binding_id, sourceIdentity)
            return paperExecutionCoordinator
              ? paperExecutionCoordinator.coordinate(result.record.intent.intent_id)
              : result.record
          },
          ingestDiscordManagementPush: async (input: unknown) => {
            await discordManagementReady
            if (discordManagementRecoveryError) throw discordManagementRecoveryError
            const payload = discoTraderPushPayloadSchema.parse(input)
            if (payload.kind !== 'management' || !payload.management) {
              return discordTradeManager.ingestPush(payload)
            }
            return tradingRouteMutations
              ? tradingRouteMutations.captureRoutingSnapshot(() => (
                  discordManagementFamilyResolver.ingestPush(payload)
                ))
              : discordManagementFamilyResolver.ingestPush(payload)
          },
        }
      : {}),
    emergencyHalt: async () => {
      if (executionGateway) await executionGateway.activateEmergencyHalt()
    },
    setSpecialistModel: (model) => { specialistModel = model },
    dispose: async () => {
      unsubscribeAlert?.()
      await discordManagementReady
      await reconciliationSupervisor?.stop()
      const [alertServer, alertTunnel] = await Promise.all([alertServerPromise, alertTunnelPromise])
      await Promise.all([disposeTradingIpc(), marketDataManager?.stop(), alertTunnel?.stop(), alertServer?.stop()])
    },
  }
}

const DISCOTRADER_FUTURES_INSTRUMENT: Readonly<Record<
  string,
  { venue: string; exchange: string }
>> = Object.freeze({
  ES: { venue: 'CME', exchange: 'XCME' },
  MES: { venue: 'CME', exchange: 'XCME' },
  NQ: { venue: 'CME', exchange: 'XCME' },
  MNQ: { venue: 'CME', exchange: 'XCME' },
  YM: { venue: 'CBOT', exchange: 'XCBT' },
  MYM: { venue: 'CBOT', exchange: 'XCBT' },
  RTY: { venue: 'CME', exchange: 'XCME' },
  M2K: { venue: 'CME', exchange: 'XCME' },
})

const resolveDiscordSourceIdentity = (ticket: DiscoTraderTicket): {
  server_id: string
  channel_id: string
  author_id: string
  message_id: string
} => {
  if (!ticket.provenance.authorId) {
    throw new ExecutionGatewayError('AUTHORIZATION_MISMATCH', 'Discord source lacks an immutable author ID.')
  }
  let url: URL
  try { url = new URL(ticket.provenance.channelUrl) } catch {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Discord source URL is invalid.')
  }
  if (
    url.protocol !== 'https:'
    || !['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)
  ) {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Discord source URL is not an approved Discord origin.')
  }
  const match = /^\/channels\/(\d{1,25})\/(\d{1,25})(?:\/|$)/.exec(url.pathname)
  if (!match) {
    throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Discord source URL lacks immutable server and channel IDs.')
  }
  return {
    server_id: match[1]!,
    channel_id: match[2]!,
    author_id: ticket.provenance.authorId,
    message_id: ticket.provenance.messageId,
  }
}
