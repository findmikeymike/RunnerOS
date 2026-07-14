import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { loadEsDemoFixture } from '@trade-god/testkit'
import { CANONICAL_ORDER_FLOW_CONFIGURATION } from '@trade-god/contracts'

import { CanonicalOrderFlowPipeline } from '../canonical-order-flow-pipeline.ts'
import { MarketDataSidecarManager } from '../market-data-sidecar-manager.ts'
import { OrderFlowSidecarManager } from '../order-flow-sidecar-manager.ts'

const repoRoot = path.resolve(import.meta.dir, '../../../../../..')
const marketRoot = path.join(repoRoot, 'sidecars', 'market-data-engine')

describe('CanonicalOrderFlowPipeline', () => {
  test('runs the real Python canonical feed through the real supervised Order Flow child', async () => {
    const fixture = await loadEsDemoFixture()
    const receipts: any[] = []
    const marketData = new MarketDataSidecarManager({
      command: [
        path.join(marketRoot, '.venv', 'bin', 'python'), '-m', 'trade_god_market_data.cli',
        '--fixture-root', path.join(repoRoot, 'packages', 'trading-testkit', 'fixtures', 'es-demo'),
      ],
      cwd: marketRoot, requestTimeoutMs: 5_000, maxLineBytes: 1_000_000, maxStderrBytes: 4_096,
    })
    const orderFlow = new OrderFlowSidecarManager({
      command: [process.execPath, path.join(repoRoot, 'sidecars', 'order-flow-engine', 'src', 'cli.ts')],
      cwd: repoRoot, requestTimeoutMs: 5_000, maxLineBytes: 1_000_000, maxStderrBytes: 4_096,
      now: () => new Date().toISOString(),
      receiptWriter: { write: async (receipt) => { receipts.push(receipt) } },
    })
    try {
      const artifact = await new CanonicalOrderFlowPipeline(marketData, orderFlow).analyzeFixture({
        fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
        instrument: fixture.manifest.instrument,
        traceId: 'trace-real-canonical-order-flow',
        session: fixture.manifest.session,
        analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
        timeoutMs: 5_000,
      })

      expect(artifact.summary).toEqual({
        event_count: 4, total_volume: '28', buy_volume: '17', sell_volume: '11', unknown_volume: '0',
        delta: '6', point_of_control_price: '5592.25',
      })
      expect(artifact.input).toMatchObject({
        kind: 'canonical-market-batch', batch_id: 'batch-canonical-1',
        batch_trace_id: 'trace-real-canonical-order-flow',
      })
      expect(artifact.input).not.toHaveProperty('provider')
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({
        receipt_schema_version: 'trade-run-receipt@2', status: 'succeeded',
        request: { kind: 'canonical-market-batch', batch_id: 'batch-canonical-1' },
        artifact: { artifact_id: artifact.artifact_id, content_hash: artifact.content_hash },
      })
    } finally {
      await Promise.all([marketData.stop(), orderFlow.stop()])
    }
  })

  test('charges market-data loading against the caller deadline and forwards only the remaining budget', async () => {
    const fixture = await loadEsDemoFixture()
    let clock = 1_000
    let forwardedTimeout = 0
    const marketData = {
      loadFixture: async () => {
        clock += 700
        return (await Bun.file(path.join(repoRoot, 'packages/trading-contracts/examples/market-trade-batch.v1.json')).json())
      },
    }
    const orderFlow = {
      analyzeMarketBatch: async (input: any) => {
        forwardedTimeout = input.timeoutMs
        return { artifact_schema_version: 'order-flow-artifact@2' } as any
      },
    }
    const artifact = await new CanonicalOrderFlowPipeline(marketData as any, orderFlow as any, () => clock).analyzeFixture({
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      timeoutMs: 1_000,
      traceId: 'trace-budget-test',
    })

    expect(artifact.artifact_schema_version).toBe('order-flow-artifact@2')
    expect(forwardedTimeout).toBe(300)
  })

  test('times out while market data is still loading', async () => {
    const fixture = await loadEsDemoFixture()
    const never = new Promise<any>(() => {})
    const pipeline = new CanonicalOrderFlowPipeline(
      { loadFixture: () => never } as any,
      { analyzeMarketBatch: async () => { throw new Error('must not run') } } as any,
    )

    await expect(pipeline.analyzeFixture({
      fixture: { id: fixture.manifest.fixture_id, sha256: fixture.manifest.events_sha256 },
      instrument: fixture.manifest.instrument,
      session: fixture.manifest.session,
      analysis: CANONICAL_ORDER_FLOW_CONFIGURATION,
      timeoutMs: 5,
    })).rejects.toHaveProperty('name', 'CanonicalOrderFlowDeadlineError')
  })
})
