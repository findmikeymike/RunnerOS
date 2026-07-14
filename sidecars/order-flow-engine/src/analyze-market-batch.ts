import { createHash } from 'node:crypto'

import {
  MARKET_TRADE_BATCH_SCHEMA_VERSION,
  ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION,
  ORDER_FLOW_MARKET_INPUT_SCHEMA_VERSION,
  CANONICAL_ORDER_FLOW_CONFIGURATION,
  canonicalJson,
  canonicalOrderFlowArtifactSchema,
  marketTradeBatchSchema,
  type CanonicalOrderFlowArtifact,
  type FixedPointValue,
  type MarketTradeBatch,
  type WireMeta,
} from '@trade-god/contracts'

export const ORDER_FLOW_MAX_EVENTS = 5_000
export const ORDER_FLOW_MAX_REQUEST_BYTES = 750_000
export const ORDER_FLOW_MAX_LINE_BYTES = 800_000

export { CANONICAL_ORDER_FLOW_CONFIGURATION } from '@trade-god/contracts'

export interface AnalyzeCanonicalMarketBatchOptions {
  meta: WireMeta
  artifactId: string
  sessionId: string
}

export class CanonicalOrderFlowInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalOrderFlowInputError'
  }
}

function scaledRaw(value: FixedPointValue, precision: number): bigint {
  return BigInt(value.raw) * (10n ** BigInt(precision - value.precision))
}

function decimalFromRaw(raw: bigint, precision: number): string {
  const negative = raw < 0n
  const digits = (negative ? -raw : raw).toString().padStart(precision + 1, '0')
  if (precision === 0) return `${negative ? '-' : ''}${digits}`
  return `${negative ? '-' : ''}${digits.slice(0, -precision)}.${digits.slice(-precision)}`
}

function checksumEvents(batch: MarketTradeBatch): string {
  return createHash('sha256').update(canonicalJson(batch.events), 'utf8').digest('hex')
}

export function analyzeCanonicalMarketBatch(
  batchValue: MarketTradeBatch,
  options: AnalyzeCanonicalMarketBatchOptions,
): CanonicalOrderFlowArtifact {
  const batch = marketTradeBatchSchema.parse(batchValue)
  if (batch.mode !== 'replay') throw new CanonicalOrderFlowInputError('Order Flow canonical analysis is replay-only.')
  if (batch.quality.state === 'invalid') throw new CanonicalOrderFlowInputError('Order Flow rejects invalid-quality market batches.')
  if (batch.events.length > ORDER_FLOW_MAX_EVENTS) {
    throw new CanonicalOrderFlowInputError(`Order Flow accepts at most ${ORDER_FLOW_MAX_EVENTS} events per analysis.`)
  }
  if (checksumEvents(batch) !== batch.canonical_events_sha256) {
    throw new CanonicalOrderFlowInputError('Canonical market event checksum does not match the batch.')
  }

  const sizePrecision = Math.max(...batch.events.map((event) => event.size.precision))
  const pricePrecision = Math.max(...batch.events.map((event) => event.price.precision))
  let buy = 0n
  let sell = 0n
  let unknown = 0n
  const volumeByPrice = new Map<bigint, bigint>()

  for (const event of batch.events) {
    const size = scaledRaw(event.size, sizePrecision)
    if (event.aggressor_side === 'buyer') buy += size
    else if (event.aggressor_side === 'seller') sell += size
    else unknown += size
    const price = scaledRaw(event.price, pricePrecision)
    volumeByPrice.set(price, (volumeByPrice.get(price) ?? 0n) + size)
  }

  const pointOfControl = [...volumeByPrice.entries()].sort(([leftPrice, leftVolume], [rightPrice, rightVolume]) => {
    if (leftVolume !== rightVolume) return leftVolume > rightVolume ? -1 : 1
    return leftPrice < rightPrice ? -1 : leftPrice > rightPrice ? 1 : 0
  })[0]?.[0]
  if (pointOfControl === undefined) throw new CanonicalOrderFlowInputError('Order Flow input contains no price-volume observations.')

  const deterministicContent = {
    artifact_schema_version: ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION,
    artifact_type: 'order-flow-summary' as const,
    algorithm: CANONICAL_ORDER_FLOW_CONFIGURATION,
    input: {
      schema_version: ORDER_FLOW_MARKET_INPUT_SCHEMA_VERSION,
      kind: 'canonical-market-batch' as const,
      batch_schema_version: MARKET_TRADE_BATCH_SCHEMA_VERSION,
      batch_id: batch.batch_id,
      batch_trace_id: batch.trace_id,
      canonical_events_sha256: batch.canonical_events_sha256,
      source_sha256: batch.source.source_sha256,
      mode: batch.mode,
      quality_state: batch.quality.state,
      event_count: batch.events.length,
    },
    instrument_id: batch.instrument_id,
    session_id: options.sessionId,
    event_time_range: batch.event_time_range,
    quality: {
      state: batch.quality.state,
      flags: [...new Set(batch.quality.flags)].sort(),
      warnings: batch.quality.issues.map((issue) => issue.message).sort(),
    },
    summary: {
      event_count: batch.events.length,
      total_volume: decimalFromRaw(buy + sell + unknown, sizePrecision),
      buy_volume: decimalFromRaw(buy, sizePrecision),
      sell_volume: decimalFromRaw(sell, sizePrecision),
      unknown_volume: decimalFromRaw(unknown, sizePrecision),
      delta: decimalFromRaw(buy - sell, sizePrecision),
      point_of_control_price: decimalFromRaw(pointOfControl, pricePrecision),
    },
  }

  return canonicalOrderFlowArtifactSchema.parse({
    meta: options.meta,
    artifact_id: options.artifactId,
    ...deterministicContent,
    content_hash: createHash('sha256').update(canonicalJson(deterministicContent), 'utf8').digest('hex'),
  })
}
