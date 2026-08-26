import type { AnalyzeFixtureInput } from '@trade-god/client'
import type {
  CancelAnalysisResponse,
  HealthResponse,
  OrderFlowArtifact,
  OrderFlowInterpretation,
  TradeAlert,
  TradeAlertIngestionStatus,
  TradeAlertWebhookSetup,
  IbkrGatewayEnvironment,
  IbkrGatewayHealth,
  MarketCandleSeries,
  TradingConnection,
  ExecutionAuthorization,
  ExecutionRecord,
  MirrorGroup,
  PaperActivationEvent,
  PaperActivationReview,
  OptionsManualOrderReview,
  OptionsExecutionRecord,
  OptionsManagementRecord,
  OptionsAutopilotAuthority,
} from '@trade-god/contracts'
import type { OptionsAutopilotActivationReview, SaveMirrorGroupInput, TradovateUserSyncHealth } from '@trade-god/execution'

import type { InterpretFixtureInput } from './order-flow-specialist-pipeline.ts'
import type { SyntheticChartFixtureInput } from './synthetic-chart-fixture.ts'
import type {
  SaveTradingConnectionInput,
  TradingConnectionStatus,
} from './trading-connection-service.ts'
import type { TradingSignalRoute } from './trading-signal-route-store.ts'
import type { OptionsConnectionStatus, SaveOptionsConnectionInput, StartOptionsCertificationInput } from './options-connection-service.ts'
import type { OptionsAutomationSourceStatus, SaveOptionsAutomationSourceInput } from './options-automation-service.ts'

export const TRADE_GOD_IPC = {
  HEALTH: 'trade-god:health',
  ANALYZE_FIXTURE: 'trade-god:analyze-fixture',
  INTERPRET_FIXTURE: 'trade-god:interpret-fixture',
  CANCEL_ANALYSIS: 'trade-god:cancel-analysis',
  LIST_ALERTS: 'trade-god:alerts:list',
  ACKNOWLEDGE_ALERT: 'trade-god:alerts:acknowledge',
  ALERT_INGESTION_STATUS: 'trade-god:alerts:ingestion-status',
  ALERT_WEBHOOK_SETUP: 'trade-god:alerts:webhook-setup',
  ALERT_RECEIVED: 'trade-god:alerts:received',
  IBKR_GATEWAY_HEALTH: 'trade-god:ibkr-gateway-health',
  SYNTHETIC_CHART_FIXTURE: 'trade-god:synthetic-chart-fixture',
  LIST_CONNECTIONS: 'trade-god:connections:list',
  LIST_EXECUTIONS: 'trade-god:executions:list',
  SAVE_CONNECTION: 'trade-god:connections:save',
  REMOVE_CONNECTION: 'trade-god:connections:remove',
  OPEN_CONNECTION_LOGIN: 'trade-god:connections:open-login',
  CONFIRM_CONNECTION_LOGIN: 'trade-god:connections:confirm-login',
  VERIFY_CONNECTION: 'trade-god:connections:verify',
  APPLY_CONNECTION_CERTIFICATION: 'trade-god:connections:apply-certification',
  SET_CONNECTION_PAPER_EXECUTION: 'trade-god:connections:set-paper-execution',
  LIST_SIGNAL_ROUTES: 'trade-god:signal-routes:list',
  SAVE_SIGNAL_ROUTE: 'trade-god:signal-routes:save',
  REMOVE_SIGNAL_ROUTE: 'trade-god:signal-routes:remove',
  LIST_MIRROR_GROUPS: 'trade-god:mirror-groups:list',
  SAVE_MIRROR_GROUP: 'trade-god:mirror-groups:save',
  DISCOTRADER_WEBHOOK_SECRET_STATUS: 'trade-god:discotrader:webhook-secret-status',
  SAVE_DISCOTRADER_WEBHOOK_SECRET: 'trade-god:discotrader:save-webhook-secret',
  EXECUTION_CONTROL: 'trade-god:execution:control',
  SET_GLOBAL_EXECUTION_KILL: 'trade-god:execution:set-global-kill',
  SET_CONNECTION_EXECUTION_KILL: 'trade-god:execution:set-connection-kill',
  PREPARE_PAPER_ACTIVATION: 'trade-god:execution:paper-activation:prepare',
  COMMIT_PAPER_ACTIVATION: 'trade-god:execution:paper-activation:commit',
  LIST_STANDING_AUTHORIZATIONS: 'trade-god:execution:authorizations:list',
  SAVE_STANDING_AUTHORIZATION: 'trade-god:execution:authorizations:save',
  REVOKE_STANDING_AUTHORIZATION: 'trade-god:execution:authorizations:revoke',
  LIST_OPTIONS_CONNECTIONS: 'trade-god:options:connections:list',
  SAVE_OPTIONS_CONNECTION: 'trade-god:options:connections:save',
  VERIFY_OPTIONS_CONNECTION: 'trade-god:options:connections:verify',
  REMOVE_OPTIONS_CONNECTION: 'trade-god:options:connections:remove',
  START_OPTIONS_CERTIFICATION: 'trade-god:options:certification:start',
  APPLY_OPTIONS_CERTIFICATION: 'trade-god:options:certification:apply',
  ACTIVATE_OPTIONS_MANUAL_AUTHORITY: 'trade-god:options:manual-authority:activate',
  REVOKE_OPTIONS_MANUAL_AUTHORITY: 'trade-god:options:manual-authority:revoke',
  PREPARE_OPTIONS_MANUAL_ORDER: 'trade-god:options:manual-order:prepare',
  COMMIT_OPTIONS_MANUAL_ORDER: 'trade-god:options:manual-order:commit',
  CANCEL_OPTIONS_MANUAL_ORDER: 'trade-god:options:manual-order:cancel',
  CANCEL_OPTIONS_WORKING_ENTRY: 'trade-god:options:position:cancel-entry',
  CLOSE_OPTIONS_POSITION: 'trade-god:options:position:close',
  LIST_OPTIONS_AUTOMATION_SOURCES: 'trade-god:options:automation:list',
  SAVE_OPTIONS_AUTOMATION_SOURCE: 'trade-god:options:automation:save',
  ARCHIVE_OPTIONS_AUTOMATION_SOURCE: 'trade-god:options:automation:archive',
  PREPARE_OPTIONS_AUTOPILOT_ACTIVATION: 'trade-god:options:automation:activation:prepare',
  COMMIT_OPTIONS_AUTOPILOT_ACTIVATION: 'trade-god:options:automation:activation:commit',
  REVOKE_OPTIONS_AUTOPILOT: 'trade-god:options:automation:activation:revoke',
} as const

