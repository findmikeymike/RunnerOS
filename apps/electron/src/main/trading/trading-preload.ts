import type { AnalyzeFixtureInput } from '@trade-god/client'
import type { AnalysisArtifact, HealthResponse } from '@trade-god/contracts'

import { TRADE_GOD_IPC } from './trading-ipc.ts'

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>

export interface TradingPreloadApi {
  getTradeGodHealth(): Promise<HealthResponse>
  analyzeTradeGodFixture(input: AnalyzeFixtureInput): Promise<AnalysisArtifact>
}

export function createTradingPreloadApi(invoke: Invoke): TradingPreloadApi {
  return {
    getTradeGodHealth: () => invoke(TRADE_GOD_IPC.HEALTH) as Promise<HealthResponse>,
    analyzeTradeGodFixture: (input) => invoke(TRADE_GOD_IPC.ANALYZE_FIXTURE, input) as Promise<AnalysisArtifact>,
  }
}
