import { describe, expect, test } from 'bun:test'

import {
  MARKET_TRADE_BATCH_MAX_EVENTS,
  canonicalJson,
  marketDataCapabilitiesResponseSchema,
  marketDataErrorSchema,
  marketDataHealthSchema,
  marketCandleSeriesSchema,
  agentMarketSnapshotSchema,
  analyzeMarketBatchRequestSchema,
  canonicalOrderFlowArtifactSchema,
  marketLoadFixtureRequestSchema,
  marketQualityReportSchema,
  marketTradeBatchSchema,
  marketTradeEventSchema,
} from '../src/index.ts'

async function example(name: string): Promise<Record<string, any>> {
  return Bun.file(new URL(`../examples/${name}`, import.meta.url)).json()
}

describe('canonical market-data contracts', () => {
  test('accepts the golden market-trade event without mutable JS numbers', async () => {
    const result = marketTradeEventSchema.parse(await example('market-trade-event.v1.json'))

    expect(result.instrument.id).toBe('CME:ESU6')
    expect(result.ts_event_ns).toBe('1783780200000000000')
    expect(result.price).toEqual({ value: '5592.00', raw: '559200', precision: 2 })
  })

  test('accepts a complete quality report and bounded replay batch', async () => {
    const quality = marketQualityReportSchema.parse(await example('market-quality-report.v1.json'))
    const batch = marketTradeBatchSchema.parse(await example('market-trade-batch.v1.json'))
    const event = marketTradeEventSchema.parse(await example('market-trade-event.v1.json'))

    expect(quality.state).toBe('valid')
    expect(batch.events).toHaveLength(4)
    expect(batch.quality.counts.accepted).toBe(batch.events.length)
    expect(batch.events[0]).toEqual(event)
    expect(batch.quality).toEqual(quality)
    expect(new Bun.CryptoHasher('sha256').update(canonicalJson(batch.events)).digest('hex'))
      .toBe(batch.canonical_events_sha256)
  })

  test('rejects unsafe numeric timestamps and decimal values', async () => {
    const event = await example('market-trade-event.v1.json')
    event.ts_event_ns = 1_783_780_200_000_000_000
    event.price.value = 5592

    expect(marketTradeEventSchema.safeParse(event).success).toBe(false)
  })

  test('rejects fixed-point representations that do not round-trip', async () => {
    const event = await example('market-trade-event.v1.json')
    event.price.raw = '559201'

    expect(marketTradeEventSchema.safeParse(event).success).toBe(false)
  })

  test('accepts negative prices but still rejects non-positive size', async () => {
    const event = await example('market-trade-event.v1.json')
    event.price = { value: '-1.25', raw: '-125', precision: 2 }
    expect(marketTradeEventSchema.safeParse(event).success).toBe(true)

    event.size = { value: '0.0', raw: '0', precision: 1 }
    expect(marketTradeEventSchema.safeParse(event).success).toBe(false)
  })

  test('rejects empty defect claims and impossible diagnostic counts', async () => {
    const report = await example('market-quality-report.v1.json')
    report.state = 'degraded'
    expect(marketQualityReportSchema.safeParse(report).success).toBe(false)

    report.counts.duplicates = 5
    report.flags = ['duplicate-source-record']
    expect(marketQualityReportSchema.safeParse(report).success).toBe(false)
  })

  test('rejects non-JSON extension values', async () => {
    const event = await example('market-trade-event.v1.json')
    event.extensions['provider.bad'] = undefined

    expect(marketTradeEventSchema.safeParse(event).success).toBe(false)
  })

  test('rejects trace, instrument, count, and checksum disagreement inside a batch', async () => {
    const batch = await example('market-trade-batch.v1.json')
    batch.events[0].trace_id = 'trace-wrong'
    batch.events[0].instrument.id = 'CME:NQU6'
    batch.quality.counts.accepted = 2
    batch.quality.canonical_events_sha256 = 'b'.repeat(64)

    const result = marketTradeBatchSchema.safeParse(batch)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.length).toBeGreaterThanOrEqual(4)
  })

  test('rejects an unbounded JSON control-path batch', async () => {
    const batch = await example('market-trade-batch.v1.json')
    batch.events = Array.from({ length: MARKET_TRADE_BATCH_MAX_EVENTS + 1 }, () => batch.events[0])
    batch.quality.counts.accepted = batch.events.length
    batch.quality.counts.received = batch.events.length

    expect(marketTradeBatchSchema.safeParse(batch).success).toBe(false)
  })

  test('rejects repeated canonical source records even with different event IDs', async () => {
    const batch = await example('market-trade-batch.v1.json')
    batch.events.push({ ...batch.events[0], event_id: 'event-esu6-0002' })
    batch.quality.counts.accepted = 5
    batch.quality.counts.received = 5

    expect(marketTradeBatchSchema.safeParse(batch).success).toBe(false)
  })

  test('requires replay-only market-data RPC capability truth', () => {
    const capabilities = {
      commands: ['market.health', 'market.capabilities', 'market.load_fixture', 'market.shutdown'],
      fixture_mode: true,
      fixture_ids: ['es-demo-2026-07-11'],
      live_data: false,
      broker_access: false,
      trade_execution: false,
    }
    const health = marketDataHealthSchema.parse({
      service: 'trade-god-market-data-engine',
      version: '0.1.0',
      state: 'ready',
      protocol_version: 'market-data-rpc@1',
      artifact_versions: ['market-trade-batch@1'],
      capabilities,
      dependencies: [{ name: 'es-demo-2026-07-11', state: 'ready' }],
    })
    const response = marketDataCapabilitiesResponseSchema.parse({
      protocol_version: 'market-data-rpc@1',
      artifact_versions: ['market-trade-batch@1'],
      ...capabilities,
    })

    expect(health.state).toBe('ready')
    expect(response.live_data).toBe(false)
    expect(marketDataHealthSchema.safeParse({ ...health, capabilities: { ...capabilities, broker_access: true } }).success).toBe(false)
    expect(marketDataHealthSchema.safeParse({
      ...health,
      capabilities: { ...capabilities, commands: [...capabilities.commands, 'market.cancel'] },
    }).success).toBe(true)
    expect(marketDataHealthSchema.safeParse({
      ...health,
      capabilities: { ...capabilities, commands: [...capabilities.commands, 'market.place_order'] },
    }).success).toBe(false)
    expect(marketLoadFixtureRequestSchema.safeParse({
      fixture_id: 'es-demo-2026-07-11', trace_id: 'trace-valid', batch_id: 'batch-valid',
    }).success).toBe(true)
  })

  test('validates typed market-data quality errors', async () => {
    const quality = await example('market-quality-report.v1.json')
    quality.state = 'invalid'
    quality.counts.accepted = 0
    quality.counts.rejected = 4
    quality.flags = ['malformed-source-payload']
    quality.issues = [{ code: 'malformed-source-payload', severity: 'error', message: 'Fixture is malformed.' }]
    quality.canonical_events_sha256 = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e1b69a3c7a3d9a6fbe8d8e0'

    const error = marketDataErrorSchema.parse({
      code: 'MARKET_DATA_INVALID',
      category: 'data-quality',
      message: 'Fixture has no accepted records',
      retryable: false,
      quality_report: quality,
    })
    expect(error.quality_report?.state).toBe('invalid')
  })

  test('validates exact candle history and developing-candle invariants', () => {
    const price = { value: '5592.00', raw: '559200', precision: 2 }
    const zero = { value: '0', raw: '0', precision: 0 }
    const candle = {
      candle_schema_version: 'market-candle@1', candle_id: 'candle:CME:ESU6:1783780200000000000',
      trace_id: 'trace-candles', instrument_id: 'CME:ESU6', interval_ns: '20000000000',
      alignment: 'unix-epoch',
      start_ns: '1783780200000000000', end_ns: '1783780220000000000', state: 'closed',
      open: price, high: price, low: price, close: price,
      volume: { value: '5', raw: '5', precision: 0 }, buy_volume: { value: '5', raw: '5', precision: 0 },
      sell_volume: zero, unknown_volume: zero, delta: { value: '5', raw: '5', precision: 0 }, trade_count: 1,
      first_event_id: 'event-first', last_event_id: 'event-first', source_batch_ids: ['batch-one'], quality_flags: [],
    }
    const series = marketCandleSeriesSchema.parse({
      series_schema_version: 'market-candle-series@1', snapshot_id: 'snapshot-candles', trace_id: 'trace-candles',
      instrument_id: 'CME:ESU6', interval_ns: '20000000000', alignment: 'unix-epoch', watermark_ns: '1783780220000000000',
      as_of_event_ns: '1783780200000000000', current_price: price, current_event_id: 'event-first',
      closed: [candle], source_batch_ids: ['batch-one'], quality_flags: [],
    })

    expect(series.closed[0]?.state).toBe('closed')
    expect(marketCandleSeriesSchema.safeParse({ ...series, developing: candle }).success).toBe(false)
    expect(marketCandleSeriesSchema.safeParse({ ...series, source_batch_ids: [] }).success).toBe(false)
    expect(marketCandleSeriesSchema.safeParse({
      ...series, current_price: undefined, current_event_id: undefined, as_of_event_ns: undefined,
    }).success).toBe(false)
  })

  test('requires bounded analysis-only agent market context', async () => {
    const batch = await example('market-trade-batch.v1.json')
    const price = batch.events.at(-1).price
    const snapshot = {
      snapshot_schema_version: 'agent-market-snapshot@1', snapshot_id: 'agent-market-001', trace_id: 'trace-agent-market',
      mode: 'replay', authority: { purpose: 'analysis', execution_allowed: false, order_submission_allowed: false },
      instrument: batch.events[0].instrument, watermark_ns: '1783780230000000000', as_of_event_ns: '1783780230000000000',
      current: { price, event_id: batch.events.at(-1).event_id },
      freshness: { state: 'fresh', age_ns: '0', stale_after_ns: '5000000000' },
      candles: {
        interval_ns: '20000000000', alignment: 'unix-epoch', closed: [],
        total_closed_count: 0, returned_closed_count: 0, truncated: false,
      },
      trades: { events: batch.events.slice(-2), visible_count: 4, returned_count: 2, truncated: true },
      quality: {
        state: 'valid', flags: [], counts: batch.quality.counts, issues: [],
        total_issue_count: 0, returned_issue_count: 0, issues_truncated: false,
      },
      provenance: {
        batches: [{
          batch_id: batch.batch_id, source_sha256: batch.source.source_sha256,
          canonical_events_sha256: batch.canonical_events_sha256,
        }],
        replay_engine: { name: 'trade-god-market-state', version: '0.1.0' }, deterministic: true,
      },
      snapshot_content_sha256: 'a'.repeat(64),
    }

    expect(agentMarketSnapshotSchema.parse(snapshot).authority.execution_allowed).toBe(false)
    expect(agentMarketSnapshotSchema.safeParse({
      ...snapshot, authority: { ...snapshot.authority, execution_allowed: true },
    }).success).toBe(false)
    expect(agentMarketSnapshotSchema.safeParse({
      ...snapshot, trades: { ...snapshot.trades, returned_count: 4 },
    }).success).toBe(false)
    expect(agentMarketSnapshotSchema.safeParse({
      ...snapshot, current: { ...snapshot.current, price: { value: '1.00', raw: '100', precision: 2 } },
    }).success).toBe(false)
    expect(agentMarketSnapshotSchema.safeParse({
      ...snapshot, provenance: { ...snapshot.provenance, batches: [
        ...snapshot.provenance.batches, snapshot.provenance.batches[0],
      ] },
    }).success).toBe(false)
  })

  test('versions canonical market input and its provider-neutral Order Flow artifact', async () => {
    const batch = await example('market-trade-batch.v1.json')
    const meta = {
      schema_version: '1.0.0', trace_id: 'trace-order-flow-canonical', created_at: '2026-07-13T12:00:00.000Z',
      producer: { name: 'contract-test', version: '0.1.0', instance_id: 'contract-test-1' },
    }
    const request = analyzeMarketBatchRequestSchema.parse({
      meta,
      input: { schema_version: 'order-flow-market-input@1', kind: 'canonical-market-batch', batch },
      session: { exchange_timezone: 'America/Chicago', session_id: 'CME-2026-07-11-RTH' },
      analysis: { name: 'order-flow-summary', version: '0.2.0', configuration_hash: 'b'.repeat(64) },
      deadline_at: '2026-07-13T12:00:05.000Z', cancellation_id: 'cancel-canonical-contract',
    })
    const artifact = canonicalOrderFlowArtifactSchema.parse({
      meta,
      artifact_schema_version: 'order-flow-artifact@2', artifact_id: 'artifact-canonical-contract',
      artifact_type: 'order-flow-summary', algorithm: request.analysis,
      input: {
        schema_version: 'order-flow-market-input@1', kind: 'canonical-market-batch',
        batch_schema_version: batch.batch_schema_version, batch_id: batch.batch_id, batch_trace_id: batch.trace_id,
        canonical_events_sha256: batch.canonical_events_sha256, source_sha256: batch.source.source_sha256,
        mode: batch.mode, quality_state: batch.quality.state, event_count: batch.events.length,
      },
      instrument_id: batch.instrument_id, session_id: request.session.session_id,
      event_time_range: batch.event_time_range,
      quality: { state: 'valid', flags: [], warnings: [] }, content_hash: 'c'.repeat(64),
      summary: {
        event_count: 4, total_volume: '28', buy_volume: '17', sell_volume: '11', unknown_volume: '0',
        delta: '6', point_of_control_price: '5592.25',
      },
    })

    expect(request.input.batch.events).toHaveLength(4)
    expect(artifact.input).not.toHaveProperty('fixture_id')
    expect(canonicalOrderFlowArtifactSchema.safeParse({ ...artifact, artifact_schema_version: 'order-flow-artifact@1' }).success).toBe(false)
    expect(canonicalOrderFlowArtifactSchema.safeParse({
      ...artifact, summary: { ...artifact.summary, total_volume: '999', delta: '-999' },
    }).success).toBe(false)
    expect(canonicalOrderFlowArtifactSchema.safeParse({
      ...artifact, input: { ...artifact.input, event_count: 99 },
    }).success).toBe(false)
    expect(canonicalOrderFlowArtifactSchema.safeParse({
      ...artifact, event_time_range: { start_ns: artifact.event_time_range.end_ns, end_ns: '1' },
    }).success).toBe(false)
  })
})
