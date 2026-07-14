import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { PROTOCOL_VERSION, canonicalJson } from '@trade-god/contracts'

import {
  CanonicalOrderFlowInputError,
  analyzeCanonicalMarketBatch,
} from '../src/analyze-market-batch.ts'

const meta = {
  schema_version: PROTOCOL_VERSION, trace_id: 'trace-calculator-test', created_at: '2026-07-13T12:00:00.000Z',
  producer: { name: 'calculator-test', version: '0.1.0', instance_id: 'calculator-test-1' },
}

async function batch(): Promise<any> {
  return Bun.file(new URL('../../../packages/trading-contracts/examples/market-trade-batch.v1.json', import.meta.url)).json()
}

function rehash(value: any): void {
  const checksum = createHash('sha256').update(canonicalJson(value.events), 'utf8').digest('hex')
  value.canonical_events_sha256 = checksum
  value.quality.canonical_events_sha256 = checksum
}

describe('canonical Order Flow calculator', () => {
  test('uses exact mixed-precision arithmetic, tracks unknown side, and breaks POC ties at the lower price', async () => {
    const value = await batch()
    value.events[0].price = { value: '100.00', raw: '10000', precision: 2 }
    value.events[0].size = { value: '1.0', raw: '10', precision: 1 }
    value.events[0].aggressor_side = 'buyer'
    value.events[1].price = { value: '100.0', raw: '1000', precision: 1 }
    value.events[1].size = { value: '2', raw: '2', precision: 0 }
    value.events[1].aggressor_side = 'seller'
    value.events[2].price = { value: '101', raw: '101', precision: 0 }
    value.events[2].size = { value: '1.50', raw: '150', precision: 2 }
    value.events[2].aggressor_side = 'unknown'
    value.events[3].price = { value: '101.00', raw: '10100', precision: 2 }
    value.events[3].size = { value: '1.5', raw: '15', precision: 1 }
    value.events[3].aggressor_side = 'buyer'
    rehash(value)

    const artifact = analyzeCanonicalMarketBatch(value, {
      meta, artifactId: 'artifact-mixed-precision', sessionId: 'CME-2026-07-11-RTH',
    })

    expect(artifact.summary).toEqual({
      event_count: 4, total_volume: '6.00', buy_volume: '2.50', sell_volume: '2.00',
      unknown_volume: '1.50', delta: '0.50', point_of_control_price: '100.00',
    })
  })

  test('rejects live input before deterministic analysis', async () => {
    const value = await batch()
    value.mode = 'live'
    delete value.source.fixture_id
    for (const event of value.events) {
      event.source.mode = 'live'
      delete event.source.fixture_id
      delete event.source.fixture_sha256
    }
    rehash(value)

    expect(() => analyzeCanonicalMarketBatch(value, {
      meta, artifactId: 'artifact-live-rejected', sessionId: 'CME-2026-07-11-RTH',
    })).toThrow(CanonicalOrderFlowInputError)
  })
})
