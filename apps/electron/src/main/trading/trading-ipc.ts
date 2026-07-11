import type { AnalyzeFixtureInput } from '@trade-god/client'
import type { AnalysisArtifact, HealthResponse } from '@trade-god/contracts'

export const TRADE_GOD_IPC = {
  HEALTH: 'trade-god:health',
  ANALYZE_FIXTURE: 'trade-god:analyze-fixture',
} as const

export interface TradingIpcManager {
  health(): Promise<HealthResponse>
  analyzeFixture(input: AnalyzeFixtureInput): Promise<AnalysisArtifact>
  stop(): Promise<void>
}

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void
  removeHandler(channel: string): void
}

export function registerTradingIpc(ipcMain: IpcMainLike, manager: TradingIpcManager): () => Promise<void> {
  ipcMain.handle(TRADE_GOD_IPC.HEALTH, () => manager.health())
  ipcMain.handle(TRADE_GOD_IPC.ANALYZE_FIXTURE, (_event, input: unknown) => manager.analyzeFixture(input as AnalyzeFixtureInput))

  let disposed = false
  return async () => {
    if (disposed) return
    disposed = true
    ipcMain.removeHandler(TRADE_GOD_IPC.HEALTH)
    ipcMain.removeHandler(TRADE_GOD_IPC.ANALYZE_FIXTURE)
    await manager.stop()
  }
}
