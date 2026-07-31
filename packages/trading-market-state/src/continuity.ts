import {
  MARKET_FEED_CONTINUITY_SCHEMA_VERSION,
  identifierSchema,
  marketFeedContinuitySchema,
  nanosecondTimestampSchema,
  type MarketFeedContinuity,
  type MarketTradeEvent,
} from '@trade-god/contracts'

interface MarketFeedContinuityGuardOptions {
  provider: string
  instrumentId: string
  staleAfterNs: string
}

interface SequenceObservation {
  sequence: string
  eventNs: string
  observedAtNs: string
}

function positiveSequence(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value)) throw new TypeError('Market sequence must be a positive integer string.')
  return BigInt(value)
}

export class MarketFeedContinuityGuard {
  private connectionEpoch = 0
  private state: MarketFeedContinuity['state'] = 'unavailable'
  private observedAtNs = '0'
  private lastEventNs: string | undefined
  private lastSequence: string | undefined
  private resynchronizedAtNs: string | undefined
  private missingRanges: MarketFeedContinuity['missing_ranges'] = []
  private faults = new Set<string>()

  readonly provider: string
  readonly instrumentId: string
  readonly staleAfterNs: string

  constructor(options: MarketFeedContinuityGuardOptions) {
    this.provider = identifierSchema.parse(options.provider)
    this.instrumentId = identifierSchema.parse(options.instrumentId)
    this.staleAfterNs = nanosecondTimestampSchema.parse(options.staleAfterNs)
    if (BigInt(this.staleAfterNs) <= 0n) throw new TypeError('Continuity stale threshold must be positive.')
  }

  connect(observedAtNs: string): MarketFeedContinuity {
    this.observedAtNs = nanosecondTimestampSchema.parse(observedAtNs)
    this.connectionEpoch += 1
    this.state = 'recovering'
    this.lastEventNs = undefined
    this.lastSequence = undefined
    this.resynchronizedAtNs = undefined
    this.missingRanges = []
    this.faults.clear()
    return this.snapshot()
  }

  disconnect(observedAtNs: string): MarketFeedContinuity {
    this.observedAtNs = nanosecondTimestampSchema.parse(observedAtNs)
    this.state = 'unavailable'
    this.lastEventNs = undefined
    this.lastSequence = undefined
    this.resynchronizedAtNs = undefined
    this.missingRanges = []
    this.faults.clear()
    return this.snapshot()
  }

  resynchronize(observation: SequenceObservation): MarketFeedContinuity {
    if (this.connectionEpoch === 0) throw new Error('Continuity guard must connect before resynchronization.')
    const sequence = positiveSequence(observation.sequence)
    const eventNs = nanosecondTimestampSchema.parse(observation.eventNs)
    const observedAtNs = nanosecondTimestampSchema.parse(observation.observedAtNs)
    if (BigInt(eventNs) > BigInt(observedAtNs)) throw new Error('Resynchronization event cannot be in the future.')

    this.lastSequence = sequence.toString()
    this.lastEventNs = eventNs
    this.observedAtNs = observedAtNs
    this.resynchronizedAtNs = observedAtNs
    this.missingRanges = []
    this.faults.clear()
    this.state = 'healthy'
    return this.snapshot()
  }

