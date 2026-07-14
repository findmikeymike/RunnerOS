import type { AnalyzeMarketBatchInput } from '@trade-god/client'
import type { CanonicalOrderFlowArtifact } from '@trade-god/contracts'

import type { MarketDataSidecarManager } from './market-data-sidecar-manager.ts'
import type { OrderFlowSidecarManager } from './order-flow-sidecar-manager.ts'

export interface AnalyzeCanonicalFixtureInput {
  fixtureId: string
  fixtureSha256: string
  batchId: string
  traceId: string
  session: AnalyzeMarketBatchInput['session']
  analysis: AnalyzeMarketBatchInput['analysis']
  timeoutMs: number
  cancellationId?: string
}

export class CanonicalOrderFlowPipeline {
  constructor(
    private readonly marketData: Pick<MarketDataSidecarManager, 'loadFixture'>,
    private readonly orderFlow: Pick<OrderFlowSidecarManager, 'analyzeMarketBatch'>,
  ) {}

  async analyzeFixture(input: AnalyzeCanonicalFixtureInput): Promise<CanonicalOrderFlowArtifact> {
    const batch = await this.marketData.loadFixture({
      fixtureId: input.fixtureId,
      traceId: input.traceId,
      batchId: input.batchId,
    })
    if (
      batch.source.fixture_id !== input.fixtureId
      || batch.source.source_sha256 !== input.fixtureSha256
    ) {
      throw new Error('Canonical market batch source identity does not match the requested fixture.')
    }
    return this.orderFlow.analyzeMarketBatch({
      batch,
      session: input.session,
      analysis: input.analysis,
      timeoutMs: input.timeoutMs,
      traceId: input.traceId,
      ...(input.cancellationId ? { cancellationId: input.cancellationId } : {}),
    })
  }
}
