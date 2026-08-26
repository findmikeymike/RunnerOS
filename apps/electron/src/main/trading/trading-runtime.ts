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
  type OptionsAutomationReceipt,
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
import { createTradovatePaperRuntime } from './tradovate-paper-runtime.ts'
import { OptionsConnectionService, ReadOnlyOptionsProviderVerifier } from './options-connection-service.ts'
import { OptionsAutomationService } from './options-automation-service.ts'
import { PaperActivationService } from './paper-activation-service.ts'
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
  FileProviderReadVerificationStore,
  FilePaperActivationStore,
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
  FileOptionsCertificationStore,
  FileOptionsCertificationApplicationStore,
  FileProviderOptionsCertificationCoordinator,
  IbkrOptionsAdapter,
  WebullOptionsAdapter,
  FileOptionsManualAuthorityStore,
  FileOptionsDebitReservationStore,
  FileOptionsExecutionStore,
  OptionsExecutionGateway,
  FileOptionsManualOrderCoordinator,
  FileOptionsManagementStore,
  OptionsPositionManager,
  FileOptionsAutomationStore,
  FileOptionsAutopilotAuthorityStore,
  FileOptionsAutopilotCertificationStore,
  OptionsAutopilotActivationService,
  FileOptionsAutomationReceiptStore,
  FileOptionsAutomationPlanStore,
  OptionsAutomaticEntryCoordinator,
  FileDiscordOptionsTradeManager,
  OptionsWorkingOrderSupervisor,
  FileOptionsExpirationCustodyStore,
  OptionsExpirationCustodySupervisor,
  type DiscoTraderIntentRoute,
  type ExecutionAdapter,
  type TradovateUserSyncGap,
  type DiscordManagementDispatchResult,
  type SaveMirrorGroupInput,
  type OptionsProviderAdapter,
} from '@trade-god/execution'

import type {
  ExecutionAuthorization,
  MirrorExecutionPreview,
  MirrorGroup,
  SourceExecutionBinding,
} from '@trade-god/contracts'

