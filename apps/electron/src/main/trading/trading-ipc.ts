import type { AnalyzeFixtureInput } from '@trade-god/client'
import type { AnalysisArtifact, CancelAnalysisResponse, HealthResponse } from '@trade-god/contracts'

export const TRADE_GOD_IPC = {
  HEALTH: 'trade-god:health',
  ANALYZE_FIXTURE: 'trade-god:analyze-fixture',
  CANCEL_ANALYSIS: 'trade-god:cancel-analysis',
} as const

export interface TradingIpcManager {
  health(): Promise<HealthResponse>
  analyzeFixture(input: AnalyzeFixtureInput): Promise<AnalysisArtifact>
  cancelAnalysis(cancellationId: string): Promise<CancelAnalysisResponse>
  stop(): Promise<void>
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
  removeHandler(channel: string): void
}

export function registerTradingIpc(ipcMain: IpcMainLike, manager: TradingIpcManager): () => Promise<void> {
  ipcMain.handle(TRADE_GOD_IPC.HEALTH, () => manager.health())
  ipcMain.handle(TRADE_GOD_IPC.ANALYZE_FIXTURE, (_event, input: unknown) => manager.analyzeFixture(input as AnalyzeFixtureInput))
  ipcMain.handle(TRADE_GOD_IPC.CANCEL_ANALYSIS, (_event, cancellationId: unknown) => manager.cancelAnalysis(String(cancellationId)))

  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    ipcMain.removeHandler(TRADE_GOD_IPC.HEALTH)
    ipcMain.removeHandler(TRADE_GOD_IPC.ANALYZE_FIXTURE)
    ipcMain.removeHandler(TRADE_GOD_IPC.CANCEL_ANALYSIS)
    await manager.stop()
  }
}
