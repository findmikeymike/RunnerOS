import type { AnalyzeFixtureInput } from '@trade-god/client'
import type { CanonicalOrderFlowArtifact, MarketTradeBatch } from '@trade-god/contracts'

import type { MarketDataSidecarManager } from './market-data-sidecar-manager.ts'
import type { OrderFlowSidecarManager } from './order-flow-sidecar-manager.ts'

export class CanonicalOrderFlowDeadlineError extends Error {
  constructor() {
    super('Canonical Order Flow pipeline deadline elapsed while loading market data.')
    this.name = 'CanonicalOrderFlowDeadlineError'
  }
}

export class CanonicalOrderFlowPipeline {
  private sequence = 0

  constructor(
    private readonly marketData: Pick<MarketDataSidecarManager, 'loadFixture'>,
    private readonly orderFlow: Pick<OrderFlowSidecarManager, 'analyzeMarketBatch'>,
    private readonly nowMs: () => number = Date.now,
  ) {}

  async analyzeFixture(input: AnalyzeFixtureInput): Promise<CanonicalOrderFlowArtifact> {
    return (await this.analyzeFixtureEvidence(input)).artifact
  }

  async analyzeFixtureEvidence(input: AnalyzeFixtureInput): Promise<{
    batch: MarketTradeBatch
    artifact: CanonicalOrderFlowArtifact
  }> {
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new TypeError('timeoutMs must be a positive finite number.')
    }
    const startedAt = this.nowMs()
    const deadlineAt = startedAt + input.timeoutMs
    const traceId = input.traceId ?? this.nextId('trace-canonical')
    const batch = await this.beforeDeadline(this.marketData.loadFixture({
      fixtureId: input.fixture.id,
      traceId,
      batchId: this.nextId('batch-canonical'),
    }), deadlineAt)
    if (
      batch.source.fixture_id !== input.fixture.id
      || batch.source.source_sha256 !== input.fixture.sha256
      || batch.instrument_id !== input.instrument.id
    ) {
      throw new Error('Canonical market batch identity does not match the requested fixture and instrument.')
    }
    const remainingMs = deadlineAt - this.nowMs()
    if (remainingMs <= 0) throw new CanonicalOrderFlowDeadlineError()
    const artifact = await this.orderFlow.analyzeMarketBatch({
      batch,
      session: input.session,
      analysis: input.analysis,
      timeoutMs: remainingMs,
      traceId,
      ...(input.cancellationId ? { cancellationId: input.cancellationId } : {}),
    })
    return { batch, artifact }
  }

  private beforeDeadline<T>(operation: Promise<T>, deadlineAt: number): Promise<T> {
    const remainingMs = deadlineAt - this.nowMs()
    if (remainingMs <= 0) return Promise.reject(new CanonicalOrderFlowDeadlineError())
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CanonicalOrderFlowDeadlineError()), remainingMs)
      operation.then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error) => { clearTimeout(timer); reject(error) },
      )
    })
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}-${this.sequence}`
  }
}
