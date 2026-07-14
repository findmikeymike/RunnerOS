import type { AnalyzeFixtureInput } from '@trade-god/client'
import type { CancelAnalysisResponse, HealthResponse, OrderFlowArtifact } from '@trade-god/contracts'

import { TRADE_GOD_IPC } from './trading-ipc.ts'

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

export interface TradingPreloadApi {
  getTradeGodHealth(): Promise<HealthResponse>
  analyzeTradeGodFixture(input: AnalyzeFixtureInput): Promise<OrderFlowArtifact>
  cancelTradeGodAnalysis(cancellationId: string): Promise<CancelAnalysisResponse>
}

export function createTradingPreloadApi(invoke: Invoke): TradingPreloadApi {
  return {
    getTradeGodHealth: () => invoke(TRADE_GOD_IPC.HEALTH) as Promise<HealthResponse>,
    analyzeTradeGodFixture: (input) => invoke(TRADE_GOD_IPC.ANALYZE_FIXTURE, input) as Promise<OrderFlowArtifact>,
    cancelTradeGodAnalysis: (cancellationId) => invoke(TRADE_GOD_IPC.CANCEL_ANALYSIS, cancellationId) as Promise<CancelAnalysisResponse>,
  }
}