export interface TradingIpcManager {
  health(): Promise<HealthResponse>
  analyzeFixture(input: AnalyzeFixtureInput): Promise<OrderFlowArtifact>
  interpretFixture?(input: InterpretFixtureInput): Promise<OrderFlowInterpretation>
  cancelAnalysis(cancellationId: string): Promise<CancelAnalysisResponse>
  listAlerts?(limit?: number): Promise<TradeAlert[]>
  acknowledgeAlert?(alertId: string): Promise<TradeAlert | null>
  getAlertIngestionStatus?(): Promise<TradeAlertIngestionStatus>
  getAlertWebhookSetup?(): Promise<TradeAlertWebhookSetup>
  getIbkrGatewayHealth?(environment: IbkrGatewayEnvironment): Promise<IbkrGatewayHealth>
  getSyntheticChartFixture(input: SyntheticChartFixtureInput): Promise<MarketCandleSeries | null>
  listTradingConnections?(): Promise<TradingConnectionStatus[]>
  listExecutionRecords?(): Promise<ExecutionRecord[]>
  saveTradingConnection?(input: SaveTradingConnectionInput): Promise<TradingConnectionStatus>
  removeTradingConnection?(connectionId: string): Promise<boolean>
  openTradingConnectionLogin?(connectionId: string): Promise<{
    browser_instance_id: string
    session_ref: string
  }>
  confirmTradingConnectionLogin?(connectionId: string): Promise<TradingConnectionStatus>
  verifyTradingConnection?(connectionId: string): Promise<TradingConnectionStatus>
  applyTradingConnectionCertification?(connectionId: string, certificationId: string): Promise<TradingConnectionStatus>
  setTradingConnectionPaperExecution?(connectionId: string, enabled: boolean): Promise<TradingConnectionStatus>
  listTradingSignalRoutes?(): Promise<TradingSignalRoute[]>
  saveTradingSignalRoute?(
    route: TradingSignalRoute,
    expectedPreviousTargetKey?: string,
  ): Promise<TradingSignalRoute>
  removeTradingSignalRoute?(routeId: string): Promise<boolean>
  listMirrorGroups?(): Promise<MirrorGroup[]>
  saveMirrorGroup?(input: SaveMirrorGroupInput): Promise<MirrorGroup>
  getDiscoTraderWebhookSecretStatus?(): Promise<{ configured: boolean }>
  saveDiscoTraderWebhookSecret?(secret: string): Promise<{ configured: true }>
  getExecutionControl?(): Promise<{
    global_kill: boolean
    connection_kills: string[]
    source_kills: string[]
    updated_at: string
    provider_adapters_attached: boolean
    reconciliation_health?: {
      running: boolean
      cycle_in_progress: boolean
      last_cycle_started_at?: string
      last_success_at?: string
      consecutive_failures: number
      stale_connection_ids: string[]
      fresh_connection_ids: string[]
    }
    user_sync_health?: TradovateUserSyncHealth[]
  }>
  setGlobalExecutionKill?(enabled: boolean): Promise<{ global_kill: boolean }>
  setConnectionExecutionKill?(connectionId: string, enabled: boolean): Promise<{ connection_id: string; killed: boolean }>
  preparePaperActivation?(): Promise<PaperActivationReview>
  commitPaperActivation?(reviewId: string, reviewChecksum: string): Promise<PaperActivationEvent>
  listStandingAuthorizations?(): Promise<ExecutionAuthorization[]>
  saveStandingAuthorization?(authorization: ExecutionAuthorization): Promise<ExecutionAuthorization>
  revokeStandingAuthorization?(connectionId: string): Promise<boolean>
  listOptionsConnections?(): Promise<OptionsConnectionStatus[]>
  saveOptionsConnection?(input: SaveOptionsConnectionInput): Promise<OptionsConnectionStatus>
  verifyOptionsConnection?(connectionId: string): Promise<OptionsConnectionStatus>
  removeOptionsConnection?(connectionId: string): Promise<boolean>
  startOptionsCertification?(input: StartOptionsCertificationInput): Promise<OptionsConnectionStatus>
  applyOptionsCertification?(connectionId: string, certificationId: string, operatorConfirmed: true): Promise<OptionsConnectionStatus>
  activateOptionsManualAuthority?(connectionId: string, maxDebit: string, validUntil: string, operatorConfirmed: true): Promise<OptionsConnectionStatus>
  revokeOptionsManualAuthority?(connectionId: string): Promise<OptionsConnectionStatus>
  prepareOptionsManualOrder?(input: { connection_id: string; max_premium: string; operator_confirmed: true }): Promise<OptionsManualOrderReview>
  commitOptionsManualOrder?(connectionId: string, reviewId: string, reviewChecksum: string, operatorConfirmed: true): Promise<OptionsExecutionRecord>
  cancelOptionsManualOrder?(connectionId: string, reviewId: string): Promise<void>
  cancelOptionsWorkingEntry?(connectionId: string, intentId: string, operatorConfirmed: true): Promise<OptionsManagementRecord>
  closeOptionsPosition?(connectionId: string, intentId: string, minimumCredit: string, operatorConfirmed: true): Promise<OptionsManagementRecord>
  listOptionsAutomationSources?(): Promise<OptionsAutomationSourceStatus[]>
  saveOptionsAutomationSource?(input: SaveOptionsAutomationSourceInput): Promise<OptionsAutomationSourceStatus>
  archiveOptionsAutomationSource?(routeId: string): Promise<void>
  prepareOptionsAutopilotActivation?(routeId: string, validUntil: string): Promise<OptionsAutopilotActivationReview>
  commitOptionsAutopilotActivation?(reviewId: string, reviewChecksum: string, operatorConfirmed: true): Promise<OptionsAutopilotAuthority>
  revokeOptionsAutopilot?(routeId: string): Promise<void>
  resolveTradingConnection?(connectionId: string): Promise<TradingConnection>
  stop(): Promise<void>
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
  removeHandler(channel: string): void
}

