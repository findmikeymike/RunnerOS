import { createHash } from 'node:crypto'

import {
  AGENT_MARKET_SNAPSHOT_MAX_CLOSED_CANDLES,
  AGENT_MARKET_SNAPSHOT_MAX_ISSUES,
  AGENT_MARKET_SNAPSHOT_MAX_TRADES,
  AGENT_MARKET_SNAPSHOT_SCHEMA_VERSION,
  MARKET_CANDLE_SCHEMA_VERSION,
  MARKET_CANDLE_SERIES_SCHEMA_VERSION,
  agentMarketSnapshotSchema,
  canonicalJson,
  identifierSchema,
  marketCandleSeriesSchema,
  marketTradeBatchSchema,
  nanosecondTimestampSchema,
  type AgentMarketSnapshot,
  type FixedPointValue,
  type MarketCandle,
  type MarketCandleSeries,
  type MarketTradeBatch,
  type MarketTradeEvent,
  type NonNegativeFixedPointValue,
} from '@trade-god/contracts'


export interface BuildMarketReplaySnapshotInput {
  snapshotId: string
  traceId: string
  intervalNs: string
  watermarkNs: string
  batches: readonly MarketTradeBatch[]
}

export const MARKET_REPLAY_MAX_BATCHES = 64
export const MARKET_REPLAY_MAX_EVENTS = 10_000

export interface BuildAgentMarketSnapshotInput extends BuildMarketReplaySnapshotInput {
  staleAfterNs: string
  recentTradeLimit?: number
  closedCandleLimit?: number
  qualityIssueLimit?: number
}

interface EventEntry {
  event: MarketTradeEvent
  batchIds: Set<string>
  qualityFlags: Set<string>
}

function compareFixedPoint(left: FixedPointValue, right: FixedPointValue): number {
  const precision = Math.max(left.precision, right.precision)
  const leftRaw = BigInt(left.raw) * (10n ** BigInt(precision - left.precision))
  const rightRaw = BigInt(right.raw) * (10n ** BigInt(precision - right.precision))
  return leftRaw < rightRaw ? -1 : leftRaw > rightRaw ? 1 : 0
}

function fixedPointFromRaw(raw: bigint, precision: number): FixedPointValue {
  const negative = raw < 0n
  const digits = (negative ? -raw : raw).toString().padStart(precision + 1, '0')
  const value = precision === 0
    ? `${negative ? '-' : ''}${digits}`
    : `${negative ? '-' : ''}${digits.slice(0, -precision)}.${digits.slice(-precision)}`
  return { value, raw: raw.toString(), precision }
}

function sumAtPrecision(values: FixedPointValue[], precision: number): bigint {
  return values.reduce(
    (total, value) => total + BigInt(value.raw) * (10n ** BigInt(precision - value.precision)),
    0n,
  )
}

function checksumEvents(events: MarketTradeEvent[]): string {
  return createHash('sha256').update(canonicalJson(events), 'utf8').digest('hex')
}

function eventIdentity(event: MarketTradeEvent): string {
  const { trace_id: _traceId, quality_flags: _qualityFlags, ...identity } = event
  return canonicalJson(identity)
}

function assertBatchChecksum(batch: MarketTradeBatch): void {
  if (checksumEvents(batch.events) !== batch.canonical_events_sha256) {
    throw new Error(`Market batch ${batch.batch_id} canonical checksum mismatch.`)
  }
}

function candleFromEntries(
  entries: EventEntry[],
  input: { traceId: string; instrumentId: string; intervalNs: bigint; startNs: bigint; watermarkNs: bigint },
): MarketCandle {
  const events = entries.map((entry) => entry.event)
  const first = events[0]!
  const last = events.at(-1)!
  const high = events.reduce((value, event) => compareFixedPoint(event.price, value) > 0 ? event.price : value, first.price)
  const low = events.reduce((value, event) => compareFixedPoint(event.price, value) < 0 ? event.price : value, first.price)
  const precision = Math.max(...events.map((event) => event.size.precision))
  const buy = sumAtPrecision(events.filter((event) => event.aggressor_side === 'buyer').map((event) => event.size), precision)
  const sell = sumAtPrecision(events.filter((event) => event.aggressor_side === 'seller').map((event) => event.size), precision)
  const unknown = sumAtPrecision(events.filter((event) => event.aggressor_side === 'unknown').map((event) => event.size), precision)
  const endNs = input.startNs + input.intervalNs
  const sourceBatchIds = [...new Set(entries.flatMap((entry) => [...entry.batchIds]))].sort()
  const qualityFlags = [...new Set(entries.flatMap((entry) => [...entry.qualityFlags]))].sort()

  return {
    candle_schema_version: MARKET_CANDLE_SCHEMA_VERSION,
    candle_id: `candle:${input.instrumentId}:${input.intervalNs}:${input.startNs}`,
    trace_id: input.traceId,
    instrument_id: input.instrumentId,
    interval_ns: input.intervalNs.toString(),
    alignment: 'unix-epoch',
    start_ns: input.startNs.toString(),
    end_ns: endNs.toString(),
    state: endNs <= input.watermarkNs ? 'closed' : 'developing',
    open: first.price,
    high,
    low,
    close: last.price,
    volume: fixedPointFromRaw(buy + sell + unknown, precision) as NonNegativeFixedPointValue,
    buy_volume: fixedPointFromRaw(buy, precision) as NonNegativeFixedPointValue,
    sell_volume: fixedPointFromRaw(sell, precision) as NonNegativeFixedPointValue,
    unknown_volume: fixedPointFromRaw(unknown, precision) as NonNegativeFixedPointValue,
    delta: fixedPointFromRaw(buy - sell, precision),
    trade_count: events.length,
    first_event_id: first.event_id,
    last_event_id: last.event_id,
    source_batch_ids: sourceBatchIds,
    quality_flags: qualityFlags,
  }
}

