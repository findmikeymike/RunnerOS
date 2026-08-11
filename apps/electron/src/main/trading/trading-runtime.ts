import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  discoTraderPushPayloadSchema,
  MARKET_JSONL_SUPERVISOR_MAX_LINE_BYTES,
  type DiscoTraderTicket,
  type DiscordManagementReceipt,
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
  FileExecutionStore,
  FileTradingConnectionStore,
  type DiscoTraderIntentRoute,
} from '@trade-god/execution'

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
  ) {}

  async saveRoute(
    route: TradingSignalRoute,
    expectedPreviousConnectionId?: string,
  ): Promise<TradingSignalRoute> {
    return this.withLock(async () => {
      await this.connections.get(route.connection_id)
      return this.routes.save(route, {
        ...(expectedPreviousConnectionId
          ? { expected_previous_connection_id: expectedPreviousConnectionId }
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
        .filter((route) => route.connection_id === connectionId)
      if (attachedRoutes.length > 0) {
        throw new Error('Remove this account’s Discord sources before removing the trading account.')
      }
      if (await this.hasUnresolvedExecution(connectionId)) {
        throw new Error('Resolve or close this account’s execution records before removing the trading account.')
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
  ingestDiscoTraderTicketPush?: (input: unknown) => Promise<ExecutionRecord>
  ingestDiscordManagementPush?: (input: unknown) => Promise<DiscordManagementReceipt>
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
  const executionGateway = options.executionDirectory && tradingConnectionStore
    ? new ExecutionGateway({
        store: new FileExecutionStore(options.executionDirectory, options.now),
        resolveConnection: (connectionId) => tradingConnectionStore.get(connectionId),
        // Observe-only receiver foundation. Provider adapters are attached only
        // after their exact paper connection has passed certification.
        adapters: [],
        now: options.now,
      })
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
    ? async (ticket: DiscoTraderTicket): Promise<DiscoTraderIntentRoute> => {
        const connections = await tradingConnectionStore.list()
        const sourceRoute = await tradingSignalRouteStore?.resolve(
          ticket.provenance.channelUrl,
          ticket.provenance.authorId,
        )
        const selected = sourceRoute
          ? connections.find(({ connection_id }) => connection_id === sourceRoute.connection_id)
          : undefined
        if (!sourceRoute || !selected) {
          throw new ExecutionGatewayError(
            'CONNECTION_UNAVAILABLE',
            sourceRoute
              ? `Discord route ${sourceRoute.display_name} targets missing connection ${sourceRoute.connection_id}.`
              : 'DiscoTrader entry requires an explicit enabled Discord source-to-account route.',
          )
        }
        if (!selected.enabled || selected.state !== 'ready') {
          throw new ExecutionGatewayError(
            'CONNECTION_UNAVAILABLE',
            'Configured DiscoTrader connection is not enabled and ready.',
          )
        }
        const contract = resolveFuturesContractIdentity(
          ticket.tradedSymbol,
          options.now(),
        )
        if (contract.expiry && contract.active === false) {
          throw new ExecutionGatewayError(
            'CAPABILITY_UNAVAILABLE',
            `DiscoTrader contract ${contract.symbol} is expired for the current trading month.`,
          )
        }
        const symbol = contract.symbol
        const instrument = DISCOTRADER_FUTURES_INSTRUMENT[contract.root]
        const economics = resolveFuturesEconomicSpec(contract.root)
        if (!instrument || !economics) {
          throw new ExecutionGatewayError(
            'CAPABILITY_UNAVAILABLE',
            `DiscoTrader symbol ${symbol} has no configured Trade God instrument route.`,
          )
        }
        return {
          connection_id: selected.connection_id,
          source_id: sourceRoute.route_id,
          instrument: {
            canonical_id: `${instrument.venue}:${symbol}`,
            symbol,
            exchange: instrument.exchange,
            ...(contract.expiry ? { expiry: contract.expiry } : {}),
            tick_size: economics.tick_size,
            point_value_usd: economics.point_value_usd,
          },
          valid_for_ms: options.discoTraderIntentValidityMs ?? 60_000,
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
  let executionRecoveryError: unknown
  const executionRecoveryReady = executionGateway
    ? executionGateway.recoverNonTerminal().catch((error) => {
        executionRecoveryError = error
      })
    : Promise.resolve()
  let discordManagementRecoveryError: unknown
  const discordManagementReady = discordTradeManager
    ? executionRecoveryReady.then(async () => {
        if (executionRecoveryError) throw executionRecoveryError
        await discordTradeManager.recoverPending()
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
          saveTradingSignalRoute: (route, expectedPreviousConnectionId) => (
            tradingRouteMutations!.saveRoute(route, expectedPreviousConnectionId)
          ),
          removeTradingSignalRoute: (routeId) => tradingRouteMutations!.removeRoute(routeId),
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
          getExecutionControl: () => executionGateway.readControl(),
          setGlobalExecutionKill: async (enabled: boolean) => {
            await executionGateway.setGlobalKill(enabled)
            return { global_kill: enabled }
          },
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
    ...(discordTradeManager
      ? {
          ingestDiscoTraderTicketPush: async (input: unknown) => {
            await executionRecoveryReady
            if (executionRecoveryError) throw executionRecoveryError
            const payload = discoTraderPushPayloadSchema.parse(input)
            if (payload.kind !== 'ticket' || !payload.ticket || !resolveDiscoTraderRoute) {
              throw new ExecutionGatewayError(
                'CAPABILITY_UNAVAILABLE',
                'Only a configured DiscoTrader ticket push can create a gateway intent.',
              )
            }
            const route = await resolveDiscoTraderRoute(payload.ticket)
            const result = await discordManagementSource!.ingestPush(input, route)
            return result.record
          },
          ingestDiscordManagementPush: async (input: unknown) => {
            await discordManagementReady
            if (discordManagementRecoveryError) throw discordManagementRecoveryError
            return discordTradeManager.ingestPush(input)
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
