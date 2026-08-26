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
  ExecutionAuthorization,
  ExecutionRecord,
  MirrorGroup,
  PaperActivationEvent,
  PaperActivationReview,
  OptionsManualOrderReview,
  OptionsExecutionRecord,
} from '@trade-god/contracts'
import type { SaveMirrorGroupInput, TradovateUserSyncHealth } from '@trade-god/execution'

import { TRADE_GOD_IPC } from './trading-ipc.ts'
import type { InterpretFixtureInput } from './order-flow-specialist-pipeline.ts'
import type { SyntheticChartFixtureInput } from './synthetic-chart-fixture.ts'
import type {
  SaveTradingConnectionInput,
  TradingConnectionStatus,
} from './trading-connection-service.ts'
import type { TradingSignalRoute } from './trading-signal-route-store.ts'
import type { OptionsConnectionStatus, SaveOptionsConnectionInput, StartOptionsCertificationInput } from './options-connection-service.ts'

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>
type Subscribe = (channel: string, callback: (payload: unknown) => void) => () => void

export interface TradingPreloadApi {
  getTradeGodHealth(): Promise<HealthResponse>
  analyzeTradeGodFixture(input: AnalyzeFixtureInput): Promise<OrderFlowArtifact>
  interpretTradeGodFixture(input: InterpretFixtureInput): Promise<OrderFlowInterpretation>
  cancelTradeGodAnalysis(cancellationId: string): Promise<CancelAnalysisResponse>
  listTradeGodAlerts(limit?: number): Promise<TradeAlert[]>
  acknowledgeTradeGodAlert(alertId: string): Promise<TradeAlert | null>
  getTradeGodAlertIngestionStatus(): Promise<TradeAlertIngestionStatus>
  getTradeGodAlertWebhookSetup(): Promise<TradeAlertWebhookSetup>
  onTradeGodAlert(callback: (alert: TradeAlert) => void): () => void
  getIbkrGatewayHealth(environment?: IbkrGatewayEnvironment): Promise<IbkrGatewayHealth>
  getSyntheticTradeGodChartFixture(input: SyntheticChartFixtureInput): Promise<MarketCandleSeries | null>
  listTradingConnections(): Promise<TradingConnectionStatus[]>
  listTradeGodExecutions(): Promise<ExecutionRecord[]>
  saveTradingConnection(input: SaveTradingConnectionInput): Promise<TradingConnectionStatus>
  removeTradingConnection(connectionId: string): Promise<boolean>
  openTradingConnectionLogin(connectionId: string): Promise<{
    browser_instance_id: string
    session_ref: string
  }>
  confirmTradingConnectionLogin(connectionId: string): Promise<TradingConnectionStatus>
  verifyTradingConnection(connectionId: string): Promise<TradingConnectionStatus>
  applyTradingConnectionCertification(connectionId: string, certificationId: string): Promise<TradingConnectionStatus>
  setTradingConnectionPaperExecution(connectionId: string, enabled: boolean): Promise<TradingConnectionStatus>
  listTradingSignalRoutes(): Promise<TradingSignalRoute[]>
  saveTradingSignalRoute(
    route: TradingSignalRoute,
    expectedPreviousTargetKey?: string,
  ): Promise<TradingSignalRoute>
  removeTradingSignalRoute(routeId: string): Promise<boolean>
  listMirrorGroups(): Promise<MirrorGroup[]>
  saveMirrorGroup(input: SaveMirrorGroupInput): Promise<MirrorGroup>
  getDiscoTraderWebhookSecretStatus(): Promise<{ configured: boolean }>
  saveDiscoTraderWebhookSecret(secret: string): Promise<{ configured: true }>
  getTradeGodExecutionControl(): Promise<{
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
  setTradeGodGlobalExecutionKill(enabled: boolean): Promise<{ global_kill: boolean }>
  setTradeGodConnectionExecutionKill(connectionId: string, enabled: boolean): Promise<{ connection_id: string; killed: boolean }>
  prepareTradeGodPaperActivation(): Promise<PaperActivationReview>
  commitTradeGodPaperActivation(reviewId: string, reviewChecksum: string): Promise<PaperActivationEvent>
  listTradeGodStandingAuthorizations(): Promise<ExecutionAuthorization[]>
  saveTradeGodStandingAuthorization(authorization: ExecutionAuthorization): Promise<ExecutionAuthorization>
  revokeTradeGodStandingAuthorization(connectionId: string): Promise<boolean>
  listOptionsConnections(): Promise<OptionsConnectionStatus[]>
  saveOptionsConnection(input: SaveOptionsConnectionInput): Promise<OptionsConnectionStatus>
  verifyOptionsConnection(connectionId: string): Promise<OptionsConnectionStatus>
  removeOptionsConnection(connectionId: string): Promise<boolean>
  startOptionsCertification(input: StartOptionsCertificationInput): Promise<OptionsConnectionStatus>
  applyOptionsCertification(connectionId: string, certificationId: string, operatorConfirmed: true): Promise<OptionsConnectionStatus>
  activateOptionsManualAuthority(connectionId: string, maxDebit: string, validUntil: string, operatorConfirmed: true): Promise<OptionsConnectionStatus>
  revokeOptionsManualAuthority(connectionId: string): Promise<OptionsConnectionStatus>
  prepareOptionsManualOrder(input: { connection_id: string; max_premium: string; operator_confirmed: true }): Promise<OptionsManualOrderReview>
  commitOptionsManualOrder(connectionId: string, reviewId: string, reviewChecksum: string, operatorConfirmed: true): Promise<OptionsExecutionRecord>
  cancelOptionsManualOrder(connectionId: string, reviewId: string): Promise<void>
}

export function createTradingPreloadApi(invoke: Invoke, subscribe?: Subscribe): TradingPreloadApi {
  return {
    getTradeGodHealth: () => invoke(TRADE_GOD_IPC.HEALTH) as Promise<HealthResponse>,
    analyzeTradeGodFixture: (input) => invoke(TRADE_GOD_IPC.ANALYZE_FIXTURE, input) as Promise<OrderFlowArtifact>,
    interpretTradeGodFixture: (input) => invoke(TRADE_GOD_IPC.INTERPRET_FIXTURE, input) as Promise<OrderFlowInterpretation>,
    cancelTradeGodAnalysis: (cancellationId) => invoke(TRADE_GOD_IPC.CANCEL_ANALYSIS, cancellationId) as Promise<CancelAnalysisResponse>,
    listTradeGodAlerts: (limit) => invoke(TRADE_GOD_IPC.LIST_ALERTS, limit) as Promise<TradeAlert[]>,
    acknowledgeTradeGodAlert: (alertId) => invoke(TRADE_GOD_IPC.ACKNOWLEDGE_ALERT, alertId) as Promise<TradeAlert | null>,
    getTradeGodAlertIngestionStatus: () => invoke(TRADE_GOD_IPC.ALERT_INGESTION_STATUS) as Promise<TradeAlertIngestionStatus>,
    getTradeGodAlertWebhookSetup: () => invoke(TRADE_GOD_IPC.ALERT_WEBHOOK_SETUP) as Promise<TradeAlertWebhookSetup>,
    getIbkrGatewayHealth: (environment = 'paper') => (
      invoke(TRADE_GOD_IPC.IBKR_GATEWAY_HEALTH, environment) as Promise<IbkrGatewayHealth>
    ),
    getSyntheticTradeGodChartFixture: (input) => (
      invoke(TRADE_GOD_IPC.SYNTHETIC_CHART_FIXTURE, input) as Promise<MarketCandleSeries | null>
    ),
    listTradingConnections: () => (
      invoke(TRADE_GOD_IPC.LIST_CONNECTIONS) as Promise<TradingConnectionStatus[]>
    ),
    listTradeGodExecutions: () => (
      invoke(TRADE_GOD_IPC.LIST_EXECUTIONS) as Promise<ExecutionRecord[]>
    ),
    saveTradingConnection: (input) => (
      invoke(TRADE_GOD_IPC.SAVE_CONNECTION, input) as Promise<TradingConnectionStatus>
    ),
    removeTradingConnection: (connectionId) => (
      invoke(TRADE_GOD_IPC.REMOVE_CONNECTION, connectionId) as Promise<boolean>
    ),
    openTradingConnectionLogin: (connectionId) => (
      invoke(TRADE_GOD_IPC.OPEN_CONNECTION_LOGIN, connectionId) as Promise<{
        browser_instance_id: string
        session_ref: string
      }>
    ),
    confirmTradingConnectionLogin: (connectionId) => (
      invoke(TRADE_GOD_IPC.CONFIRM_CONNECTION_LOGIN, connectionId) as Promise<TradingConnectionStatus>
    ),
    verifyTradingConnection: (connectionId) => (
      invoke(TRADE_GOD_IPC.VERIFY_CONNECTION, connectionId) as Promise<TradingConnectionStatus>
    ),
    applyTradingConnectionCertification: (connectionId, certificationId) => (
      invoke(
        TRADE_GOD_IPC.APPLY_CONNECTION_CERTIFICATION,
        connectionId,
        certificationId,
      ) as Promise<TradingConnectionStatus>
    ),
    setTradingConnectionPaperExecution: (connectionId, enabled) => (
      invoke(
        TRADE_GOD_IPC.SET_CONNECTION_PAPER_EXECUTION,
        connectionId,
        enabled,
      ) as Promise<TradingConnectionStatus>
    ),
    listTradingSignalRoutes: () => invoke(TRADE_GOD_IPC.LIST_SIGNAL_ROUTES) as Promise<TradingSignalRoute[]>,
    saveTradingSignalRoute: (route, expectedPreviousTargetKey) => (
      invoke(TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE, route, expectedPreviousTargetKey) as Promise<TradingSignalRoute>
    ),
    removeTradingSignalRoute: (routeId) => invoke(TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE, routeId) as Promise<boolean>,
    listMirrorGroups: () => invoke(TRADE_GOD_IPC.LIST_MIRROR_GROUPS) as Promise<MirrorGroup[]>,
    saveMirrorGroup: (input) => invoke(TRADE_GOD_IPC.SAVE_MIRROR_GROUP, input) as Promise<MirrorGroup>,
    getDiscoTraderWebhookSecretStatus: () => (
      invoke(TRADE_GOD_IPC.DISCOTRADER_WEBHOOK_SECRET_STATUS) as Promise<{ configured: boolean }>
    ),
    saveDiscoTraderWebhookSecret: (secret) => (
      invoke(TRADE_GOD_IPC.SAVE_DISCOTRADER_WEBHOOK_SECRET, secret) as Promise<{ configured: true }>
    ),
    getTradeGodExecutionControl: () => invoke(TRADE_GOD_IPC.EXECUTION_CONTROL) as Promise<{
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
    }>,
    setTradeGodGlobalExecutionKill: (enabled) => (
      invoke(TRADE_GOD_IPC.SET_GLOBAL_EXECUTION_KILL, enabled) as Promise<{ global_kill: boolean }>
    ),
    setTradeGodConnectionExecutionKill: (connectionId, enabled) => (
      invoke(TRADE_GOD_IPC.SET_CONNECTION_EXECUTION_KILL, connectionId, enabled) as Promise<{
        connection_id: string
        killed: boolean
      }>
    ),
    prepareTradeGodPaperActivation: () => (
      invoke(TRADE_GOD_IPC.PREPARE_PAPER_ACTIVATION) as Promise<PaperActivationReview>
    ),
    commitTradeGodPaperActivation: (reviewId, reviewChecksum) => (
      invoke(
        TRADE_GOD_IPC.COMMIT_PAPER_ACTIVATION,
        reviewId,
        reviewChecksum,
      ) as Promise<PaperActivationEvent>
    ),
    listTradeGodStandingAuthorizations: () => (
      invoke(TRADE_GOD_IPC.LIST_STANDING_AUTHORIZATIONS) as Promise<ExecutionAuthorization[]>
    ),
    saveTradeGodStandingAuthorization: (authorization) => (
      invoke(TRADE_GOD_IPC.SAVE_STANDING_AUTHORIZATION, authorization) as Promise<ExecutionAuthorization>
    ),
    revokeTradeGodStandingAuthorization: (connectionId) => (
      invoke(TRADE_GOD_IPC.REVOKE_STANDING_AUTHORIZATION, connectionId) as Promise<boolean>
    ),
    listOptionsConnections: () => (
      invoke(TRADE_GOD_IPC.LIST_OPTIONS_CONNECTIONS) as Promise<OptionsConnectionStatus[]>
    ),
    saveOptionsConnection: (input) => (
      invoke(TRADE_GOD_IPC.SAVE_OPTIONS_CONNECTION, input) as Promise<OptionsConnectionStatus>
    ),
    verifyOptionsConnection: (connectionId) => (
      invoke(TRADE_GOD_IPC.VERIFY_OPTIONS_CONNECTION, connectionId) as Promise<OptionsConnectionStatus>
    ),
    removeOptionsConnection: (connectionId) => (
      invoke(TRADE_GOD_IPC.REMOVE_OPTIONS_CONNECTION, connectionId) as Promise<boolean>
    ),
    startOptionsCertification: (input) => (
      invoke(TRADE_GOD_IPC.START_OPTIONS_CERTIFICATION, input) as Promise<OptionsConnectionStatus>
    ),
    applyOptionsCertification: (connectionId, certificationId, operatorConfirmed) => (
      invoke(TRADE_GOD_IPC.APPLY_OPTIONS_CERTIFICATION, connectionId, certificationId, operatorConfirmed) as Promise<OptionsConnectionStatus>
    ),
    activateOptionsManualAuthority: (connectionId, maxDebit, validUntil, operatorConfirmed) => (
      invoke(TRADE_GOD_IPC.ACTIVATE_OPTIONS_MANUAL_AUTHORITY, connectionId, maxDebit, validUntil, operatorConfirmed) as Promise<OptionsConnectionStatus>
    ),
    revokeOptionsManualAuthority: (connectionId) => (
      invoke(TRADE_GOD_IPC.REVOKE_OPTIONS_MANUAL_AUTHORITY, connectionId) as Promise<OptionsConnectionStatus>
    ),
    prepareOptionsManualOrder: (input) => (
      invoke(TRADE_GOD_IPC.PREPARE_OPTIONS_MANUAL_ORDER, input) as Promise<OptionsManualOrderReview>
    ),
    commitOptionsManualOrder: (connectionId, reviewId, reviewChecksum, operatorConfirmed) => (
      invoke(TRADE_GOD_IPC.COMMIT_OPTIONS_MANUAL_ORDER, connectionId, reviewId, reviewChecksum, operatorConfirmed) as Promise<OptionsExecutionRecord>
    ),
    cancelOptionsManualOrder: (connectionId, reviewId) => (
      invoke(TRADE_GOD_IPC.CANCEL_OPTIONS_MANUAL_ORDER, connectionId, reviewId) as Promise<void>
    ),
    onTradeGodAlert: (callback) => subscribe
      ? subscribe(TRADE_GOD_IPC.ALERT_RECEIVED, (payload) => callback(payload as TradeAlert))
      : () => {},
  }
}