export function registerTradingIpc(ipcMain: IpcMainLike, manager: TradingIpcManager): () => Promise<void> {
  ipcMain.handle(TRADE_GOD_IPC.HEALTH, () => manager.health())
  ipcMain.handle(TRADE_GOD_IPC.ANALYZE_FIXTURE, (_event, input: unknown) => manager.analyzeFixture(input as AnalyzeFixtureInput))
  ipcMain.handle(TRADE_GOD_IPC.INTERPRET_FIXTURE, (_event, input: unknown) => {
    if (!manager.interpretFixture) throw new Error('Trade God specialist pipeline is unavailable.')
    return manager.interpretFixture(input as InterpretFixtureInput)
  })
  ipcMain.handle(TRADE_GOD_IPC.CANCEL_ANALYSIS, (_event, cancellationId: unknown) => manager.cancelAnalysis(String(cancellationId)))
  ipcMain.handle(TRADE_GOD_IPC.LIST_ALERTS, (_event, limit: unknown) => {
    if (!manager.listAlerts) throw new Error('Trade God alert ledger is unavailable.')
    return manager.listAlerts(typeof limit === 'number' ? limit : undefined)
  })
  ipcMain.handle(TRADE_GOD_IPC.ACKNOWLEDGE_ALERT, (_event, alertId: unknown) => {
    if (!manager.acknowledgeAlert) throw new Error('Trade God alert ledger is unavailable.')
    return manager.acknowledgeAlert(String(alertId))
  })
  ipcMain.handle(TRADE_GOD_IPC.ALERT_INGESTION_STATUS, () => {
    if (!manager.getAlertIngestionStatus) throw new Error('Trade God alert receiver is unavailable.')
    return manager.getAlertIngestionStatus()
  })
  ipcMain.handle(TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP, () => {
    if (!manager.getAlertWebhookSetup) throw new Error('Trade God alert receiver is unavailable.')
    return manager.getAlertWebhookSetup()
  })
  ipcMain.handle(TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH, (_event, environment: unknown) => {
    if (!manager.getIbkrGatewayHealth) throw new Error('IBKR Gateway health probe is unavailable.')
    if (environment !== 'paper' && environment !== 'live') throw new Error('IBKR Gateway environment is invalid.')
    return manager.getIbkrGatewayHealth(environment)
  })
  ipcMain.handle(TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE, (_event, input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Synthetic chart fixture request is invalid.')
    }
    return manager.getSyntheticChartFixture(input as SyntheticChartFixtureInput)
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_CONNECTIONS, () => {
    if (!manager.listTradingConnections) throw new Error('Trading Connections are unavailable.')
    return manager.listTradingConnections()
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_EXECUTIONS, () => {
    if (!manager.listExecutionRecords) throw new Error('Trade records are unavailable.')
    return manager.listExecutionRecords()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_CONNECTION, (_event, input: unknown) => {
    if (!manager.saveTradingConnection) throw new Error('Trading Connections are unavailable.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Trading connection payload is invalid.')
    }
    return manager.saveTradingConnection(input as SaveTradingConnectionInput)
  })
  ipcMain.handle(TRADE_GOD_IPC.REMOVE_CONNECTION, (_event, connectionId: unknown) => {
    if (!manager.removeTradingConnection) throw new Error('Trading Connections are unavailable.')
    return manager.removeTradingConnection(String(connectionId))
  })
  ipcMain.handle(TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN, (_event, connectionId: unknown) => {
    if (!manager.openTradingConnectionLogin) throw new Error('Trading Connections are unavailable.')
    return manager.openTradingConnectionLogin(String(connectionId))
  })
  ipcMain.handle(TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN, (_event, connectionId: unknown) => {
    if (!manager.confirmTradingConnectionLogin) throw new Error('Trading Connections are unavailable.')
    return manager.confirmTradingConnectionLogin(String(connectionId))
  })
  ipcMain.handle(TRADE_GOD_IPC.VERIFY_CONNECTION, (_event, connectionId: unknown) => {
    if (!manager.verifyTradingConnection) throw new Error('Trusted provider verification is unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      throw new Error('Trading connection id is invalid.')
    }
    return manager.verifyTradingConnection(connectionId)
  })
  ipcMain.handle(TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION, (
    _event,
    connectionId: unknown,
    certificationId: unknown,
  ) => {
    if (!manager.applyTradingConnectionCertification) {
      throw new Error('Trusted certification application is unavailable.')
    }
    if (typeof connectionId !== 'string' || !connectionId.trim()) {
      throw new Error('Trading connection id is invalid.')
    }
    if (typeof certificationId !== 'string' || !certificationId.trim()) {
      throw new Error('Certification id is invalid.')
    }
    return manager.applyTradingConnectionCertification(connectionId, certificationId)
  })
  ipcMain.handle(TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION, (
    _event,
    connectionId: unknown,
    enabled: unknown,
  ) => {
    if (!manager.setTradingConnectionPaperExecution) {
      throw new Error('Trusted paper execution control is unavailable.')
    }
    if (typeof connectionId !== 'string' || !connectionId.trim() || typeof enabled !== 'boolean') {
      throw new Error('Paper execution control payload is invalid.')
    }
    return manager.setTradingConnectionPaperExecution(connectionId, enabled)
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_SIGNAL_ROUTES, () => {
    if (!manager.listTradingSignalRoutes) throw new Error('Trading signal routes are unavailable.')
    return manager.listTradingSignalRoutes()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE, (
    _event,
    route: unknown,
    expectedPreviousTargetKey: unknown,
  ) => {
    if (!manager.saveTradingSignalRoute) throw new Error('Trading signal routes are unavailable.')
    if (expectedPreviousTargetKey !== undefined && typeof expectedPreviousTargetKey !== 'string') {
      throw new Error('Expected previous target key is invalid.')
    }
    return manager.saveTradingSignalRoute(
      route as TradingSignalRoute,
      expectedPreviousTargetKey,
    )
  })
  ipcMain.handle(TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE, (_event, routeId: unknown) => {
    if (!manager.removeTradingSignalRoute) throw new Error('Trading signal routes are unavailable.')
    return manager.removeTradingSignalRoute(String(routeId))
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_MIRROR_GROUPS, () => {
    if (!manager.listMirrorGroups) throw new Error('Mirror Groups are unavailable.')
    return manager.listMirrorGroups()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_MIRROR_GROUP, (_event, input: unknown) => {
    if (!manager.saveMirrorGroup) throw new Error('Mirror Groups are unavailable.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Mirror Group payload is invalid.')
    }
    return manager.saveMirrorGroup(input as SaveMirrorGroupInput)
  })
  ipcMain.handle(TRADE_GOD_IPC.DISCOTRADER_WEBHOOK_SECRET_STATUS, () => {
    if (!manager.getDiscoTraderWebhookSecretStatus) throw new Error('DiscoTrader webhook credentials are unavailable.')
    return manager.getDiscoTraderWebhookSecretStatus()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_DISCOTRADER_WEBHOOK_SECRET, (_event, secret: unknown) => {
    if (!manager.saveDiscoTraderWebhookSecret) throw new Error('DiscoTrader webhook credentials are unavailable.')
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512) {
      throw new Error('DiscoTrader shared secret must be between 32 and 512 characters.')
    }
    return manager.saveDiscoTraderWebhookSecret(secret)
  })
  ipcMain.handle(TRADE_GOD_IPC.EXECUTION_CONTROL, () => {
    if (!manager.getExecutionControl) throw new Error('Execution controls are unavailable.')
    return manager.getExecutionControl()
  })
  ipcMain.handle(TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL, (_event, enabled: unknown) => {
    if (!manager.setGlobalExecutionKill) throw new Error('Execution controls are unavailable.')
    if (typeof enabled !== 'boolean') throw new Error('Execution halt state is invalid.')
    return manager.setGlobalExecutionKill(enabled)
  })
  ipcMain.handle(TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL, (_event, connectionId: unknown, enabled: unknown) => {
    if (!manager.setConnectionExecutionKill) throw new Error('Execution controls are unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim()) throw new Error('Execution connection id is invalid.')
    if (typeof enabled !== 'boolean') throw new Error('Execution halt state is invalid.')
    return manager.setConnectionExecutionKill(connectionId, enabled)
  })
  ipcMain.handle(TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION, () => {
    if (!manager.preparePaperActivation) throw new Error('Paper activation review is unavailable.')
    return manager.preparePaperActivation()
  })
  ipcMain.handle(TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION, (
    _event,
    reviewId: unknown,
    reviewChecksum: unknown,
  ) => {
    if (!manager.commitPaperActivation) throw new Error('Paper activation review is unavailable.')
    if (typeof reviewId !== 'string' || !reviewId.trim()) throw new Error('Paper activation review id is invalid.')
    if (typeof reviewChecksum !== 'string' || !/^[a-f0-9]{64}$/.test(reviewChecksum)) {
      throw new Error('Paper activation review checksum is invalid.')
    }
    return manager.commitPaperActivation(reviewId, reviewChecksum)
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS, () => {
    if (!manager.listStandingAuthorizations) throw new Error('Standing paper mandates are unavailable.')
    return manager.listStandingAuthorizations()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION, (_event, authorization: unknown) => {
    if (!manager.saveStandingAuthorization) throw new Error('Standing paper mandates are unavailable.')
    return manager.saveStandingAuthorization(authorization as ExecutionAuthorization)
  })
  ipcMain.handle(TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION, (_event, connectionId: unknown) => {
    if (!manager.revokeStandingAuthorization) throw new Error('Standing paper mandates are unavailable.')
    return manager.revokeStandingAuthorization(String(connectionId))
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_OPTIONS_CONNECTIONS, () => {
    if (!manager.listOptionsConnections) throw new Error('Options accounts are unavailable.')
    return manager.listOptionsConnections()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_OPTIONS_CONNECTION, (_event, input: unknown) => {
    if (!manager.saveOptionsConnection) throw new Error('Options account setup is unavailable.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Options account payload is invalid.')
    return manager.saveOptionsConnection(input as SaveOptionsConnectionInput)
  })
  ipcMain.handle(TRADE_GOD_IPC.VERIFY_OPTIONS_CONNECTION, (_event, connectionId: unknown) => {
    if (!manager.verifyOptionsConnection) throw new Error('Options account verification is unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim()) throw new Error('Options account id is invalid.')
    return manager.verifyOptionsConnection(connectionId)
  })
  ipcMain.handle(TRADE_GOD_IPC.REMOVE_OPTIONS_CONNECTION, (_event, connectionId: unknown) => {
    if (!manager.removeOptionsConnection) throw new Error('Options account removal is unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim()) throw new Error('Options account id is invalid.')
    return manager.removeOptionsConnection(connectionId)
  })
  ipcMain.handle(TRADE_GOD_IPC.START_OPTIONS_CERTIFICATION, (_event, input: unknown) => {
    if (!manager.startOptionsCertification) throw new Error('Options paper safety test is unavailable.')
    if (!isStartOptionsCertificationInput(input)) throw new Error('Options paper safety-test payload is invalid.')
    return manager.startOptionsCertification(input)
  })
  ipcMain.handle(TRADE_GOD_IPC.APPLY_OPTIONS_CERTIFICATION, (_event, connectionId: unknown, certificationId: unknown, operatorConfirmed: unknown) => {
    if (!manager.applyOptionsCertification) throw new Error('Options safety-test application is unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim() || typeof certificationId !== 'string' || !certificationId.trim() || operatorConfirmed !== true) {
      throw new Error('Options safety-test application payload is invalid.')
    }
    return manager.applyOptionsCertification(connectionId, certificationId, true)
  })
  ipcMain.handle(TRADE_GOD_IPC.ACTIVATE_OPTIONS_MANUAL_AUTHORITY, (_event, connectionId: unknown, maxDebit: unknown, validUntil: unknown, operatorConfirmed: unknown) => {
    if (!manager.activateOptionsManualAuthority) throw new Error('Options manual paper authority is unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim() || typeof maxDebit !== 'string' || !maxDebit.trim()
      || typeof validUntil !== 'string' || Number.isNaN(Date.parse(validUntil)) || operatorConfirmed !== true) {
      throw new Error('Options manual paper activation payload is invalid.')
    }
    return manager.activateOptionsManualAuthority(connectionId, maxDebit, validUntil, true)
  })
  ipcMain.handle(TRADE_GOD_IPC.REVOKE_OPTIONS_MANUAL_AUTHORITY, (_event, connectionId: unknown) => {
    if (!manager.revokeOptionsManualAuthority) throw new Error('Options manual paper authority is unavailable.')
    if (typeof connectionId !== 'string' || !connectionId.trim()) throw new Error('Options account id is invalid.')
    return manager.revokeOptionsManualAuthority(connectionId)
  })
  ipcMain.handle(TRADE_GOD_IPC.PREPARE_OPTIONS_MANUAL_ORDER, (_event, input: unknown) => {
    if (!manager.prepareOptionsManualOrder) throw new Error('Manual options paper orders are unavailable.')
    const value = input as { connection_id?: unknown; max_premium?: unknown; operator_confirmed?: unknown }
    if (typeof value?.connection_id !== 'string' || typeof value.max_premium !== 'string' || value.operator_confirmed !== true) {
      throw new Error('Manual options review input is invalid.')
    }
    return manager.prepareOptionsManualOrder({ connection_id: value.connection_id, max_premium: value.max_premium, operator_confirmed: true })
  })
  ipcMain.handle(TRADE_GOD_IPC.COMMIT_OPTIONS_MANUAL_ORDER, (_event, connectionId: unknown, reviewId: unknown, reviewChecksum: unknown, operatorConfirmed: unknown) => {
    if (!manager.commitOptionsManualOrder) throw new Error('Manual options paper orders are unavailable.')
    if (typeof connectionId !== 'string' || typeof reviewId !== 'string' || typeof reviewChecksum !== 'string' || operatorConfirmed !== true) throw new Error('Manual options confirmation is invalid.')
    return manager.commitOptionsManualOrder(connectionId, reviewId, reviewChecksum, true)
  })
  ipcMain.handle(TRADE_GOD_IPC.CANCEL_OPTIONS_MANUAL_ORDER, (_event, connectionId: unknown, reviewId: unknown) => {
    if (!manager.cancelOptionsManualOrder) throw new Error('Manual options paper orders are unavailable.')
    if (typeof connectionId !== 'string' || typeof reviewId !== 'string') throw new Error('Manual options review ID is invalid.')
    return manager.cancelOptionsManualOrder(connectionId, reviewId)
  })
  ipcMain.handle(TRADE_GOD_IPC.CANCEL_OPTIONS_WORKING_ENTRY, (_event, connectionId: unknown, intentId: unknown, operatorConfirmed: unknown) => {
    if (!manager.cancelOptionsWorkingEntry) throw new Error('Options position custody is unavailable.')
    if (operatorConfirmed !== true) throw new Error('Canceling a paper entry requires explicit confirmation.')
    return manager.cancelOptionsWorkingEntry(String(connectionId), String(intentId), true)
  })
  ipcMain.handle(TRADE_GOD_IPC.CLOSE_OPTIONS_POSITION, (_event, connectionId: unknown, intentId: unknown, minimumCredit: unknown, operatorConfirmed: unknown) => {
    if (!manager.closeOptionsPosition) throw new Error('Options position custody is unavailable.')
    if (operatorConfirmed !== true || typeof minimumCredit !== 'string' || !minimumCredit.trim()) throw new Error('Closing a paper position requires an exact minimum credit and confirmation.')
    return manager.closeOptionsPosition(String(connectionId), String(intentId), minimumCredit.trim(), true)
  })
  ipcMain.handle(TRADE_GOD_IPC.LIST_OPTIONS_AUTOMATION_SOURCES, () => {
    if (!manager.listOptionsAutomationSources) throw new Error('Options Discord sources are unavailable.')
    return manager.listOptionsAutomationSources()
  })
  ipcMain.handle(TRADE_GOD_IPC.SAVE_OPTIONS_AUTOMATION_SOURCE, (_event, input: unknown) => {
    if (!manager.saveOptionsAutomationSource) throw new Error('Options Discord sources are unavailable.')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Options Discord source is invalid.')
    return manager.saveOptionsAutomationSource(input as SaveOptionsAutomationSourceInput)
  })
  ipcMain.handle(TRADE_GOD_IPC.ARCHIVE_OPTIONS_AUTOMATION_SOURCE, (_event, routeId: unknown) => {
    if (!manager.archiveOptionsAutomationSource) throw new Error('Options Discord sources are unavailable.')
    return manager.archiveOptionsAutomationSource(String(routeId))
  })
  ipcMain.handle(TRADE_GOD_IPC.PREPARE_OPTIONS_AUTOPILOT_ACTIVATION, (_event, routeId: unknown, validUntil: unknown) => {
    if (!manager.prepareOptionsAutopilotActivation) throw new Error('Automatic options activation is unavailable.')
    if (typeof validUntil !== 'string') throw new Error('Automation end time is required.')
    return manager.prepareOptionsAutopilotActivation(String(routeId), validUntil)
  })
  ipcMain.handle(TRADE_GOD_IPC.COMMIT_OPTIONS_AUTOPILOT_ACTIVATION, (_event, reviewId: unknown, reviewChecksum: unknown, confirmed: unknown) => {
    if (!manager.commitOptionsAutopilotActivation) throw new Error('Automatic options activation is unavailable.')
    if (confirmed !== true) throw new Error('Starting automatic paper trading requires explicit confirmation.')
    return manager.commitOptionsAutopilotActivation(String(reviewId), String(reviewChecksum), true)
  })
  ipcMain.handle(TRADE_GOD_IPC.REVOKE_OPTIONS_AUTOPILOT, (_event, routeId: unknown) => {
    if (!manager.revokeOptionsAutopilot) throw new Error('Automatic options controls are unavailable.')
    return manager.revokeOptionsAutopilot(String(routeId))
  })

  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    ipcMain.removeHandler(TRADE_GOD_IPC.HEALTH)
    ipcMain.removeHandler(TRADE_GOD_IPC.ANALYZE_FIXTURE)
    ipcMain.removeHandler(TRADE_GOD_IPC.INTERPRET_FIXTURE)
    ipcMain.removeHandler(TRADE_GOD_IPC.CANCEL_ANALYSIS)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_ALERTS)
    ipcMain.removeHandler(TRADE_GOD_IPC.ACKNOWLEDGE_ALERT)
    ipcMain.removeHandler(TRADE_GOD_IPC.ALERT_INGESTION_STATUS)
    ipcMain.removeHandler(TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP)
    ipcMain.removeHandler(TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH)
    ipcMain.removeHandler(TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_CONNECTIONS)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_EXECUTIONS)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_CONNECTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.REMOVE_CONNECTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN)
    ipcMain.removeHandler(TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN)
    ipcMain.removeHandler(TRADE_GOD_IPC.VERIFY_CONNECTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_SIGNAL_ROUTES)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE)
    ipcMain.removeHandler(TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_MIRROR_GROUPS)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_MIRROR_GROUP)
    ipcMain.removeHandler(TRADE_GOD_IPC.DISCOTRADER_WEBHOOK_SECRET_STATUS)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_DISCOTRADER_WEBHOOK_SECRET)
    ipcMain.removeHandler(TRADE_GOD_IPC.EXECUTION_CONTROL)
    ipcMain.removeHandler(TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL)
    ipcMain.removeHandler(TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL)
    ipcMain.removeHandler(TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_OPTIONS_CONNECTIONS)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_OPTIONS_CONNECTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.VERIFY_OPTIONS_CONNECTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.REMOVE_OPTIONS_CONNECTION)
    ipcMain.removeHandler(TRADE_GOD_IPC.START_OPTIONS_CERTIFICATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.APPLY_OPTIONS_CERTIFICATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.ACTIVATE_OPTIONS_MANUAL_AUTHORITY)
    ipcMain.removeHandler(TRADE_GOD_IPC.REVOKE_OPTIONS_MANUAL_AUTHORITY)
    ipcMain.removeHandler(TRADE_GOD_IPC.PREPARE_OPTIONS_MANUAL_ORDER)
    ipcMain.removeHandler(TRADE_GOD_IPC.COMMIT_OPTIONS_MANUAL_ORDER)
    ipcMain.removeHandler(TRADE_GOD_IPC.CANCEL_OPTIONS_MANUAL_ORDER)
    ipcMain.removeHandler(TRADE_GOD_IPC.CANCEL_OPTIONS_WORKING_ENTRY)
    ipcMain.removeHandler(TRADE_GOD_IPC.CLOSE_OPTIONS_POSITION)
    ipcMain.removeHandler(TRADE_GOD_IPC.LIST_OPTIONS_AUTOMATION_SOURCES)
    ipcMain.removeHandler(TRADE_GOD_IPC.SAVE_OPTIONS_AUTOMATION_SOURCE)
    ipcMain.removeHandler(TRADE_GOD_IPC.ARCHIVE_OPTIONS_AUTOMATION_SOURCE)
    ipcMain.removeHandler(TRADE_GOD_IPC.PREPARE_OPTIONS_AUTOPILOT_ACTIVATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.COMMIT_OPTIONS_AUTOPILOT_ACTIVATION)
    ipcMain.removeHandler(TRADE_GOD_IPC.REVOKE_OPTIONS_AUTOPILOT)
    await manager.stop()
  }
}

const isStartOptionsCertificationInput = (input: unknown): input is StartOptionsCertificationInput => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  const contract = value.contract
  return typeof value.connection_id === 'string' && Boolean(value.connection_id.trim())
    && typeof value.max_test_debit === 'string' && Boolean(value.max_test_debit.trim())
    && typeof value.expires_at === 'string' && !Number.isNaN(Date.parse(value.expires_at))
    && value.operator_confirmed === true
    && Boolean(contract) && typeof contract === 'object' && !Array.isArray(contract)
    && typeof (contract as Record<string, unknown>).underlying === 'string'
    && typeof (contract as Record<string, unknown>).expiration === 'string'
    && typeof (contract as Record<string, unknown>).strike === 'string'
    && ((contract as Record<string, unknown>).right === 'call' || (contract as Record<string, unknown>).right === 'put')
}
