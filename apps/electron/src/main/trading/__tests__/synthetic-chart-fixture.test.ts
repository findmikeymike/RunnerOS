import { describe, expect, test } from 'bun:test'

import { marketCandleSeriesSchema } from '@trade-god/contracts'

import { buildSyntheticEsChartFixture } from '../synthetic-chart-fixture.ts'

describe('synthetic ES chart fixture', () => {
  test('builds a deterministic, schema-valid RTH series', () => {
    const input = { symbol: 'ES', timeframe: '5m', sessionMode: 'RTH' } as const
    const first = buildSyntheticEsChartFixture(input)
    const second = buildSyntheticEsChartFixture(input)

    expect(first).not.toBeNull()
    if (!first) throw new Error('Expected the ES fixture to exist.')
    expect(marketCandleSeriesSchema.parse(first)).toEqual(first)
    expect(second).toEqual(first)
    expect(first?.closed).toHaveLength(78)
    expect(first?.interval_ns).toBe('300000000000')
    expect(first?.instrument_id).toBe('CME:ESU6')
    expect(first?.quality_flags).toEqual(['synthetic-project-fixture'])
  })

  test('changes density for timeframe and session controls', () => {
    expect(buildSyntheticEsChartFixture({
      symbol: 'ES', timeframe: '1m', sessionMode: 'RTH',
    })?.closed).toHaveLength(390)
    expect(buildSyntheticEsChartFixture({
      symbol: 'ES', timeframe: '1h', sessionMode: 'ETH',
    })?.closed).toHaveLength(12)
  })

  test('does not invent preview prices for unsupported symbols', () => {
    expect(buildSyntheticEsChartFixture({
      symbol: 'NQ', timeframe: '5m', sessionMode: 'RTH',
    })).toBeNull()
  })
})