export function buildMarketReplaySnapshot(input: BuildMarketReplaySnapshotInput): MarketCandleSeries {
  const snapshotId = identifierSchema.parse(input.snapshotId)
  const traceId = identifierSchema.parse(input.traceId)
  const intervalNsValue = nanosecondTimestampSchema.parse(input.intervalNs)
  const watermarkNsValue = nanosecondTimestampSchema.parse(input.watermarkNs)
  const intervalNs = BigInt(intervalNsValue)
  const watermarkNs = BigInt(watermarkNsValue)
  if (intervalNs <= 0n) throw new TypeError('Replay candle interval must be positive.')
  if (input.batches.length === 0) throw new TypeError('Replay requires at least one canonical market batch.')
  if (input.batches.length > MARKET_REPLAY_MAX_BATCHES) {
    throw new TypeError(`Replay accepts at most ${MARKET_REPLAY_MAX_BATCHES} canonical market batches.`)
  }

  const eventEntries = new Map<string, EventEntry>()
  const sourceRecords = new Map<string, string>()
  const batchDigests = new Map<string, string>()
  let instrumentId: string | undefined
  let receivedEvents = 0

  for (const batchValue of input.batches) {
    const batch = marketTradeBatchSchema.parse(batchValue)
    receivedEvents += batch.events.length
    if (receivedEvents > MARKET_REPLAY_MAX_EVENTS) {
      throw new TypeError(`Replay accepts at most ${MARKET_REPLAY_MAX_EVENTS} canonical market events.`)
    }
    if (batch.mode !== 'replay') throw new TypeError('Market replay requires replay-mode canonical batches.')
    if (batch.quality.state === 'invalid') throw new TypeError('Market replay rejects invalid-quality canonical batches.')
    assertBatchChecksum(batch)
    if (instrumentId && batch.instrument_id !== instrumentId) {
      throw new Error('Replay batches must use one instrument.')
    }
    instrumentId = batch.instrument_id
    const batchDigest = canonicalJson(batch)
    const priorBatchDigest = batchDigests.get(batch.batch_id)
    if (priorBatchDigest && priorBatchDigest !== batchDigest) {
      throw new Error(`Replay batch id ${batch.batch_id} has conflicting content.`)
    }
    batchDigests.set(batch.batch_id, batchDigest)

    for (const event of batch.events) {
      const eventDigest = eventIdentity(event)
      const prior = eventEntries.get(event.event_id)
      if (prior && eventIdentity(prior.event) !== eventDigest) {
        throw new Error(`Replay event id ${event.event_id} has conflicting content.`)
      }
      const sourceKey = `${event.source.provider}:${event.source.record_id}`
      const priorSourceEvent = sourceRecords.get(sourceKey)
      if (priorSourceEvent && priorSourceEvent !== event.event_id) {
        throw new Error(`Replay source record ${sourceKey} has conflicting event identities.`)
      }
      sourceRecords.set(sourceKey, event.event_id)

      const entry = prior ?? {
        event,
        batchIds: new Set<string>(),
        qualityFlags: new Set<string>(),
      }
      entry.batchIds.add(batch.batch_id)
      for (const flag of [...batch.quality.flags, ...event.quality_flags]) entry.qualityFlags.add(flag)
      eventEntries.set(event.event_id, entry)
    }
  }

  const visible = [...eventEntries.values()]
    .filter((entry) => BigInt(entry.event.ts_event_ns) <= watermarkNs)
    .sort((left, right) => {
      const time = BigInt(left.event.ts_event_ns) - BigInt(right.event.ts_event_ns)
      return time < 0n ? -1 : time > 0n ? 1 : left.event.event_id.localeCompare(right.event.event_id)
    })

  const buckets = new Map<string, EventEntry[]>()
  for (const entry of visible) {
    const eventNs = BigInt(entry.event.ts_event_ns)
    const startNs = (eventNs / intervalNs) * intervalNs
    const key = startNs.toString()
    const bucket = buckets.get(key) ?? []
    bucket.push(entry)
    buckets.set(key, bucket)
  }

  const candles = [...buckets.entries()]
    .sort(([left], [right]) => BigInt(left) < BigInt(right) ? -1 : 1)
    .map(([startNs, entries]) => candleFromEntries(entries, {
      traceId,
      instrumentId: instrumentId!,
      intervalNs,
      startNs: BigInt(startNs),
      watermarkNs,
    }))
  const closed = candles.filter((candle) => candle.state === 'closed')
  const developing = candles.find((candle) => candle.state === 'developing')
  const latest = visible.at(-1)
  const sourceBatchIds = [...new Set(visible.flatMap((entry) => [...entry.batchIds]))].sort()
  const qualityFlags = [...new Set(visible.flatMap((entry) => [...entry.qualityFlags]))].sort()
  for (let index = 1; index < candles.length; index += 1) {
    if (BigInt(candles[index]!.start_ns) > BigInt(candles[index - 1]!.end_ns)) {
      qualityFlags.push('missing-candle-interval')
      break
    }
  }

  return marketCandleSeriesSchema.parse({
    series_schema_version: MARKET_CANDLE_SERIES_SCHEMA_VERSION,
    snapshot_id: snapshotId,
    trace_id: traceId,
    instrument_id: instrumentId!,
    interval_ns: intervalNs.toString(),
    alignment: 'unix-epoch',
    watermark_ns: watermarkNs.toString(),
    ...(latest ? {
      as_of_event_ns: latest.event.ts_event_ns,
      current_price: latest.event.price,
      current_event_id: latest.event.event_id,
    } : {}),
    closed,
    ...(developing ? { developing } : {}),
    source_batch_ids: sourceBatchIds,
    quality_flags: [...new Set(qualityFlags)].sort(),
  })
}