  observe(observation: SequenceObservation): MarketFeedContinuity {
    if (this.connectionEpoch === 0 || this.state === 'unavailable') {
      throw new Error('Continuity guard must connect before observing market events.')
    }
    const sequence = positiveSequence(observation.sequence)
    const eventNs = nanosecondTimestampSchema.parse(observation.eventNs)
    const observedAtNs = nanosecondTimestampSchema.parse(observation.observedAtNs)
    if (BigInt(eventNs) > BigInt(observedAtNs)) throw new Error('Observed market event cannot be in the future.')

    if (this.lastSequence !== undefined) {
      const priorSequence = BigInt(this.lastSequence)
      if (sequence < priorSequence) {
        this.faults.add('out-of-order-sequence')
        this.state = 'gapped'
      } else if (sequence > priorSequence + 1n) {
        this.missingRanges.push({
          start_sequence: (priorSequence + 1n).toString(),
          end_sequence: (sequence - 1n).toString(),
        })
        this.state = 'gapped'
      }
      if (this.lastEventNs !== undefined && BigInt(eventNs) < BigInt(this.lastEventNs)) {
        this.faults.add('out-of-order-event-time')
        this.state = 'gapped'
      }
      if (sequence <= priorSequence) {
        this.observedAtNs = observedAtNs
        return this.snapshot()
      }
    }

    this.lastSequence = sequence.toString()
    this.lastEventNs = eventNs
    this.observedAtNs = observedAtNs
    if (this.state === 'stale' && this.missingRanges.length === 0 && this.faults.size === 0) {
      this.state = 'healthy'
    }
    return this.snapshot()
  }

  markFault(code: string, observedAtNs: string): MarketFeedContinuity {
    this.faults.add(identifierSchema.parse(code))
    this.observedAtNs = nanosecondTimestampSchema.parse(observedAtNs)
    if (this.state !== 'recovering') this.state = 'gapped'
    return this.snapshot()
  }

  status(observedAtNs: string): MarketFeedContinuity {
    this.observedAtNs = nanosecondTimestampSchema.parse(observedAtNs)
    if (
      this.state === 'healthy'
      && this.lastEventNs !== undefined
      && BigInt(this.observedAtNs) - BigInt(this.lastEventNs) > BigInt(this.staleAfterNs)
    ) {
      this.state = 'stale'
    }
    return this.snapshot()
  }

  private snapshot(): MarketFeedContinuity {
    return marketFeedContinuitySchema.parse({
      continuity_schema_version: MARKET_FEED_CONTINUITY_SCHEMA_VERSION,
      provider: this.provider,
      instrument_id: this.instrumentId,
      state: this.state,
      connection_epoch: this.connectionEpoch,
      observed_at_ns: this.observedAtNs,
      stale_after_ns: this.staleAfterNs,
      ...(this.lastEventNs === undefined ? {} : { last_event_ns: this.lastEventNs }),
      ...(this.lastSequence === undefined ? {} : { last_sequence: this.lastSequence }),
      ...(this.resynchronizedAtNs === undefined ? {} : { resynchronized_at_ns: this.resynchronizedAtNs }),
      missing_ranges: this.missingRanges,
      faults: [...this.faults].sort(),
    })
  }
}

export function buildReplayContinuity(
  events: readonly MarketTradeEvent[],
  input: { provider: string; instrumentId: string; staleAfterNs: string; observedAtNs: string },
): MarketFeedContinuity {
  if (events.length === 0) {
    return marketFeedContinuitySchema.parse({
      continuity_schema_version: MARKET_FEED_CONTINUITY_SCHEMA_VERSION,
      provider: input.provider,
      instrument_id: input.instrumentId,
      state: 'unavailable',
      connection_epoch: 0,
      observed_at_ns: input.observedAtNs,
      stale_after_ns: input.staleAfterNs,
      missing_ranges: [],
      faults: [],
    })
  }

  const guard = new MarketFeedContinuityGuard({
    provider: input.provider,
    instrumentId: input.instrumentId,
    staleAfterNs: input.staleAfterNs,
  })
  guard.connect(events[0]!.ts_event_ns)
  const firstSequence = events[0]!.source.sequence
  if (!firstSequence) return guard.markFault('missing-provider-sequence', input.observedAtNs)
  guard.resynchronize({
    sequence: firstSequence,
    eventNs: events[0]!.ts_event_ns,
    observedAtNs: events[0]!.ts_event_ns,
  })
  for (const event of events.slice(1)) {
    if (!event.source.sequence) {
      guard.markFault('missing-provider-sequence', event.ts_event_ns)
      continue
    }
    guard.observe({
      sequence: event.source.sequence,
      eventNs: event.ts_event_ns,
      observedAtNs: event.ts_event_ns,
    })
  }
  return guard.status(input.observedAtNs)
}
