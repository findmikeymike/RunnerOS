import { describe, expect, test } from 'bun:test'

import {
  canonicalJson,
  agentMarketSnapshotSchema,
  marketCandleSeriesSchema,
  type MarketTradeBatch,
} from '@trade-god/contracts'

import {
  assertAgentMarketSnapshotIntegrity,
  buildAgentMarketSnapshot,
  buildMarketReplaySnapshot,
} from '../src/index.ts'

const sessionWindow = {
  session_window_schema_version: 'market-session-window@1' as const,
  session_id: '2026-07-11-synthetic',
  exchange_timezone: 'America/Chicago',
  calendar_id: 'trade-god-synthetic',
  calendar_version: '1.0.0',
  trade_date: '2026-07-11',
  kind: 'synthetic' as const,
  segments: [{ open_ns: '1783780200000000000', close_ns: '1783780260000000000' }],
}


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

describe('bounded agent market context', () => {
  test('packages current price, recent trades, candles, quality, freshness, and authority', async () => {
    const snapshot = buildAgentMarketSnapshot({
      snapshotId: 'agent-market-fixture-001', traceId: 'trace-agent-market-fixture',
      intervalNs: '20000000000', watermarkNs: '1783780230000000000', staleAfterNs: '5000000000',
      sessionWindow, recentTradeLimit: 2, closedCandleLimit: 1, batches: [await fixtureBatch()],
    })

    expect(agentMarketSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    expect(snapshot.authority).toEqual({ purpose: 'analysis', execution_allowed: false, order_submission_allowed: false })
    expect(snapshot.current).toMatchObject({ price: { value: '5592.00' }, event_id: 'trade:es-demo-2026-07-11:4' })
    expect(snapshot.freshness).toEqual({ state: 'fresh', age_ns: '0', stale_after_ns: '5000000000' })
    expect(snapshot.trades).toMatchObject({ visible_count: 4, returned_count: 2, truncated: true })
    expect(snapshot.trades.events.map((event) => event.event_id)).toEqual([
      'trade:es-demo-2026-07-11:3', 'trade:es-demo-2026-07-11:4',
    ])
    expect(snapshot.candles).toMatchObject({ total_closed_count: 1, returned_closed_count: 1, truncated: false })
    expect(snapshot.candles.developing?.trade_count).toBe(2)
    const { snapshot_content_sha256: _digest, ...content } = snapshot
    expect(new Bun.CryptoHasher('sha256').update(canonicalJson(content)).digest('hex')).toBe(snapshot.snapshot_content_sha256)
    expect(assertAgentMarketSnapshotIntegrity(snapshot)).toEqual(snapshot)
    expect(() => assertAgentMarketSnapshotIntegrity({
      ...snapshot, snapshot_content_sha256: 'b'.repeat(64),
    })).toThrow('checksum')
  })

  test('marks old replay state stale and truncates older closed candles deterministically', async () => {
    const snapshot = buildAgentMarketSnapshot({
      snapshotId: 'agent-market-stale', traceId: 'trace-agent-market-stale',
      intervalNs: '10000000000', watermarkNs: '1783780240000000000', staleAfterNs: '5000000000',
      sessionWindow, recentTradeLimit: 4, closedCandleLimit: 2, batches: [await fixtureBatch()],
    })

    expect(snapshot.freshness.state).toBe('stale')
    expect(snapshot.freshness.age_ns).toBe('10000000000')
    expect(snapshot.candles.total_closed_count).toBe(4)
    expect(snapshot.candles.returned_closed_count).toBe(2)
    expect(snapshot.candles.truncated).toBe(true)
    expect(snapshot.candles.closed.map((candle) => candle.last_event_id)).toEqual([
      'trade:es-demo-2026-07-11:3', 'trade:es-demo-2026-07-11:4',
    ])
  })

  test('rejects unbounded context requests before building agent payloads', async () => {
    const input = {
      snapshotId: 'agent-market-bounds', traceId: 'trace-agent-market-bounds',
      intervalNs: '20000000000', watermarkNs: '1783780230000000000', staleAfterNs: '5000000000',
      sessionWindow, batches: [await fixtureBatch()],
    }
    expect(() => buildAgentMarketSnapshot({ ...input, recentTradeLimit: 501 })).toThrow('recentTradeLimit')
    expect(() => buildAgentMarketSnapshot({ ...input, closedCandleLimit: 201 })).toThrow('closedCandleLimit')
  })

  test('returns explicit no-data context before the first visible event', async () => {
    const snapshot = buildAgentMarketSnapshot({
      snapshotId: 'agent-market-no-data', traceId: 'trace-agent-market-no-data',
      intervalNs: '20000000000', watermarkNs: '1783780190000000000', staleAfterNs: '5000000000',
      sessionWindow, batches: [await fixtureBatch()],
    })

    expect(snapshot.instrument.id).toBe('CME:ESU6')
    expect(snapshot.current).toBeUndefined()
    expect(snapshot.freshness).toEqual({ state: 'no-data', stale_after_ns: '5000000000' })
    expect(snapshot.quality.state).toBe('unavailable')
    expect(snapshot.trades).toMatchObject({ visible_count: 0, returned_count: 0, truncated: false })
    expect(snapshot.provenance.batches).toEqual([])
  })

  test('marks sequence gaps and out-of-window evidence inadmissible', async () => {
    const batch = await fixtureBatch()
    batch.events[3]!.source.sequence = '6'
    rehash(batch)
    const outsideWindow = {
      ...sessionWindow,
      segments: [{ open_ns: '1783780000000000000', close_ns: '1783780210000000000' }],
    }
    const snapshot = buildAgentMarketSnapshot({
      snapshotId: 'agent-market-gap', traceId: 'trace-agent-market-gap',
      intervalNs: '20000000000', watermarkNs: '1783780230000000000', staleAfterNs: '5000000000',
      sessionWindow: outsideWindow, batches: [batch],
    })

    expect(snapshot.readiness.continuity).toMatchObject({
      state: 'gapped',
      missing_ranges: [{ start_sequence: '4', end_sequence: '5' }],
    })
    expect(snapshot.readiness.session.state).toBe('outside')
  })
})
