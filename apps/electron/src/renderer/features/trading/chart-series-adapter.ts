import type { MarketCandleSeries } from '@trade-god/contracts'
import type { UTCTimestamp } from 'lightweight-charts'

import type { FuturesChartBar } from './FuturesChartPanel.tsx'

export function marketCandleSeriesToChartBars(series: MarketCandleSeries | null): FuturesChartBar[] {
  if (!series) return []
  return [...series.closed, ...(series.developing ? [series.developing] : [])].map((candle) => ({
    time: Number(BigInt(candle.start_ns) / 1_000_000_000n) as UTCTimestamp,
    open: Number(candle.open.value),
    high: Number(candle.high.value),
    low: Number(candle.low.value),
    close: Number(candle.close.value),
    volume: Number(candle.volume.value),
  }))
}
