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

import type { InterpretFixtureInput } from './order-flow-specialist-pipeline.ts'
import type { SyntheticChartFixtureInput } from './synthetic-chart-fixture.ts'

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
    await manager.stop()
  }
}