export const haltAfterTradovateUserSyncGap = async (
  gateway: Pick<ExecutionGateway, 'setConnectionKill' | 'activateEmergencyHalt'>,
  supervisor: Pick<ExecutionReconciliationSupervisor, 'invalidate'>,
  gap: TradovateUserSyncGap,
): Promise<void> => {
  supervisor.invalidate(gap.connection_id)
  try {
    await gateway.setConnectionKill(gap.connection_id, true)
  } catch {
    try {
      await gateway.activateEmergencyHalt()
    } catch {
      // The gateway latches the process emergency halt before durable I/O.
    }
  }
}

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
  enableTradovatePaperAdapter?: boolean
  optionsSingleInstanceAuthority?: boolean
  optionsProviderAdapterFactory?: (connection: import('@trade-god/contracts').OptionsConnection, credential: Record<string, string>) => OptionsProviderAdapter
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
  private readonly removedConnectionIds = new Set<string>()

  constructor(
    private readonly connections: Pick<FileTradingConnectionStore, 'get'>,
    private readonly routes: Pick<TradingSignalRouteStore, 'list' | 'save' | 'remove'>,
    private readonly hasUnresolvedExecution: (connectionId: string) => Promise<boolean> = async () => false,
    private readonly groups?: Pick<FileMirrorGroupStore, 'get' | 'list' | 'save'>,
  ) {}

  async captureRoutingSnapshot<T>(operation: () => Promise<T>): Promise<T> {
    return this.withLock(operation)
  }

  async saveConnection<T>(connectionId: string, save: () => Promise<T>): Promise<T> {
    return this.withLock(async () => {
      if (this.removedConnectionIds.has(connectionId)) {
        throw new Error('This trading account was removed in the current app session; create a new connection identity.')
      }
      return save()
    })
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
      const removed = await remove()
      if (removed) this.removedConnectionIds.add(connectionId)
      return removed
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
  ingestOptionsEntryPush?: (input: unknown) => Promise<OptionsAutomationReceipt>
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
  let tradovatePaperRuntime: ReturnType<typeof createTradovatePaperRuntime> | undefined
  let attachedExecutionAdapters = options.executionAdapters ?? []
  if (
    options.executionAdapters === undefined
    && options.enableTradovatePaperAdapter === true
    && tradingConnectionStore
    && options.credentialVault
  ) {
    tradovatePaperRuntime = createTradovatePaperRuntime({
      connectionStore: tradingConnectionStore,
      vault: options.credentialVault,
      now: options.now,
    })
    attachedExecutionAdapters = [tradovatePaperRuntime.adapter]
  }
  const certificationRegistry = tradovatePaperRuntime?.certificationRegistry ?? {
    resolve: (connection) => {
      const adapter = attachedExecutionAdapters.find((candidate) => candidate.supports(connection))
      if (!adapter) return null
      return {
        adapter_id: adapter.descriptor.adapter_id,
        adapter_version: adapter.descriptor.adapter_version,
        provider_contract_version: adapter.descriptor.provider_contract_version,
        capabilities: adapter.descriptor.capabilities,
      }
    },
  }
  const providerReadVerificationStore = options.connectionDirectory
    ? new FileProviderReadVerificationStore(options.connectionDirectory, options.now)
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
        certificationRegistry,
        options.now,
        providerReadVerificationStore,
        tradovatePaperRuntime
          ? { verify: (connection) => tradovatePaperRuntime!.verifyReadOnly(connection) }
          : undefined,
      )
    : undefined
  const optionsEvidenceRoot = options.connectionDirectory ? path.join(options.connectionDirectory, 'options') : undefined
  const optionsCertificationStore = optionsEvidenceRoot ? new FileOptionsCertificationStore(optionsEvidenceRoot) : undefined
  const optionsCertificationApplicationStore = optionsEvidenceRoot ? new FileOptionsCertificationApplicationStore(optionsEvidenceRoot, options.now) : undefined
  const optionsManualAuthorityStore = optionsEvidenceRoot ? new FileOptionsManualAuthorityStore(optionsEvidenceRoot, options.now) : undefined
  const optionsAutomationStore = optionsEvidenceRoot ? new FileOptionsAutomationStore(optionsEvidenceRoot) : undefined
  const optionsAutopilotAuthorityStore = optionsEvidenceRoot ? new FileOptionsAutopilotAuthorityStore(optionsEvidenceRoot, options.now) : undefined
  const optionsAutopilotCertificationStore = optionsEvidenceRoot ? new FileOptionsAutopilotCertificationStore(optionsEvidenceRoot) : undefined
  const optionsExpirationCustodyStore = optionsEvidenceRoot ? new FileOptionsExpirationCustodyStore(optionsEvidenceRoot) : undefined
  const optionsAutomationReceiptStore = optionsEvidenceRoot ? new FileOptionsAutomationReceiptStore(optionsEvidenceRoot) : undefined
  const optionsAutomationPlanStore = optionsEvidenceRoot ? new FileOptionsAutomationPlanStore(optionsEvidenceRoot) : undefined
  const optionsAuthorityRecoveryReady = optionsManualAuthorityStore && optionsAutopilotAuthorityStore
    ? options.optionsSingleInstanceAuthority === true
      ? Promise.all([
          optionsManualAuthorityStore.recoverStaleLocks(true),
          optionsAutopilotAuthorityStore.recoverStaleLocks(true),
        ])
      : Promise.resolve([0, 0])
    : Promise.resolve([0, 0])
  // Attach immediately so a startup filesystem failure cannot become an
  // unhandled rejection before the first Options-page call awaits the gate.
  void optionsAuthorityRecoveryReady.catch(() => undefined)
  const optionsConnectionService = optionsEvidenceRoot && options.credentialVault
    ? new OptionsConnectionService(
        optionsEvidenceRoot,
        options.credentialVault,
        new ReadOnlyOptionsProviderVerifier(undefined, options.now),
        options.now,
      )
    : undefined
  const optionsManualRecoveryErrors = new Map<string, string>()
  const optionsAutomaticRecoveryErrors = new Map<string, string>()

  const listOptionsConnectionStatuses = async () => {
    await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady])
    const statuses = await optionsConnectionService!.list()
    return Promise.all(statuses.map(async (status) => {
      const [allEvidence, eligible, application, authority, manualOrders, manualReservations, managementRecords, expirationAssessments] = await Promise.all([
        optionsCertificationStore!.list(status.connection.connection_id),
        optionsCertificationStore!.getEligible(status.connection, options.now()),
        optionsCertificationApplicationStore!.getActive(status.connection, options.now()),
        optionsManualAuthorityStore!.getActive(status.connection, options.now()),
        optionsEvidenceRoot
          ? new FileOptionsExecutionStore(path.join(optionsEvidenceRoot, 'manual-execution', status.connection.connection_id, 'execution')).listRecords()
          : Promise.resolve([]),
        optionsEvidenceRoot
          ? new FileOptionsDebitReservationStore(
              path.join(optionsEvidenceRoot, 'manual-execution', status.connection.connection_id, 'risk'),
              options.now,
              executionProcessInstanceId,
            ).list(status.connection.account_ref)
          : Promise.resolve([]),
        optionsEvidenceRoot
          ? new FileOptionsManagementStore(path.join(optionsEvidenceRoot, 'manual-execution', status.connection.connection_id, 'management')).listRecords()
          : Promise.resolve([]),
        optionsExpirationCustodyStore ? optionsExpirationCustodyStore.listAssessments() : Promise.resolve([]),
      ])
      return {
        ...status,
        certification: eligible && application
          ? {
              state: 'applied' as const,
              certification_id: eligible.certification_id,
              expires_at: eligible.expires_at,
              allowed_contract_id: eligible.allowed_contract_id,
            }
          : eligible
            ? {
                state: 'passed' as const,
                certification_id: eligible.certification_id,
                expires_at: eligible.expires_at,
                allowed_contract_id: eligible.allowed_contract_id,
              }
            : { state: allEvidence.length > 0 ? 'blocked' as const : 'not-run' as const },
        ...(authority
          ? {
              manual_authority: {
                authority_id: authority.authority_id,
                allowed_contract_id: authority.allowed_contract_id,
                max_debit_per_order: authority.max_debit_per_order,
                valid_until: authority.valid_until,
              },
            }
          : {}),
        manual_orders: manualOrders.map((record) => ({
          record_id: record.record_id,
          intent_id: record.intent_id,
          canonical_contract_id: record.canonical_contract_id,
          state: record.state,
          requested_quantity: record.requested_quantity,
          filled_quantity: record.filled_quantity,
          open_quantity: record.open_quantity,
          average_fill_price: record.average_fill_price,
          created_at: record.created_at,
          updated_at: record.updated_at,
          provider_order_id: record.provider_order_id,
        })),
        pending_manual_reviews: manualReservations.filter((reservation) => reservation.state === 'prepared').length,
        management_records: managementRecords,
        expiration_assessments: expirationAssessments.filter((item) => (
          manualOrders.some((candidate) => candidate.intent_id === item.entry_intent_id)
        )),
        ...(optionsManualRecoveryErrors.get(status.connection.connection_id)
          ? { manual_recovery_issue: optionsManualRecoveryErrors.get(status.connection.connection_id)! }
          : {}),
      }
    }))
  }
  let optionsMutationQueue: Promise<void> = Promise.resolve()
  const withOptionsMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = optionsMutationQueue
    let release!: () => void
    optionsMutationQueue = new Promise<void>((resolve) => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
  const optionsConnectionById = async (connectionId: string) => {
    const status = (await optionsConnectionService!.list()).find((candidate) => candidate.connection.connection_id === connectionId)
    if (!status) throw new Error('Options account was not found.')
    return status.connection
  }
  const freshOptionsConnectionById = async (connectionId: string) => {
    const status = (await optionsConnectionService!.list()).find((candidate) => candidate.connection.connection_id === connectionId)
    if (!status) throw new Error('Options account was not found.')
    if (!status.provider_read_fresh) throw new Error('Verify this broker account again before changing paper-trading access.')
    return status.connection
  }
  const optionsProviderAdapter = async (connectionId: string): Promise<{ connection: Awaited<ReturnType<typeof optionsConnectionById>>; adapter: OptionsProviderAdapter }> => {
    const { connection, credential } = await optionsConnectionService!.resolveMainProcessCredential(connectionId)
    const adapter = options.optionsProviderAdapterFactory
      ? options.optionsProviderAdapterFactory(connection, credential)
      : connection.provider === 'ibkr'
      ? new IbkrOptionsAdapter({
          connection_id: connection.connection_id,
          account_id: connection.account_ref,
          access_token: credential.access_token!,
          credential_generation: connection.credential_generation,
          now: options.now,
        })
      : new WebullOptionsAdapter({
          connection_id: connection.connection_id,
          account_id: connection.account_ref,
          app_key: credential.app_key!,
          app_secret: credential.app_secret!,
          ...(credential.access_token ? { access_token: credential.access_token } : {}),
          credential_generation: connection.credential_generation,
          now: options.now,
        })
    return { connection, adapter }
  }
  const optionsAutomaticExecutionRoot = optionsEvidenceRoot ? path.join(optionsEvidenceRoot, 'automatic-execution') : undefined
  const optionsAutomaticRuntime = async (connectionId: string) => {
    if (!optionsAutomaticExecutionRoot) throw new Error('Automatic options execution storage is unavailable.')
    const resolved = await optionsProviderAdapter(connectionId)
    const root = path.join(optionsAutomaticExecutionRoot, connectionId)
    const reservations = new FileOptionsDebitReservationStore(path.join(root, 'risk'), options.now, executionProcessInstanceId)
    const executions = new FileOptionsExecutionStore(path.join(root, 'execution'))
    return {
      ...resolved, reservations, executions,
      gateway: new OptionsExecutionGateway(executions, reservations, resolved.adapter, options.now),
    }
  }
  const optionsAutomaticCoordinator = optionsAutomaticExecutionRoot && optionsAutomationStore
    && optionsAutopilotAuthorityStore && optionsAutomationReceiptStore && optionsAutomationPlanStore
    ? new OptionsAutomaticEntryCoordinator({
        automation: optionsAutomationStore,
        authorities: optionsAutopilotAuthorityStore,
        receipts: optionsAutomationReceiptStore,
        plans: optionsAutomationPlanStore,
        resolveConnection: optionsConnectionById,
        assertConnectionReady: (connectionId) => {
          const timeoutIssue = [...optionsAutomaticRecoveryErrors.entries()]
            .find(([key]) => key.startsWith(`timeout:${connectionId}:`))?.[1]
          const expirationIssue = [...optionsAutomaticRecoveryErrors.entries()]
            .find(([key]) => key.startsWith(`expiration:${connectionId}:`))?.[1]
          const issue = optionsAutomaticRecoveryErrors.get('runtime')
            ?? optionsAutomaticRecoveryErrors.get(connectionId)
            ?? timeoutIssue
            ?? expirationIssue
          if (issue) throw new Error(issue)
        },
        resolveExecution: async (connection) => {
          const resolved = await optionsAutomaticRuntime(connection.connection_id)
          if (resolved.connection.content_checksum !== connection.content_checksum) {
            throw new Error('Options account changed before automatic gateway delivery.')
          }
          return resolved
        },
        now: options.now,
      })
    : undefined
  const optionsAutomationService = optionsAutomationStore && optionsAutomationReceiptStore && optionsAutopilotAuthorityStore
    ? new OptionsAutomationService(
        optionsAutomationStore,
        optionsAutomationReceiptStore,
        optionsConnectionById,
        async (route, policy, connection) => (
          options.optionsSingleInstanceAuthority === true
          && Boolean(await optionsAutopilotAuthorityStore.getActive(route, policy, connection, options.now()))
        ),
        options.now,
        () => optionsExpirationCustodyStore?.listAssessments() ?? Promise.resolve([]),
        async (connection) => {
          if (options.optionsSingleInstanceAuthority !== true) {
            return { ready: false, issue: 'Close the other Trade God window before starting automation.' }
          }
          const [certification, application] = await Promise.all([
            optionsAutopilotCertificationStore?.getEligible(connection, options.now()),
            optionsCertificationApplicationStore?.getActive(connection, options.now()),
          ])
          if (!application) return { ready: false, issue: 'Apply the account safety test first.' }
          if (!certification) return { ready: false, issue: 'Automatic safety test not completed.' }
          if (certification.base_application_id !== application.application_id
            || certification.base_application_checksum !== application.content_checksum) {
            return { ready: false, issue: 'Automatic safety test no longer matches this account.' }
          }
          return { ready: true, expires_at: certification.expires_at }
        },
      )
    : undefined
  const optionsAutopilotActivationService = optionsEvidenceRoot && optionsAutomationStore
    && optionsAutopilotAuthorityStore && optionsAutopilotCertificationStore && optionsCertificationApplicationStore
    ? new OptionsAutopilotActivationService(
        optionsEvidenceRoot, optionsAutomationStore, optionsAutopilotAuthorityStore,
        optionsAutopilotCertificationStore, optionsCertificationApplicationStore, optionsConnectionById, options.now,
      )
    : undefined
  const optionsAutomaticManagementRuntime = async (connectionId: string) => {
    const runtime = await optionsAutomaticRuntime(connectionId)
    const root = path.join(optionsAutomaticExecutionRoot!, connectionId)
    const managementStore = new FileOptionsManagementStore(path.join(root, 'management'))
    return {
      ...runtime,
      managementStore,
      positionManager: new OptionsPositionManager(runtime.executions, managementStore, runtime.reservations, runtime.adapter, options.now),
    }
  }
  const optionsDiscordTradeManager = optionsAutomaticExecutionRoot && optionsAutomationReceiptStore && optionsAutomationPlanStore
    ? new FileDiscordOptionsTradeManager({
        directory: path.join(optionsAutomaticExecutionRoot, 'discord-management'),
        automationReceipts: optionsAutomationReceiptStore,
        automationPlans: optionsAutomationPlanStore,
        resolveRuntime: optionsAutomaticManagementRuntime,
        now: options.now,
      })
    : undefined
  const optionsWorkingOrderSupervisor = optionsAutomationReceiptStore && optionsAutomationPlanStore
    ? new OptionsWorkingOrderSupervisor({
        receipts: optionsAutomationReceiptStore,
        plans: optionsAutomationPlanStore,
        resolveRuntime: async (connectionId) => {
          const runtime = await optionsAutomaticManagementRuntime(connectionId)
          return {
            getRecord: (intentId) => runtime.executions.getRecord(intentId),
            cancelWorkingEntry: (input) => runtime.positionManager.cancelWorkingEntry(input),
          }
        },
        now: options.now,
        onReceiptError: (receipt, error) => {
          const key = receipt.connection_id ? `timeout:${receipt.connection_id}:${receipt.receipt_id}` : 'runtime'
          optionsAutomaticRecoveryErrors.set(key,
            `Automatic options timeout custody is safely blocked: ${error instanceof Error ? error.message : 'Unknown timeout failure'}`)
        },
        onReceiptSuccess: (receipt) => {
          if (receipt.connection_id) optionsAutomaticRecoveryErrors.delete(`timeout:${receipt.connection_id}:${receipt.receipt_id}`)
        },
      })
    : undefined
  const optionsExpirationSupervisor = optionsExpirationCustodyStore && optionsAutomationPlanStore
    && optionsAutopilotCertificationStore
    ? new OptionsExpirationCustodySupervisor({
        store: optionsExpirationCustodyStore,
        plans: async () => {
          const activeIntentIds = new Set((await optionsAutomationReceiptStore!.list())
            .filter((receipt) => receipt.execution_intent_id
              && (receipt.state === 'working' || receipt.state === 'active' || receipt.state === 'halted'))
            .map((receipt) => receipt.execution_intent_id!))
          return (await optionsAutomationPlanStore.list())
            .filter((plan) => activeIntentIds.has(plan.decision.decision_id))
        },
        getRecord: async (connectionId, intentId) => {
          const runtime = await optionsAutomaticManagementRuntime(connectionId)
          return runtime.executions.getRecord(intentId)
        },
        closePosition: async (connectionId, input) => {
          const runtime = await optionsAutomaticManagementRuntime(connectionId)
          return runtime.positionManager.closePosition(input)
        },
        certification: async (connectionId) => {
          const connection = await optionsConnectionById(connectionId)
          return optionsAutopilotCertificationStore.getEligible(connection, options.now())
        },
        now: options.now,
        onError: (connectionId, intentId, error) => {
          optionsAutomaticRecoveryErrors.set(`expiration:${connectionId}:${intentId}`,
            `Expiration custody is safely blocked: ${error instanceof Error ? error.message : 'Unknown custody failure'}`)
        },
        onSuccess: (connectionId, intentId) => {
          optionsAutomaticRecoveryErrors.delete(`expiration:${connectionId}:${intentId}`)
        },
      })
    : undefined
  const revokeOptionsAutopilotForConnection = async (connectionId: string, reason: 'operator' | 'route-change' | 'account-change' | 'credential-change') => {
    if (!optionsAutomationStore || !optionsAutopilotAuthorityStore) return
    for (const route of await optionsAutomationStore.listRoutes()) {
      if (route.connection_id !== connectionId || route.state === 'archived') continue
      const policy = await optionsAutomationStore.getPolicy(route.policy_id, route.policy_revision)
      const connection = await optionsConnectionById(connectionId)
      const authority = await optionsAutopilotAuthorityStore.getActive(route, policy, connection, options.now())
      if (authority) await optionsAutopilotAuthorityStore.revoke(authority, reason)
    }
  }
  const optionsManualExecutionRoot = optionsEvidenceRoot ? path.join(optionsEvidenceRoot, 'manual-execution') : undefined
  const optionsManualCoordinator = async (connectionId: string) => {
    if (!optionsManualExecutionRoot) throw new Error('Options paper-order storage is unavailable.')
    const { connection, adapter } = await optionsProviderAdapter(connectionId)
    const root = path.join(optionsManualExecutionRoot, connectionId)
    const reservations = new FileOptionsDebitReservationStore(
      path.join(root, 'risk'),
      options.now,
      executionProcessInstanceId,
    )
    const executions = new FileOptionsExecutionStore(path.join(root, 'execution'))
    const gateway = new OptionsExecutionGateway(executions, reservations, adapter, options.now)
    const coordinator = new FileOptionsManualOrderCoordinator(root, reservations, gateway, adapter, options.now)
    const managementStore = new FileOptionsManagementStore(path.join(root, 'management'))
    const positionManager = new OptionsPositionManager(executions, managementStore, reservations, adapter, options.now)
    return { connection, adapter, reservations, executions, gateway, coordinator, managementStore, positionManager }
  }
  const assertOptionsConnectionMutable = async (connectionId: string) => {
    await optionsManualExecutionRecoveryReady
    assertOptionsManualRecovery(connectionId)
    if (!optionsManualExecutionRoot) return
    const root = path.join(optionsManualExecutionRoot, connectionId)
    const records = await new FileOptionsExecutionStore(path.join(root, 'execution')).listRecords()
    const reservations = await new FileOptionsDebitReservationStore(
      path.join(root, 'risk'), options.now, executionProcessInstanceId,
    ).list()
    if (records.some((record) => record.state !== 'not-sent' && record.state !== 'canceled-flat' && record.state !== 'closed-flat')
      || reservations.some((reservation) => reservation.state !== 'released')) {
      throw new Error('Cancel or fully resolve this account’s paper option order before changing or removing it.')
    }
    if (optionsAutomaticExecutionRoot) {
      const automaticRoot = path.join(optionsAutomaticExecutionRoot, connectionId)
      const automaticRecords = await new FileOptionsExecutionStore(path.join(automaticRoot, 'execution')).listRecords()
      const automaticReservations = await new FileOptionsDebitReservationStore(
        path.join(automaticRoot, 'risk'), options.now, executionProcessInstanceId,
      ).list()
      if (automaticRecords.some((record) => record.state !== 'not-sent' && record.state !== 'canceled-flat' && record.state !== 'closed-flat')
        || automaticReservations.some((reservation) => reservation.state !== 'released')) {
        throw new Error('Resolve this account’s automatic paper option order before changing or removing it.')
      }
    }
  }
  const optionsCertificationCoordinator = optionsEvidenceRoot
    ? new FileProviderOptionsCertificationCoordinator(optionsEvidenceRoot, options.now)
    : undefined
  const optionsCertificationRecoveryReady = optionsCertificationCoordinator
    ? (async () => {
        const connectionIds = await optionsCertificationCoordinator.incompleteConnectionIds()
        if (connectionIds.length > 0 && options.optionsSingleInstanceAuthority !== true) {
          throw new Error('Interrupted options safety tests require desktop single-instance recovery authority.')
        }
        for (const connectionId of connectionIds) {
          const { connection, adapter } = await optionsProviderAdapter(connectionId)
          await optionsCertificationCoordinator.recoverIncompleteSessions(connection, adapter, true)
        }
      })()
    : Promise.resolve()
  void optionsCertificationRecoveryReady.catch(() => undefined)
  const optionsManualExecutionRecoveryReady = optionsManualExecutionRoot
    ? (async () => {
      const statuses = await optionsConnectionService!.list()
      for (const status of statuses) {
        try {
          const root = path.join(optionsManualExecutionRoot, status.connection.connection_id)
          const reservations = new FileOptionsDebitReservationStore(path.join(root, 'risk'), options.now, executionProcessInstanceId)
          const executions = new FileOptionsExecutionStore(path.join(root, 'execution'))
          if (options.optionsSingleInstanceAuthority === true) await reservations.recoverStaleLocks()
          const hasNonTerminal = (await executions.listRecords()).some((record) => record.state !== 'not-sent' && record.state !== 'canceled-flat' && record.state !== 'closed-flat')
          const managementStore = new FileOptionsManagementStore(path.join(root, 'management'))
          const hasManagement = (await managementStore.listRecords()).some((record) => !['entry-canceled', 'position-open', 'close-canceled', 'partial-close-canceled', 'closed-flat'].includes(record.state))
          const preparedReservations = (await reservations.list(status.connection.account_ref)).filter((reservation) => reservation.state === 'prepared')
          if (!hasNonTerminal && !hasManagement && preparedReservations.length === 0) continue
          if (options.optionsSingleInstanceAuthority !== true) {
            throw new Error('Options paper-order recovery requires desktop single-instance authority.')
          }
          const runtime = await optionsManualCoordinator(status.connection.connection_id)
          for (const reservation of preparedReservations) await runtime.gateway.releasePrepared(reservation.reservation_id)
          await runtime.positionManager.recoverAll()
          const managedIntentIds = new Set((await runtime.managementStore.listRecords()).map((record) => record.entry_intent_id))
          await runtime.gateway.recoverNonTerminal(managedIntentIds)
          optionsManualRecoveryErrors.delete(status.connection.connection_id)
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Unknown recovery failure'
          optionsManualRecoveryErrors.set(
            status.connection.connection_id,
            `Paper-order recovery is safely blocked: ${detail}`,
          )
        }
        }
      })()
    : Promise.resolve()
  void optionsManualExecutionRecoveryReady.catch(() => undefined)
  const optionsAutomaticExecutionRecoveryReady = optionsAutomaticExecutionRoot && optionsAutomaticCoordinator
    ? (async () => {
        if (options.optionsSingleInstanceAuthority !== true) {
          let pendingRecovery = (await optionsAutomationReceiptStore!.list()).some((receipt) => receipt.state === 'prepared')
          for (const status of await optionsConnectionService!.list()) {
            const root = path.join(optionsAutomaticExecutionRoot, status.connection.connection_id)
            const records = await new FileOptionsExecutionStore(path.join(root, 'execution')).listRecords()
            const reservations = await new FileOptionsDebitReservationStore(path.join(root, 'risk'), options.now, executionProcessInstanceId).list()
            const management = await new FileOptionsManagementStore(path.join(root, 'management')).listRecords()
            pendingRecovery ||= records.some((record) => !['not-sent', 'canceled-flat', 'closed-flat'].includes(record.state))
              || reservations.some((reservation) => reservation.state !== 'released')
              || management.some((record) => !['entry-canceled', 'position-open', 'close-canceled', 'partial-close-canceled', 'closed-flat'].includes(record.state))
          }
          if (pendingRecovery) {
            optionsAutomaticRecoveryErrors.set('runtime', 'Automatic options entry recovery requires Trade God desktop single-instance authority.')
          }
          return
        }
        const statuses = await optionsConnectionService!.list()
        for (const status of statuses) {
          try {
            const runtime = await optionsAutomaticManagementRuntime(status.connection.connection_id)
            await runtime.reservations.recoverStaleLocks()
            await runtime.positionManager.recoverAll()
            await runtime.gateway.recoverNonTerminal()
            optionsAutomaticRecoveryErrors.delete(status.connection.connection_id)
          } catch (error) {
            optionsAutomaticRecoveryErrors.set(status.connection.connection_id,
              `Automatic options recovery is safely blocked: ${error instanceof Error ? error.message : 'Unknown recovery failure'}`)
          }
        }
        await optionsAutomaticCoordinator.recoverPending()
        await optionsDiscordTradeManager?.recoverPending()
        await optionsWorkingOrderSupervisor?.sweep()
        await optionsExpirationSupervisor?.sweep()
      })()
    : Promise.resolve()
  void optionsAutomaticExecutionRecoveryReady.catch(() => undefined)
  const optionsWorkingOrderTimer = optionsWorkingOrderSupervisor && options.optionsSingleInstanceAuthority === true
    ? setInterval(() => {
        void optionsAutomaticExecutionRecoveryReady.then(async () => {
          try {
            await optionsWorkingOrderSupervisor.sweep()
            optionsAutomaticRecoveryErrors.delete('runtime-timeout-store')
          } catch (error) {
            optionsAutomaticRecoveryErrors.set('runtime-timeout-store',
              `Automatic options timeout custody is safely blocked: ${error instanceof Error ? error.message : 'Unknown timeout failure'}`)
          }
        }).catch(() => undefined)
      }, 5_000)
    : undefined
  optionsWorkingOrderTimer?.unref()
  const optionsExpirationTimer = optionsExpirationSupervisor && options.optionsSingleInstanceAuthority === true
    ? setInterval(() => {
        void optionsAutomaticExecutionRecoveryReady.then(async () => {
          try {
            await optionsExpirationSupervisor.sweep()
            optionsAutomaticRecoveryErrors.delete('runtime-expiration-store')
          } catch (error) {
            optionsAutomaticRecoveryErrors.set('runtime-expiration-store',
              `Expiration custody storage is safely blocked: ${error instanceof Error ? error.message : 'Unknown custody failure'}`)
          }
        }).catch(() => undefined)
      }, 60_000)
    : undefined
  optionsExpirationTimer?.unref()
  const assertOptionsManualRecovery = (connectionId: string) => {
    const issue = optionsManualRecoveryErrors.get(connectionId)
    if (issue) throw new Error(issue)
  }
  const executionGateway = executionStore && tradingConnectionStore
    ? new ExecutionGateway({
        store: executionStore,
        resolveConnection: (connectionId) => tradingConnectionStore.get(connectionId),
        // Observe-only receiver foundation. Provider adapters are attached only
        // after their exact paper connection has passed certification.
        adapters: attachedExecutionAdapters,
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
        () => attachedExecutionAdapters.length > 0,
      )
    : undefined
  const reconciliationSupervisor = executionGateway && attachedExecutionAdapters.length > 0
    ? new ExecutionReconciliationSupervisor({ gateway: executionGateway, now: options.now })
    : undefined
  let userSyncRefreshTimer: ReturnType<typeof setTimeout> | undefined
  let userSyncStopped = false
  const refreshTradovateUserSync = async (): Promise<void> => {
    if (
      userSyncStopped
      || !tradovatePaperRuntime
      || !tradingConnectionStore
      || !reconciliationSupervisor
      || !executionGateway
    ) return
    await tradovatePaperRuntime.refreshUserSync(
      await tradingConnectionStore.list(),
      {
        onHint: (hint) => {
          reconciliationSupervisor.invalidate(hint.connection_id)
        },
        onGap: async (gap) => {
          await haltAfterTradovateUserSyncGap(executionGateway, reconciliationSupervisor, gap)
        },
      },
    )
  }
  const scheduleTradovateUserSyncRefresh = (): void => {
    if (userSyncStopped || !tradovatePaperRuntime) return
    userSyncRefreshTimer = setTimeout(() => {
      userSyncRefreshTimer = undefined
      void refreshTradovateUserSync()
        .catch(() => executionGateway?.activateEmergencyHalt())
        .finally(scheduleTradovateUserSyncRefresh)
    }, 30_000)
  }
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
  const paperActivationJournal = options.executionDirectory
    ? new FilePaperActivationStore(options.executionDirectory, options.now)
    : undefined
  let attachedAdapterSetChecksum = ''
  const paperActivationService = (
    executionGateway
    && tradingConnectionService
    && standingAuthorizationStore
    && discordManagementSource
    && paperActivationJournal
  ) ? new PaperActivationService({
      gateway: executionGateway,
      connections: tradingConnectionService,
      authorizations: standingAuthorizationStore,
      sources: discordManagementSource,
      journal: paperActivationJournal,
      adapterSetChecksum: () => attachedAdapterSetChecksum,
      eventFeedHealth: (connectionId) => tradovatePaperRuntime
        ?.userSyncHealth()
        .find((health) => health.connection_id === connectionId),
      now: options.now,
    }) : undefined
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
      ...(optionsDiscordTradeManager ? { options: optionsDiscordTradeManager } : {}),
      now: options.now,
    }) : undefined
  let executionRecoveryError: unknown
  const executionRecoveryReady = executionGateway && executionStore
    ? executionStore.bindAdapterSet(attachedExecutionAdapters.map((adapter) => adapter.descriptor))
      .then((attachment) => {
        attachedAdapterSetChecksum = attachment.adapter_set_checksum
        return Promise.all([
          executionStore.recoverStaleLocks(),
          mirrorExecutionStore?.recoverStaleLocks() ?? Promise.resolve(0),
        ])
      })
      .then(() => executionGateway.recoverNonTerminal()).catch((error) => {
        executionRecoveryError = error
      })
    : Promise.resolve()
  let paperActivationRecoveryError: unknown
  const paperActivationReady = paperActivationService
    ? executionRecoveryReady.then(() => paperActivationService.recoverIncomplete()).catch((error) => {
        paperActivationRecoveryError = error
      })
    : executionRecoveryReady
  const executionSupervisionReady = paperActivationReady.then(async () => {
    if (executionRecoveryError) throw executionRecoveryError
    if (paperActivationRecoveryError) throw paperActivationRecoveryError
    reconciliationSupervisor?.start()
    await refreshTradovateUserSync()
    scheduleTradovateUserSyncRefresh()
  })
  let discordManagementRecoveryError: unknown
  const discordManagementReady = discordTradeManager && mirrorDiscordTradeManager && discordManagementFamilyResolver
    ? executionSupervisionReady.then(async () => {
        if (executionRecoveryError) throw executionRecoveryError
        if (paperActivationRecoveryError) throw paperActivationRecoveryError
        await optionsAutomaticExecutionRecoveryReady
        if (optionsAutomaticRecoveryErrors.size > 0) throw new Error([...optionsAutomaticRecoveryErrors.values()][0])
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
          listExecutionRecords: () => executionGateway?.list() ?? Promise.resolve([]),
          saveTradingConnection: async (input) => {
            if (executionGateway) {
              await executionRecoveryReady
              await executionGateway.setGlobalKill(true)
              await executionGateway.setConnectionKill(input.connection.connection_id, true)
            }
            const saved = await tradingRouteMutations!.saveConnection(
              input.connection.connection_id,
              async () => {
                await paperExecutionCoordinator?.revokeAuthorization(input.connection.connection_id)
                return tradingConnectionService.save(input)
              },
            )
            await refreshTradovateUserSync()
            return saved
          },
          removeTradingConnection: async (connectionId) => {
            if (executionGateway) {
              await executionRecoveryReady
              await executionGateway.setConnectionKill(connectionId, true)
            }
            const removed = await tradingRouteMutations!.removeConnection(
              connectionId,
              async () => {
                await paperExecutionCoordinator?.revokeAuthorization(connectionId)
                return tradingConnectionService.remove(connectionId)
              },
            )
            await refreshTradovateUserSync()
            return removed
          },
          openTradingConnectionLogin: (connectionId) => (
            tradingConnectionService.openBrowserLogin(connectionId)
          ),
          confirmTradingConnectionLogin: async (connectionId) => {
            if (executionGateway) {
              await executionRecoveryReady
              await executionGateway.setGlobalKill(true)
              await executionGateway.setConnectionKill(connectionId, true)
            }
            return tradingRouteMutations!.saveConnection(
              connectionId,
              async () => {
                await paperExecutionCoordinator?.revokeAuthorization(connectionId)
                return tradingConnectionService.confirmBrowserLogin(connectionId)
              },
            )
          },
          verifyTradingConnection: (connectionId) => tradingRouteMutations!.saveConnection(
            connectionId,
            () => tradingConnectionService.verifyProviderRead(connectionId),
          ),
          ...(executionGateway && tradingRouteMutations ? {
            applyTradingConnectionCertification: async (connectionId: string, certificationId: string) => {
            await executionSupervisionReady
            if (paperActivationRecoveryError) throw paperActivationRecoveryError
            const control = await executionGateway.readControl()
            if (!control.global_kill) {
              throw new ExecutionGatewayError(
                'KILL_SWITCH_ENABLED',
                'Apply certification only while the persistent global new-entry halt is active.',
              )
            }
            await executionGateway.setConnectionKill(connectionId, true)
            return tradingRouteMutations.saveConnection(
              connectionId,
              async () => {
                await paperExecutionCoordinator?.revokeAuthorization(connectionId)
                return tradingConnectionService.applyCertificationForConnection(
                  connectionId,
                  certificationId,
                )
              },
            )
            },
            setTradingConnectionPaperExecution: async (connectionId: string, enabled: boolean) => {
            await executionSupervisionReady
            if (paperActivationRecoveryError) throw paperActivationRecoveryError
            const control = await executionGateway.readControl()
            if (enabled && !control.global_kill) {
              throw new ExecutionGatewayError(
                'KILL_SWITCH_ENABLED',
                'Enable paper execution only while the persistent global new-entry halt is active.',
              )
            }
            await executionGateway.setConnectionKill(connectionId, true)
            return tradingRouteMutations.saveConnection(
              connectionId,
              async () => {
                await paperExecutionCoordinator?.revokeAuthorization(connectionId)
                return tradingConnectionService.setPaperExecutionEnabled(connectionId, enabled)
              },
            )
            },
          } : {}),
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
    ...(optionsConnectionService
      ? {
          listOptionsConnections: () => listOptionsConnectionStatuses(),
          saveOptionsConnection: (input) => withOptionsMutation(async () => {
            await optionsCertificationRecoveryReady
            if (input.connection_id) {
              await assertOptionsConnectionMutable(input.connection_id)
              await revokeOptionsAutopilotForConnection(input.connection_id, 'credential-change')
              await optionsManualAuthorityStore!.revokeForConnection(input.connection_id, 'credential-change')
            }
            return optionsConnectionService.save(input)
          }),
          verifyOptionsConnection: (connectionId) => withOptionsMutation(async () => {
            await optionsCertificationRecoveryReady
            await assertOptionsConnectionMutable(connectionId)
            await revokeOptionsAutopilotForConnection(connectionId, 'account-change')
            await optionsManualAuthorityStore!.revokeForConnection(connectionId, 'account-change')
            return optionsConnectionService.verify(connectionId)
          }),
          removeOptionsConnection: (connectionId) => withOptionsMutation(async () => {
            await optionsCertificationRecoveryReady
            await assertOptionsConnectionMutable(connectionId)
            if (optionsAutomationStore && (await optionsAutomationStore.listRoutes())
              .some((route) => route.connection_id === connectionId && route.state !== 'archived')) {
              throw new Error('Remove this account from every Discord source before deleting it.')
            }
            await revokeOptionsAutopilotForConnection(connectionId, 'operator')
            await optionsManualAuthorityStore!.revokeForConnection(connectionId, 'operator')
            return optionsConnectionService.remove(connectionId)
          }),
          applyOptionsCertification: (connectionId, certificationId, operatorConfirmed) => withOptionsMutation(async () => {
            await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady])
            await optionsManualAuthorityStore!.revokeForConnection(connectionId, 'account-change')
            const connection = await freshOptionsConnectionById(connectionId)
            await optionsCertificationApplicationStore!.apply({
              connection,
              certification_id: certificationId,
              operator_confirmed: operatorConfirmed,
            })
            const status = (await listOptionsConnectionStatuses()).find((candidate) => candidate.connection.connection_id === connectionId)
            if (!status) throw new Error('Options account disappeared after applying its safety test.')
            return status
          }),
          startOptionsCertification: (input) => withOptionsMutation(async () => {
            await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady])
            const current = await freshOptionsConnectionById(input.connection_id)
            await optionsManualAuthorityStore!.revokeForConnection(current.connection_id, 'account-change')
            const { connection, adapter } = await optionsProviderAdapter(current.connection_id)
            if (connection.content_checksum !== current.content_checksum) throw new Error('Options account changed before the safety test started.')
            await optionsCertificationCoordinator!.recoverIncompleteSessions(connection, adapter, options.optionsSingleInstanceAuthority === true)
            await optionsCertificationCoordinator!.run({
              connection,
              max_test_debit: input.max_test_debit,
              expires_at: input.expires_at,
              contract: input.contract,
              operator_confirmed: input.operator_confirmed,
            }, adapter)
            const status = (await listOptionsConnectionStatuses()).find((candidate) => candidate.connection.connection_id === connection.connection_id)
            if (!status) throw new Error('Options account disappeared after its safety test.')
            return status
          }),
          activateOptionsManualAuthority: (connectionId, maxDebit, validUntil, operatorConfirmed) => withOptionsMutation(async () => {
            await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady])
            const connection = await freshOptionsConnectionById(connectionId)
            const certification = await optionsCertificationStore!.getEligible(connection, options.now())
            if (!certification) throw new Error('This account has no current retained paper safety certification.')
            const application = await optionsCertificationApplicationStore!.getActive(connection, options.now())
            if (!application || application.certification_id !== certification.certification_id) {
              throw new Error('Apply the current paper safety test before enabling manual orders.')
            }
            await optionsManualAuthorityStore!.activate({
              connection,
              certification_id: certification.certification_id,
              max_debit_per_order: maxDebit,
              valid_until: validUntil,
              operator_confirmed: operatorConfirmed,
            })
            const status = (await listOptionsConnectionStatuses()).find((candidate) => candidate.connection.connection_id === connectionId)
            if (!status) throw new Error('Options account disappeared after manual paper activation.')
            return status
          }),
          revokeOptionsManualAuthority: (connectionId) => withOptionsMutation(async () => {
            await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady])
            await optionsManualAuthorityStore!.revokeForConnection(connectionId, 'operator')
            const status = (await listOptionsConnectionStatuses()).find((candidate) => candidate.connection.connection_id === connectionId)
            if (!status) throw new Error('Options account was not found after manual paper lock.')
            return status
          }),
          prepareOptionsManualOrder: (input) => withOptionsMutation(async () => {
            await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady, optionsManualExecutionRecoveryReady])
            assertOptionsManualRecovery(input.connection_id)
            const connection = await freshOptionsConnectionById(input.connection_id)
            const authority = await optionsManualAuthorityStore!.getActive(connection, options.now())
            if (!authority) throw new Error('Grant short-lived manual paper access before reviewing an order.')
            const runtime = await optionsManualCoordinator(connection.connection_id)
            if (runtime.connection.content_checksum !== connection.content_checksum) throw new Error('Options account changed before order review.')
            return runtime.coordinator.prepare({
              connection,
              authority,
              operator_max_premium: input.max_premium,
              operator_confirmed: input.operator_confirmed,
            })
          }),
          commitOptionsManualOrder: (connectionId, reviewId, reviewChecksum, operatorConfirmed) => withOptionsMutation(async () => {
            await Promise.all([optionsAuthorityRecoveryReady, optionsCertificationRecoveryReady, optionsManualExecutionRecoveryReady])
            assertOptionsManualRecovery(connectionId)
            const connection = await freshOptionsConnectionById(connectionId)
            const authority = await optionsManualAuthorityStore!.getActive(connection, options.now())
            if (!authority) throw new Error('Manual paper access expired or was locked before confirmation.')
            const runtime = await optionsManualCoordinator(connection.connection_id)
            if (runtime.connection.content_checksum !== connection.content_checksum) throw new Error('Options account changed before order confirmation.')
            return runtime.coordinator.commit({
              review_id: reviewId,
              review_checksum: reviewChecksum,
              connection,
              authority,
              operator_confirmed: operatorConfirmed,
            })
          }),
          cancelOptionsManualOrder: (connectionId, reviewId) => withOptionsMutation(async () => {
            await optionsManualExecutionRecoveryReady
            assertOptionsManualRecovery(connectionId)
            const runtime = await optionsManualCoordinator(connectionId)
            await runtime.coordinator.cancel(reviewId)
          }),
          cancelOptionsWorkingEntry: (connectionId, intentId, operatorConfirmed) => withOptionsMutation(async () => {
            if (operatorConfirmed !== true) throw new Error('Canceling a paper entry requires explicit confirmation.')
            await optionsManualExecutionRecoveryReady
            assertOptionsManualRecovery(connectionId)
            const runtime = await optionsManualCoordinator(connectionId)
            return runtime.positionManager.cancelWorkingEntry({
              intent_id: intentId,
              request_id: `operator-cancel-${randomUUID()}`,
              reason: 'operator',
            })
          }),
          closeOptionsPosition: (connectionId, intentId, minimumCredit, operatorConfirmed) => withOptionsMutation(async () => {
            if (operatorConfirmed !== true) throw new Error('Closing a paper position requires explicit confirmation.')
            await optionsManualExecutionRecoveryReady
            assertOptionsManualRecovery(connectionId)
            const runtime = await optionsManualCoordinator(connectionId)
            return runtime.positionManager.closePosition({
              intent_id: intentId,
              request_id: `operator-close-${randomUUID()}`,
              reason: 'operator',
              quantity: 'all',
              minimum_credit: minimumCredit,
            })
          }),
          ...(optionsAutomationService
            ? {
                listOptionsAutomationSources: async () => {
                  await optionsAutomaticExecutionRecoveryReady
                  return (await optionsAutomationService.list()).map((source) => ({
                    ...source,
                    custody_issue: [...optionsAutomaticRecoveryErrors.entries()]
                      .find(([key]) => key.startsWith(`expiration:${source.route.connection_id}:`))?.[1],
                  }))
                },
                saveOptionsAutomationSource: (input) => withOptionsMutation(async () => {
                  await optionsAutomaticExecutionRecoveryReady
                  const connection = await freshOptionsConnectionById(input.connection_id)
                  if (input.route_id) {
                    const current = await optionsAutomationStore!.getRoute(input.route_id)
                    if (current.connection_id !== connection.connection_id) {
                      await assertOptionsConnectionMutable(current.connection_id)
                    }
                    await revokeOptionsAutopilotForConnection(current.connection_id, 'route-change')
                  }
                  return optionsAutomationService.save(input)
                }),
                archiveOptionsAutomationSource: (routeId) => withOptionsMutation(async () => {
                  await optionsAutomaticExecutionRecoveryReady
                  const route = await optionsAutomationStore!.getRoute(routeId)
                  await revokeOptionsAutopilotForConnection(route.connection_id, 'operator')
                  await optionsAutomationService.archive(routeId)
                }),
                ...(optionsAutopilotActivationService
                  ? {
                      prepareOptionsAutopilotActivation: (routeId, validUntil) => withOptionsMutation(async () => {
                        await optionsAutomaticExecutionRecoveryReady
                        if (options.optionsSingleInstanceAuthority !== true) throw new Error('This Trade God instance does not own automatic execution.')
                        return optionsAutopilotActivationService.prepare(routeId, validUntil)
                      }),
                      commitOptionsAutopilotActivation: (reviewId, reviewChecksum, operatorConfirmed) => withOptionsMutation(async () => {
                        await optionsAutomaticExecutionRecoveryReady
                        if (options.optionsSingleInstanceAuthority !== true) throw new Error('This Trade God instance does not own automatic execution.')
                        return optionsAutopilotActivationService.commit(reviewId, reviewChecksum, operatorConfirmed)
                      }),
                      revokeOptionsAutopilot: (routeId) => withOptionsMutation(async () => {
                        await optionsAutomaticExecutionRecoveryReady
                        if (options.optionsSingleInstanceAuthority !== true) throw new Error('This Trade God instance does not own automatic execution.')
                        const route = await optionsAutomationStore!.getRoute(routeId)
                        const policy = await optionsAutomationStore!.getPolicy(route.policy_id, route.policy_revision)
                        const connection = await optionsConnectionById(route.connection_id)
                        const authority = await optionsAutopilotAuthorityStore!.getActive(route, policy, connection, options.now())
                        if (authority) await optionsAutopilotAuthorityStore!.revoke(authority, 'operator')
                      }),
                    }
                  : {}),
              }
            : {}),
        }
      : {}),
    ...(executionGateway
      ? {
          getExecutionControl: async () => {
            await executionSupervisionReady
            return {
              ...await executionGateway.readControl(),
              provider_adapters_attached: attachedExecutionAdapters.length > 0,
              ...(reconciliationSupervisor
                ? { reconciliation_health: reconciliationSupervisor.health() }
                : {}),
              ...(tradovatePaperRuntime
                ? { user_sync_health: tradovatePaperRuntime.userSyncHealth() }
                : {}),
            }
          },
          setGlobalExecutionKill: async (enabled: boolean) => {
            await executionRecoveryReady
            if (!enabled) {
              throw new ExecutionGatewayError(
                'KILL_SWITCH_ENABLED',
                'Releasing the global halt requires an exact paper activation review.',
              )
            }
            await executionGateway.setGlobalKill(true)
            return { global_kill: true }
          },
          setConnectionExecutionKill: async (connectionId: string, enabled: boolean) => {
            await executionRecoveryReady
            await tradingConnectionStore!.get(connectionId)
            if (!enabled) {
              throw new ExecutionGatewayError(
                'KILL_SWITCH_ENABLED',
                'Releasing an account halt requires an exact paper activation review.',
              )
            }
            await executionGateway.setConnectionKill(connectionId, true)
            return { connection_id: connectionId, killed: true }
          },
          ...(paperActivationService && tradingRouteMutations
            ? {
                preparePaperActivation: async () => {
                  await executionSupervisionReady
                  if (paperActivationRecoveryError) throw paperActivationRecoveryError
                  return tradingRouteMutations.captureRoutingSnapshot(() => (
                    paperActivationService.prepareReview()
                  ))
                },
                commitPaperActivation: async (reviewId: string, reviewChecksum: string) => {
                  await executionSupervisionReady
                  if (paperActivationRecoveryError) throw paperActivationRecoveryError
                  return tradingRouteMutations.captureRoutingSnapshot(() => (
                    paperActivationService.commitReview(reviewId, reviewChecksum)
                  ))
                },
              }
            : {}),
        }
      : {}),
    ...(standingAuthorizationStore && tradingConnectionStore
      ? {
          listStandingAuthorizations: () => standingAuthorizationStore.list(),
          saveStandingAuthorization: async (authorization: ExecutionAuthorization) => {
            await executionSupervisionReady
            if (paperActivationRecoveryError) throw paperActivationRecoveryError
            const control = await executionGateway!.readControl()
            if (!control.global_kill) {
              throw new ExecutionGatewayError(
                'KILL_SWITCH_ENABLED',
                'Saving or replacing a paper mandate requires the persistent global new-entry halt.',
              )
            }
            await executionGateway!.setConnectionKill(authorization.connection_id, true)
            return tradingRouteMutations!.captureRoutingSnapshot(async () => {
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
              return paperExecutionCoordinator!.saveAuthorization(authorization)
            })
          },
          revokeStandingAuthorization: async (connectionId: string) => {
            await executionSupervisionReady
            if (paperActivationRecoveryError) throw paperActivationRecoveryError
            return tradingRouteMutations!.captureRoutingSnapshot(() => (
              paperExecutionCoordinator!.revokeAuthorization(connectionId)
            ))
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
    ...(optionsAutomaticCoordinator
      ? {
          ingestOptionsEntryPush: async (input: unknown) => {
            await optionsAutomaticExecutionRecoveryReady
            if (options.optionsSingleInstanceAuthority !== true) {
              throw new Error('Automatic options entry requires Trade God desktop single-instance authority.')
            }
            const runtimeIssue = optionsAutomaticRecoveryErrors.get('runtime')
              ?? optionsAutomaticRecoveryErrors.get('runtime-timeout-store')
              ?? optionsAutomaticRecoveryErrors.get('runtime-expiration-store')
            if (runtimeIssue) throw new Error(runtimeIssue)
            const payload = discoTraderPushPayloadSchema.parse(input)
            if (payload.kind !== 'options_entry' || !payload.options_entry) {
              throw new Error('Only a signed immutable options entry can enter the options gateway.')
            }
            return optionsAutomaticCoordinator.ingest(payload.options_entry)
          },
        }
      : {}),
    ...(discordTradeManager && discordManagementFamilyResolver
      ? {
          ingestDiscoTraderTicketPush: async (input: unknown) => {
            await executionSupervisionReady
            if (paperActivationRecoveryError) throw paperActivationRecoveryError
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
              const result = await discordManagementSource!.ingestPush(
                input,
                resolved.route,
                undefined,
                binding.received_at,
              )
              if (
                projected.intent.intent_id !== result.record.intent.intent_id
                || projected.intent.content_checksum !== result.record.intent.content_checksum
                || binding.target.type !== 'connection'
                || result.record.intent.intent_id !== binding.target.intent_id
                || result.record.intent.connection_id !== binding.target.connection_id
                || sha256(result.record.intent.instrument) !== sha256(binding.instrument)
              ) {
                throw new ExecutionGatewayError(
                  'RECORD_INTEGRITY_FAILURE',
                  'Gateway intent does not match its frozen source binding.',
                )
              }
              await sourceExecutionBindingStore!.markMaterialized(binding.binding_id, sourceIdentity)
              return { type: 'connection' as const, result }
            })
            if (captured.type === 'mirror-group') {
              const { resolved, binding } = captured
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
            return paperExecutionCoordinator
              ? paperExecutionCoordinator.coordinate(captured.result.record.intent.intent_id)
              : captured.result.record
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
      if (optionsWorkingOrderTimer) clearInterval(optionsWorkingOrderTimer)
      if (optionsExpirationTimer) clearInterval(optionsExpirationTimer)
      await discordManagementReady
      userSyncStopped = true
      if (userSyncRefreshTimer) clearTimeout(userSyncRefreshTimer)
      userSyncRefreshTimer = undefined
      await reconciliationSupervisor?.stop()
      tradovatePaperRuntime?.stop()
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