function boundedInteger(value: number | undefined, fallback: number, name: string, maximum: number, minimum = 0): number {
  const selected = value ?? fallback
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}.`)
  }
  return selected
}

export function buildAgentMarketSnapshot(input: BuildAgentMarketSnapshotInput): AgentMarketSnapshot {
  const recentTradeLimit = boundedInteger(
    input.recentTradeLimit, 200, 'recentTradeLimit', AGENT_MARKET_SNAPSHOT_MAX_TRADES, 1,
  )
  const closedCandleLimit = boundedInteger(
    input.closedCandleLimit, 100, 'closedCandleLimit', AGENT_MARKET_SNAPSHOT_MAX_CLOSED_CANDLES,
  )
  const qualityIssueLimit = boundedInteger(
    input.qualityIssueLimit, AGENT_MARKET_SNAPSHOT_MAX_ISSUES, 'qualityIssueLimit', AGENT_MARKET_SNAPSHOT_MAX_ISSUES,
  )
  const staleAfterNsValue = nanosecondTimestampSchema.parse(input.staleAfterNs)
  const staleAfterNs = BigInt(staleAfterNsValue)
  if (staleAfterNs <= 0n) throw new TypeError('staleAfterNs must be positive.')

  const series = buildMarketReplaySnapshot(input)
  const watermarkNs = BigInt(series.watermark_ns)
  const uniqueBatches = new Map<string, MarketTradeBatch>()
  const visibleEvents = new Map<string, MarketTradeEvent>()
  for (const batchValue of input.batches) {
    const batch = marketTradeBatchSchema.parse(batchValue)
    if (!uniqueBatches.has(batch.batch_id)) uniqueBatches.set(batch.batch_id, batch)
    for (const event of batch.events) {
      if (BigInt(event.ts_event_ns) > watermarkNs) continue
      const prior = visibleEvents.get(event.event_id)
      if (!prior || canonicalJson(event).localeCompare(canonicalJson(prior)) < 0) {
        visibleEvents.set(event.event_id, event)
      }
    }
  }
  const orderedEvents = [...visibleEvents.values()].sort((left, right) => {
    const time = BigInt(left.ts_event_ns) - BigInt(right.ts_event_ns)
    return time < 0n ? -1 : time > 0n ? 1 : left.event_id.localeCompare(right.event_id)
  })
  const recentEvents = orderedEvents.slice(-recentTradeLimit)
  const closed = closedCandleLimit === 0 ? [] : series.closed.slice(-closedCandleLimit)
  const contributingBatches = series.source_batch_ids
    .map((batchId) => uniqueBatches.get(batchId))
    .filter((batch): batch is MarketTradeBatch => Boolean(batch))
    .sort((left, right) => left.batch_id.localeCompare(right.batch_id))

  const counts = contributingBatches.reduce((total, batch) => ({
    received: total.received + batch.quality.counts.received,
    accepted: total.accepted + batch.quality.counts.accepted,
    rejected: total.rejected + batch.quality.counts.rejected,
    duplicates: total.duplicates + batch.quality.counts.duplicates,
    out_of_order: total.out_of_order + batch.quality.counts.out_of_order,
  }), { received: 0, accepted: 0, rejected: 0, duplicates: 0, out_of_order: 0 })
  const flags = [...new Set([
    ...series.quality_flags,
    ...contributingBatches.flatMap((batch) => batch.quality.flags),
  ])].sort()
  if (flags.length > 256) throw new Error('Agent market snapshot contains more than 256 quality flags.')
  const allIssues = [...new Map(
    contributingBatches
      .flatMap((batch) => batch.quality.issues)
      .map((issue) => [canonicalJson(issue), issue] as const),
  ).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, issue]) => issue)
  const issues = qualityIssueLimit === 0 ? [] : allIssues.slice(0, qualityIssueLimit)
  const hasDefect = flags.length > 0
    || allIssues.length > 0
    || counts.rejected > 0
    || counts.duplicates > 0
    || counts.out_of_order > 0
  const qualityState = orderedEvents.length === 0 ? 'unavailable' : hasDefect ? 'degraded' : 'valid'
  const instrument = orderedEvents[0]?.instrument
    ?? contributingBatches[0]?.events[0]?.instrument
    ?? [...uniqueBatches.values()][0]?.events[0]?.instrument
  if (!instrument) throw new Error('Agent market snapshot has no instrument context.')

  const freshness = series.as_of_event_ns
    ? (() => {
        const age = watermarkNs - BigInt(series.as_of_event_ns)
        return {
          state: age <= staleAfterNs ? 'fresh' as const : 'stale' as const,
          age_ns: age.toString(),
          stale_after_ns: staleAfterNs.toString(),
        }
      })()
    : { state: 'no-data' as const, stale_after_ns: staleAfterNs.toString() }

  const content = {
    snapshot_schema_version: AGENT_MARKET_SNAPSHOT_SCHEMA_VERSION,
    snapshot_id: series.snapshot_id,
    trace_id: series.trace_id,
    mode: 'replay' as const,
    authority: {
      purpose: 'analysis' as const,
      execution_allowed: false as const,
      order_submission_allowed: false as const,
    },
    instrument,
    watermark_ns: series.watermark_ns,
    ...(series.as_of_event_ns && series.current_price && series.current_event_id ? {
      as_of_event_ns: series.as_of_event_ns,
      current: { price: series.current_price, event_id: series.current_event_id },
    } : {}),
    freshness,
    candles: {
      interval_ns: series.interval_ns,
      alignment: series.alignment,
      closed,
      ...(series.developing ? { developing: series.developing } : {}),
      total_closed_count: series.closed.length,
      returned_closed_count: closed.length,
      truncated: closed.length < series.closed.length,
    },
    trades: {
      events: recentEvents,
      visible_count: orderedEvents.length,
      returned_count: recentEvents.length,
      truncated: recentEvents.length < orderedEvents.length,
    },
    quality: {
      state: qualityState,
      flags,
      counts,
      issues,
      total_issue_count: allIssues.length,
      returned_issue_count: issues.length,
      issues_truncated: issues.length < allIssues.length,
    },
    provenance: {
      batches: contributingBatches.map((batch) => ({
        batch_id: batch.batch_id,
        source_sha256: batch.source.source_sha256,
        canonical_events_sha256: batch.canonical_events_sha256,
      })),
      replay_engine: { name: 'trade-god-market-state' as const, version: '0.1.0' },
      deterministic: true as const,
    },
  }
  return assertAgentMarketSnapshotIntegrity({
    ...content,
    snapshot_content_sha256: createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex'),
  })
}

export function assertAgentMarketSnapshotIntegrity(value: unknown): AgentMarketSnapshot {
  const snapshot = agentMarketSnapshotSchema.parse(value)
  const { snapshot_content_sha256: digest, ...content } = snapshot
  const expected = createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex')
  if (digest !== expected) throw new Error('Agent market snapshot checksum mismatch.')
  return snapshot
}
