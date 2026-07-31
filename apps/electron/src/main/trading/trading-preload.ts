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
} from '@trade-god/contracts'

import { TRADE_GOD_IPC } from './trading-ipc.ts'
import type { InterpretFixtureInput } from './order-flow-specialist-pipeline.ts'
import type { SyntheticChartFixtureInput } from './synthetic-chart-fixture.ts'
import type {
  SaveTradingConnectionInput,
  TradingConnectionStatus,
} from './trading-connection-service.ts'
import type { TradingSignalRoute } from './trading-signal-route-store.ts'

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
  saveTradingConnection(input: SaveTradingConnectionInput): Promise<TradingConnectionStatus>
  removeTradingConnection(connectionId: string): Promise<boolean>
  openTradingConnectionLogin(connectionId: string): Promise<{
    browser_instance_id: string
    session_ref: string
  }>
  confirmTradingConnectionLogin(connectionId: string): Promise<TradingConnectionStatus>
  listTradingSignalRoutes(): Promise<TradingSignalRoute[]>
  saveTradingSignalRoute(route: TradingSignalRoute): Promise<TradingSignalRoute>
  removeTradingSignalRoute(routeId: string): Promise<boolean>
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
    listTradingSignalRoutes: () => invoke(TRADE_GOD_IPC.LIST_SIGNAL_ROUTES) as Promise<TradingSignalRoute[]>,
    saveTradingSignalRoute: (route) => invoke(TRADE_GOD_IPC.SAVE_SIGNAL_ROUTE, route) as Promise<TradingSignalRoute>,
    removeTradingSignalRoute: (routeId) => invoke(TRADE_GOD_IPC.REMOVE_SIGNAL_ROUTE, routeId) as Promise<boolean>,
    onTradeGodAlert: (callback) => subscribe
      ? subscribe(TRADE_GOD_IPC.ALERT_RECEIVED, (payload) => callback(payload as TradeAlert))
      : () => {},
  }
}
