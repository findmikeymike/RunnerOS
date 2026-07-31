import { expect, test } from 'bun:test'

import type { MarketCandleSeries } from '@trade-god/contracts'
import type { UTCTimestamp } from 'lightweight-charts'

import { marketCandleSeriesToChartBars } from './chart-series-adapter.ts'

test('maps canonical fixed-point candles into chart bars without changing values', () => {
  const series = {
    closed: [{
      start_ns: '1785331800000000000',
      open: { value: '5592.00' },
      high: { value: '5593.25' },
      low: { value: '5591.75' },
      close: { value: '5593.00' },
      volume: { value: '420' },
    }],
  } as MarketCandleSeries

  expect(marketCandleSeriesToChartBars(series)).toEqual([{
    time: 1785331800 as UTCTimestamp,
    open: 5592,
    high: 5593.25,
    low: 5591.75,
    close: 5593,
    volume: 420,
  }])
  expect(marketCandleSeriesToChartBars(null)).toEqual([])
})
