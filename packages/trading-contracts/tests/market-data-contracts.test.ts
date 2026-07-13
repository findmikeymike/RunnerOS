import { describe, expect, test } from 'bun:test'

import {
  MARKET_TRADE_BATCH_MAX_EVENTS,
  canonicalJson,
  marketDataCapabilitiesResponseSchema,
  marketDataErrorSchema,
  marketDataHealthSchema,
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
})
