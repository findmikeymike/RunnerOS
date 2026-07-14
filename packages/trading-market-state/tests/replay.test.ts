import { describe, expect, test } from 'bun:test'

import {
  canonicalJson,
  marketCandleSeriesSchema,
  type MarketTradeBatch,
} from '@trade-god/contracts'

import { buildMarketReplaySnapshot } from '../src/index.ts'


async function fixtureBatch(): Promise<MarketTradeBatch> {
  return Bun.file(new URL('../../trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
}

function rehash(batch: MarketTradeBatch): MarketTradeBatch {
  const digest = new Bun.CryptoHasher('sha256').update(canonicalJson(batch.events)).digest('hex')
  batch.canonical_events_sha256 = digest
  batch.quality.canonical_events_sha256 = digest
  return batch
}

describe('deterministic market replay', () => {
  test('builds exact closed history, current price, and one developing candle', async () => {
    const batch = await fixtureBatch()
    const snapshot = buildMarketReplaySnapshot({
      snapshotId: 'snapshot-market-001',
      traceId: 'trace-replay-snapshot-001',
      intervalNs: '20000000000',
      watermarkNs: '1783780230000000000',
      batches: [batch],
    })

    expect(marketCandleSeriesSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.current_price).toEqual({ value: '5592.00', raw: '559200', precision: 2 })
    expect(snapshot.current_event_id).toBe('trade:es-demo-2026-07-11:4')
    expect(snapshot.alignment).toBe('unix-epoch')
    expect(snapshot.closed).toHaveLength(1)
    expect(snapshot.closed[0]).toMatchObject({
      state: 'closed', trade_count: 2,
      open: { value: '5592.00' }, high: { value: '5592.25' },
      low: { value: '5592.00' }, close: { value: '5592.25' },
      volume: { value: '17' }, buy_volume: { value: '17' },
      sell_volume: { value: '0' }, delta: { value: '17' },
    })
    expect(snapshot.developing).toMatchObject({
      state: 'developing', trade_count: 2,
      open: { value: '5592.25' }, close: { value: '5592.00' },
      volume: { value: '11' }, buy_volume: { value: '0' },
      sell_volume: { value: '11' }, delta: { value: '-11' },
    })
  })

  test('never exposes events or closes candles beyond the watermark', async () => {
    const snapshot = buildMarketReplaySnapshot({
      snapshotId: 'snapshot-no-lookahead',
      traceId: 'trace-no-lookahead',
      intervalNs: '20000000000',
      watermarkNs: '1783780215000000000',
      batches: [await fixtureBatch()],
    })

    expect(snapshot.closed).toEqual([])
    expect(snapshot.developing?.trade_count).toBe(2)
    expect(snapshot.current_event_id).toBe('trade:es-demo-2026-07-11:2')
    expect(snapshot.as_of_event_ns).toBe('1783780210000000000')
  })

  test('closes the final candle only when the watermark proves its interval ended', async () => {
    const snapshot = buildMarketReplaySnapshot({
      snapshotId: 'snapshot-closed',
      traceId: 'trace-closed',
      intervalNs: '20000000000',
      watermarkNs: '1783780240000000000',
      batches: [await fixtureBatch()],
    })

    expect(snapshot.closed).toHaveLength(2)
    expect(snapshot.developing).toBeUndefined()
  })

  test('sorts out-of-order input deterministically and deduplicates repeated batches', async () => {
    const batch = await fixtureBatch()
    batch.events.reverse()
    batch.quality.state = 'degraded'
    batch.quality.counts.out_of_order = 3
    batch.quality.flags = ['out-of-order-event-time']
    batch.quality.issues = [{
      code: 'out-of-order-event-time', severity: 'warning', message: 'Recorded input was out of order.',
    }]
    rehash(batch)

    const input = {
      snapshotId: 'snapshot-deterministic',
      traceId: 'trace-deterministic',
      intervalNs: '20000000000',
      watermarkNs: '1783780230000000000',
      batches: [batch, batch],
    } as const
    const first = buildMarketReplaySnapshot(input)
    const second = buildMarketReplaySnapshot(input)

    expect(first).toEqual(second)
    expect(first.current_event_id).toBe('trade:es-demo-2026-07-11:4')
    expect(first.closed[0]?.trade_count).toBe(2)
    expect(first.source_batch_ids).toEqual(['batch-es-demo-001'])
    expect(first.quality_flags).toContain('out-of-order-event-time')
  })

  test('deduplicates the same canonical market event across different replay traces', async () => {
    const firstBatch = await fixtureBatch()
    const secondBatch = structuredClone(firstBatch)
    secondBatch.batch_id = 'batch-es-demo-retry'
    secondBatch.trace_id = 'trace-market-retry'
    secondBatch.quality.batch_id = secondBatch.batch_id
    secondBatch.quality.trace_id = secondBatch.trace_id
    for (const event of secondBatch.events) event.trace_id = secondBatch.trace_id
    rehash(secondBatch)

    const snapshot = buildMarketReplaySnapshot({
      snapshotId: 'snapshot-retry-dedup', traceId: 'trace-retry-dedup', intervalNs: '20000000000',
      watermarkNs: '1783780230000000000', batches: [firstBatch, secondBatch],
    })

    expect(snapshot.closed[0]?.trade_count).toBe(2)
    expect(snapshot.developing?.trade_count).toBe(2)
    expect(snapshot.source_batch_ids).toEqual(['batch-es-demo-001', 'batch-es-demo-retry'])
  })

  test('rejects live batches and an unbounded number of replay batches', async () => {
    const live = await fixtureBatch()
    live.mode = 'live'
    delete live.source.fixture_id
    for (const event of live.events) {
      event.source.mode = 'live'
      delete event.source.fixture_id
      delete event.source.fixture_sha256
    }
    rehash(live)
    const base = {
      snapshotId: 'snapshot-bounds', traceId: 'trace-bounds', intervalNs: '20000000000',
      watermarkNs: '1783780230000000000',
    }

    expect(() => buildMarketReplaySnapshot({ ...base, batches: [live] })).toThrow('replay-mode')
    const replay = await fixtureBatch()
    expect(() => buildMarketReplaySnapshot({ ...base, batches: Array.from({ length: 65 }, () => replay) }))
      .toThrow('at most 64')

    replay.quality.state = 'invalid'
    replay.quality.flags = ['provider-data-invalid']
    replay.quality.issues = [{ code: 'provider-data-invalid', severity: 'error', message: 'Provider rejected the batch.' }]
    expect(() => buildMarketReplaySnapshot({ ...base, batches: [replay] })).toThrow('invalid-quality')
  })

  test('fails closed when canonical event bytes do not match their checksum', async () => {
    const batch = await fixtureBatch()
    batch.events[0]!.price = { value: '1.00', raw: '100', precision: 2 }

    expect(() => buildMarketReplaySnapshot({
      snapshotId: 'snapshot-tampered',
      traceId: 'trace-tampered',
      intervalNs: '20000000000',
      watermarkNs: '1783780230000000000',
      batches: [batch],
    })).toThrow('checksum')
  })
})
