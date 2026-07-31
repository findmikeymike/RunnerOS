import {
  MARKET_CANDLE_SCHEMA_VERSION,
  MARKET_CANDLE_SERIES_SCHEMA_VERSION,
  marketCandleSeriesSchema,
  type FixedPointValue,
  type MarketCandleSeries,
  type NonNegativeFixedPointValue,
} from '@trade-god/contracts'

export const SYNTHETIC_CHART_TIMEFRAMES = ['1m', '5m', '15m', '1h'] as const
export type SyntheticChartTimeframe = (typeof SYNTHETIC_CHART_TIMEFRAMES)[number]
export type SyntheticChartSessionMode = 'ETH' | 'RTH'

export interface SyntheticChartFixtureInput {
  symbol: string
  timeframe: SyntheticChartTimeframe
  sessionMode: SyntheticChartSessionMode
}

const SOURCE_BATCH_ID = 'batch-synthetic-es-chart-preview'
const QUALITY_FLAG = 'synthetic-project-fixture'
const PRICE_PRECISION = 2
const TICK_RAW = 25n

const timeframeMinutes: Record<SyntheticChartTimeframe, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '1h': 60,
}

const sessionMinutes: Record<SyntheticChartSessionMode, number> = {
  ETH: 720,
  RTH: 390,
}

function fixedPoint(raw: bigint, precision: number): FixedPointValue {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw
  const digits = absolute.toString().padStart(precision + 1, '0')
  const value = precision === 0
    ? `${negative ? '-' : ''}${digits}`
    : `${negative ? '-' : ''}${digits.slice(0, -precision)}.${digits.slice(-precision)}`
  return { value, raw: raw.toString(), precision }
}

function nonNegativeFixedPoint(raw: bigint): NonNegativeFixedPointValue {
  return fixedPoint(raw, 0) as NonNegativeFixedPointValue
}

function deterministicCloseMove(index: number): bigint {
  const cycle = [2n, 1n, -1n, 3n, -2n, 1n, 0n, -1n, 2n, -3n, 1n, 2n]
  const drift = index < 24 ? 1n : index < 48 ? -1n : index < 72 ? 1n : 0n
  return cycle[index % cycle.length]! + drift
}

export function buildSyntheticEsChartFixture(
  input: SyntheticChartFixtureInput,
): MarketCandleSeries | null {
  if (input.symbol !== 'ES') return null
  if (!SYNTHETIC_CHART_TIMEFRAMES.includes(input.timeframe)) {
    throw new TypeError('Synthetic chart timeframe is invalid.')
  }
  if (input.sessionMode !== 'ETH' && input.sessionMode !== 'RTH') {
    throw new TypeError('Synthetic chart session mode is invalid.')
  }

  const minutes = timeframeMinutes[input.timeframe]
  const intervalNs = BigInt(minutes) * 60_000_000_000n
  const count = Math.ceil(sessionMinutes[input.sessionMode] / minutes)
  const startMs = Date.parse(
    input.sessionMode === 'RTH'
      ? '2026-07-29T13:30:00.000Z'
      : '2026-07-29T00:00:00.000Z',
  )
  const startNs = BigInt(startMs) * 1_000_000n
  const traceId = `trace-synthetic-es-${input.sessionMode.toLowerCase()}-${input.timeframe}`
  let priorCloseRaw = 559_200n

  const closed = Array.from({ length: count }, (_, index) => {
    const candleStartNs = startNs + (BigInt(index) * intervalNs)
    const candleEndNs = candleStartNs + intervalNs
    const openRaw = priorCloseRaw
    const closeRaw = openRaw + (deterministicCloseMove(index) * TICK_RAW)
    const upperWickTicks = BigInt(1 + (index % 3))
    const lowerWickTicks = BigInt(1 + ((index + 1) % 3))
    const highRaw = (openRaw > closeRaw ? openRaw : closeRaw) + (upperWickTicks * TICK_RAW)
    const lowRaw = (openRaw < closeRaw ? openRaw : closeRaw) - (lowerWickTicks * TICK_RAW)
    const volumeRaw = BigInt(280 + ((index * 47) % 420) + (minutes * 12))
    const buyRatio = closeRaw >= openRaw ? 58n : 42n
    const buyVolumeRaw = (volumeRaw * buyRatio) / 100n
    const sellVolumeRaw = volumeRaw - buyVolumeRaw
    const eventId = `synthetic-es-${input.sessionMode.toLowerCase()}-${input.timeframe}-${index + 1}`
    priorCloseRaw = closeRaw

    return {
      candle_schema_version: MARKET_CANDLE_SCHEMA_VERSION,
      candle_id: `candle-${eventId}`,
      trace_id: traceId,
      instrument_id: 'CME:ESU6',
      interval_ns: intervalNs.toString(),
      alignment: 'unix-epoch' as const,
      start_ns: candleStartNs.toString(),
      end_ns: candleEndNs.toString(),
      state: 'closed' as const,
      open: fixedPoint(openRaw, PRICE_PRECISION),
      high: fixedPoint(highRaw, PRICE_PRECISION),
      low: fixedPoint(lowRaw, PRICE_PRECISION),
      close: fixedPoint(closeRaw, PRICE_PRECISION),
      volume: nonNegativeFixedPoint(volumeRaw),
      buy_volume: nonNegativeFixedPoint(buyVolumeRaw),
      sell_volume: nonNegativeFixedPoint(sellVolumeRaw),
      unknown_volume: nonNegativeFixedPoint(0n),
      delta: fixedPoint(buyVolumeRaw - sellVolumeRaw, 0),
      trade_count: Math.max(1, Math.floor(Number(volumeRaw) / 4)),
      first_event_id: `${eventId}-open`,
      last_event_id: `${eventId}-close`,
      source_batch_ids: [SOURCE_BATCH_ID],
      quality_flags: [QUALITY_FLAG],
    }
  })

  const latest = closed.at(-1)!
  const watermarkNs = latest.end_ns
  return marketCandleSeriesSchema.parse({
    series_schema_version: MARKET_CANDLE_SERIES_SCHEMA_VERSION,
    snapshot_id: `snapshot-synthetic-es-${input.sessionMode.toLowerCase()}-${input.timeframe}`,
    trace_id: traceId,
    instrument_id: 'CME:ESU6',
    interval_ns: intervalNs.toString(),
    alignment: 'unix-epoch',
    watermark_ns: watermarkNs,
    as_of_event_ns: (BigInt(watermarkNs) - 1_000_000_000n).toString(),
    current_price: latest.close,
    current_event_id: latest.last_event_id,
    closed,
    source_batch_ids: [SOURCE_BATCH_ID],
    quality_flags: [QUALITY_FLAG],
  })
}
