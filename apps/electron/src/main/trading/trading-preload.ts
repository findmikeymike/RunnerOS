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
    onTradeGodAlert: (callback) => subscribe
      ? subscribe(TRADE_GOD_IPC.ALERT_RECEIVED, (payload) => callback(payload as TradeAlert))
      : () => {},
  }
}
