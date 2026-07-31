import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  positiveDecimalStringSchema,
  semverSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'
import { instrumentSchema } from './analysis.ts'
import {
  MARKET_QUALITY_REPORT_SCHEMA_VERSION,
  MARKET_DATA_RPC_PROTOCOL_VERSION,
  IBKR_GATEWAY_HEALTH_SCHEMA_VERSION,
  MARKET_CANDLE_SCHEMA_VERSION,
  MARKET_CANDLE_SERIES_SCHEMA_VERSION,
  MARKET_FEED_CONTINUITY_SCHEMA_VERSION,
  MARKET_SESSION_WINDOW_SCHEMA_VERSION,
  AGENT_MARKET_SNAPSHOT_SCHEMA_VERSION,
  MARKET_TRADE_BATCH_SCHEMA_VERSION,
  MARKET_TRADE_EVENT_SCHEMA_VERSION,
  MARKET_REPLAY_SESSION_SCHEMA_VERSION,
  MARKET_REPLAY_STEP_SCHEMA_VERSION,
} from './version.ts'

export const MARKET_TRADE_BATCH_MAX_EVENTS = 10_000
export const MARKET_JSONL_SUPERVISOR_MAX_LINE_BYTES = 1_000_000
export const MARKET_JSONL_REPLAY_SAFE_COMPLETION_BYTES = 750_000
export const MARKET_JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND = 1_000

export const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.string(),
  z.number().int().safe(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

export function canonicalJson(value: unknown): string {
  const jsonValue = jsonValueSchema.parse(value)
  if (jsonValue === null || typeof jsonValue !== 'object') return JSON.stringify(jsonValue)
  if (Array.isArray(jsonValue)) return `[${jsonValue.map(canonicalJson).join(',')}]`

  const record = jsonValue as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`
  )).join(',')}}`
}

export const nanosecondTimestampSchema = z.string().regex(
  /^(?:0|[1-9]\d*)$/,
  'Expected an unsigned nanosecond timestamp string',
)

const integerStringSchema = z.string().regex(
  /^-?(?:0|[1-9]\d*)$/,
  'Expected an integer string',
)

const positiveIntegerStringSchema = z.string().regex(
  /^[1-9]\d*$/,
  'Expected a positive integer string',
)

function decimalRawValue(value: string, precision: number): string | null {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  if (fraction.length > precision) return null
  const digits = `${whole}${fraction.padEnd(precision, '0')}`
  return BigInt(`${negative ? '-' : ''}${digits}`).toString()
}

function createFixedPointSchema(valueSchema: z.ZodType<string>, rawSchema: z.ZodString) {
  return z.object({
    value: valueSchema,
    raw: rawSchema,
    precision: z.number().int().min(0).max(18),
  }).catchall(jsonValueSchema).superRefine((value, context) => {
    if (decimalRawValue(value.value, value.precision) !== value.raw) {
      context.addIssue({
        code: 'custom',
        path: ['raw'],
        message: 'Fixed-point raw value does not match value and precision',
      })
    }
  })
}

export const fixedPointValueSchema = createFixedPointSchema(decimalStringSchema, integerStringSchema)
export const positiveFixedPointValueSchema = createFixedPointSchema(
  positiveDecimalStringSchema,
  positiveIntegerStringSchema,
)
const nonNegativeDecimalStringSchema = decimalStringSchema.refine((value) => !value.startsWith('-'), {
  message: 'Expected a non-negative decimal string',
})
const nonNegativeIntegerStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/, 'Expected a non-negative integer string')
export const nonNegativeFixedPointValueSchema = createFixedPointSchema(
  nonNegativeDecimalStringSchema,
  nonNegativeIntegerStringSchema,
)

const marketProducerSchema = z.object({
  name: identifierSchema,
  version: semverSchema,
}).catchall(jsonValueSchema)

const marketSourceSchema = z.object({
  provider: identifierSchema,
  record_id: identifierSchema,
  sequence: positiveIntegerStringSchema.optional(),
  mode: z.enum(['replay', 'live']),
  fixture_id: identifierSchema.optional(),
  fixture_sha256: sha256Schema.optional(),
}).catchall(jsonValueSchema).superRefine((source, context) => {
  if (source.mode === 'replay' && (!source.fixture_id || !source.fixture_sha256)) {
    context.addIssue({
      code: 'custom',
      message: 'Replay events require fixture identity and checksum',
    })
  }
})

const extensionKeySchema = z.string().regex(
  /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/,
  'Extension keys must be namespaced',
)

export const marketTradeEventSchema = z.object({
  event_schema_version: z.literal(MARKET_TRADE_EVENT_SCHEMA_VERSION),
  event_id: identifierSchema,
  trace_id: identifierSchema,
  producer: marketProducerSchema,
  instrument: instrumentSchema.catchall(jsonValueSchema),
  ts_event_ns: nanosecondTimestampSchema,
  ts_init_ns: nanosecondTimestampSchema,
  price: fixedPointValueSchema,
  size: positiveFixedPointValueSchema,
  aggressor_side: z.enum(['buyer', 'seller', 'unknown']),
  trade_id: identifierSchema.optional(),
  source: marketSourceSchema,
  quality_flags: z.array(identifierSchema).max(32),
  provenance: z.object({
    source_schema: identifierSchema,
    transformations: z.array(identifierSchema).max(32),
  }).passthrough(),
  extensions: z.record(extensionKeySchema, jsonValueSchema),
}).catchall(jsonValueSchema)

export const marketQualityIssueSchema = z.object({
  code: identifierSchema,
  severity: z.enum(['warning', 'error']),
  message: z.string().min(1).max(500),
  event_id: identifierSchema.optional(),
  record_id: identifierSchema.optional(),
  details: z.record(z.string(), jsonValueSchema).optional(),
}).catchall(jsonValueSchema)

export const marketQualityReportSchema = z.object({
  quality_report_schema_version: z.literal(MARKET_QUALITY_REPORT_SCHEMA_VERSION),
  batch_id: identifierSchema,
  trace_id: identifierSchema,
  state: z.enum(['valid', 'degraded', 'invalid']),
  counts: z.object({
    received: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    out_of_order: z.number().int().nonnegative(),
  }).catchall(jsonValueSchema),
  flags: z.array(identifierSchema).max(64),
  issues: z.array(marketQualityIssueSchema).max(MARKET_TRADE_BATCH_MAX_EVENTS),
  source_sha256: sha256Schema,
  canonical_events_sha256: sha256Schema,
}).catchall(jsonValueSchema).superRefine((report, context) => {
  if (report.counts.received !== report.counts.accepted + report.counts.rejected) {
    context.addIssue({
      code: 'custom',
      path: ['counts'],
      message: 'Received count must equal accepted plus rejected',
    })
  }

  if (report.state === 'valid' && (
    report.counts.rejected > 0
    || report.counts.duplicates > 0
    || report.counts.out_of_order > 0
    || report.flags.length > 0
    || report.issues.length > 0
  )) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'A valid quality report cannot contain defects',
    })
  }

  const hasDefect = report.counts.rejected > 0
    || report.counts.duplicates > 0
    || report.counts.out_of_order > 0
    || report.flags.length > 0
    || report.issues.length > 0
  if (report.state !== 'valid' && !hasDefect) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: 'A degraded or invalid report must identify at least one defect',
    })
  }

  if (report.counts.duplicates > report.counts.received || report.counts.out_of_order > report.counts.received) {
    context.addIssue({
      code: 'custom',
      path: ['counts'],
      message: 'Diagnostic counts cannot exceed received records',
    })
  }
})

export const marketTradeBatchSchema = z.object({
  batch_schema_version: z.literal(MARKET_TRADE_BATCH_SCHEMA_VERSION),
  batch_id: identifierSchema,
  trace_id: identifierSchema,
  mode: z.enum(['replay', 'live']),
  instrument_id: identifierSchema,
  source: z.object({
    provider: identifierSchema,
    fixture_id: identifierSchema.optional(),
    source_sha256: sha256Schema,
  }).catchall(jsonValueSchema),
  event_time_range: z.object({
    start_ns: nanosecondTimestampSchema,
    end_ns: nanosecondTimestampSchema,
  }).catchall(jsonValueSchema),
  events: z.array(marketTradeEventSchema).min(1).max(MARKET_TRADE_BATCH_MAX_EVENTS),
  quality: marketQualityReportSchema,
  canonical_events_sha256: sha256Schema,
}).catchall(jsonValueSchema).superRefine((batch, context) => {
  const checks: Array<[boolean, Array<string | number>, string]> = [
    [batch.quality.batch_id === batch.batch_id, ['quality', 'batch_id'], 'Quality batch ID must match batch'],
    [batch.quality.trace_id === batch.trace_id, ['quality', 'trace_id'], 'Quality trace ID must match batch'],
    [batch.quality.counts.accepted === batch.events.length, ['quality', 'counts', 'accepted'], 'Accepted count must match emitted events'],
    [batch.quality.source_sha256 === batch.source.source_sha256, ['quality', 'source_sha256'], 'Quality source checksum must match batch'],
    [batch.quality.canonical_events_sha256 === batch.canonical_events_sha256, ['quality', 'canonical_events_sha256'], 'Quality canonical checksum must match batch'],
  ]

  for (const [valid, path, message] of checks) {
    if (!valid) context.addIssue({ code: 'custom', path, message })
  }

  const eventIds = new Set<string>()
  const sourceRecordIds = new Set<string>()
  for (const [index, event] of batch.events.entries()) {
    if (event.trace_id !== batch.trace_id) {
      context.addIssue({ code: 'custom', path: ['events', index, 'trace_id'], message: 'Event trace ID must match batch' })
    }
    if (event.instrument.id !== batch.instrument_id) {
      context.addIssue({ code: 'custom', path: ['events', index, 'instrument', 'id'], message: 'Event instrument must match batch' })
    }
    if (event.source.provider !== batch.source.provider || event.source.mode !== batch.mode) {
      context.addIssue({ code: 'custom', path: ['events', index, 'source'], message: 'Event source must match batch' })
    }
    if (batch.mode === 'replay' && (
      event.source.fixture_id !== batch.source.fixture_id
      || event.source.fixture_sha256 !== batch.source.source_sha256
    )) {
      context.addIssue({ code: 'custom', path: ['events', index, 'source'], message: 'Replay fixture identity must match batch' })
    }
    if (eventIds.has(event.event_id)) {
      context.addIssue({ code: 'custom', path: ['events', index, 'event_id'], message: 'Canonical event IDs must be unique' })
    }
    eventIds.add(event.event_id)
    if (sourceRecordIds.has(event.source.record_id)) {
      context.addIssue({ code: 'custom', path: ['events', index, 'source', 'record_id'], message: 'Canonical source record IDs must be unique' })
    }
    sourceRecordIds.add(event.source.record_id)
  }

  const timestamps = batch.events.map((event) => BigInt(event.ts_event_ns))
  const minimum = timestamps.reduce((left, right) => left < right ? left : right)
  const maximum = timestamps.reduce((left, right) => left > right ? left : right)
  if (BigInt(batch.event_time_range.start_ns) !== minimum) {
    context.addIssue({ code: 'custom', path: ['event_time_range', 'start_ns'], message: 'Start must equal earliest event time' })
  }
  if (BigInt(batch.event_time_range.end_ns) !== maximum) {
    context.addIssue({ code: 'custom', path: ['event_time_range', 'end_ns'], message: 'End must equal latest event time' })
  }
})

export const marketDataCommandSchema = z.enum([
  'market.health',
  'market.capabilities',
  'market.ibkr_gateway_health',
  'market.load_fixture',
  'market.replay_batch',
  'market.replay_next',
  'market.cancel',
  'market.shutdown',
])

const requiredMarketDataCommands = [
  'market.health',
  'market.capabilities',
  'market.ibkr_gateway_health',
  'market.load_fixture',
  'market.shutdown',
] as const

export const ibkrGatewayEnvironmentSchema = z.enum(['paper', 'live'])

export const ibkrGatewayHealthRequestSchema = z.object({
  environment: ibkrGatewayEnvironmentSchema,
}).strict()

export const ibkrGatewayHealthSchema = z.object({
  health_schema_version: z.literal(IBKR_GATEWAY_HEALTH_SCHEMA_VERSION),
  provider: z.literal('interactive-brokers'),
  environment: ibkrGatewayEnvironmentSchema,
  state: z.enum(['ready', 'unavailable']),
  host: z.enum(['127.0.0.1', '::1', 'localhost']),
  port: z.union([z.literal(4001), z.literal(4002)]),
  client_id: z.number().int().min(1).max(999),
  api_session_authenticated: z.boolean(),
  server_version: z.number().int().positive().optional(),
  market_data_entitlement: z.literal('unverified'),
  gateway_read_only_setting: z.literal('unverified'),
  connector_authority: z.literal('health-only'),
  failure: z.enum(['connection-failed', 'authentication-timeout']).optional(),
}).strict().superRefine((health, context) => {
  const expectedPort = health.environment === 'paper' ? 4002 : 4001
  if (health.port !== expectedPort) {
    context.addIssue({ code: 'custom', path: ['port'], message: 'IB Gateway port must match its environment' })
  }
  if (health.state === 'ready' && (!health.api_session_authenticated || !health.server_version || health.failure)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Ready IB Gateway health requires an authenticated API session' })
  }
  if (health.state === 'unavailable' && (health.api_session_authenticated || health.server_version || !health.failure)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Unavailable IB Gateway health must fail closed with a reason' })
  }
})

export type IbkrGatewayEnvironment = z.infer<typeof ibkrGatewayEnvironmentSchema>
export type IbkrGatewayHealth = z.infer<typeof ibkrGatewayHealthSchema>

export const marketDataCapabilitiesSchema = z.object({
  commands: z.array(marketDataCommandSchema).min(requiredMarketDataCommands.length).max(marketDataCommandSchema.options.length),
  fixture_mode: z.literal(true),
  fixture_ids: z.array(identifierSchema).max(32),
  live_data: z.literal(false),
  broker_access: z.literal(false),
  trade_execution: z.literal(false),
  transport_policy: z.object({
    mode: z.literal('bounded-jsonl-control'),
    supervisor_max_line_bytes: z.literal(MARKET_JSONL_SUPERVISOR_MAX_LINE_BYTES),
    safe_completion_bytes: z.literal(MARKET_JSONL_REPLAY_SAFE_COMPLETION_BYTES),
    protocol_max_target_events_per_second: z.literal(MARKET_JSONL_REPLAY_PROTOCOL_MAX_TARGET_EVENTS_PER_SECOND),
    dedicated_streaming_required_for_live: z.literal(true),
  }).strict(),
}).superRefine((capabilities, context) => {
  const commands = new Set(capabilities.commands)
  if (commands.size !== capabilities.commands.length || requiredMarketDataCommands.some((command) => !commands.has(command))) {
    context.addIssue({ code: 'custom', path: ['commands'], message: 'Market-data commands must match the declared RPC capability set' })
  }
  const replayCommands = ['market.replay_batch', 'market.replay_next', 'market.cancel'] as const
  if (replayCommands.some((command) => commands.has(command)) && replayCommands.some((command) => !commands.has(command))) {
    context.addIssue({ code: 'custom', path: ['commands'], message: 'Paced replay capabilities must be declared as one complete set' })
  }
})

const marketDataProtocolFields = {
  protocol_version: z.literal(MARKET_DATA_RPC_PROTOCOL_VERSION),
  artifact_versions: z.tuple([z.literal(MARKET_TRADE_BATCH_SCHEMA_VERSION)]),
}

export const marketDataHealthSchema = z.object({
  service: z.literal('trade-god-market-data-engine'),
  version: semverSchema,
  state: z.enum(['ready', 'degraded', 'stopped']),
  ...marketDataProtocolFields,
  capabilities: marketDataCapabilitiesSchema,
  dependencies: z.array(z.object({
    name: identifierSchema,
    state: z.enum(['ready', 'unavailable']),
  })).max(16),
})

export const marketDataCapabilitiesResponseSchema = z.object({
  ...marketDataProtocolFields,
  commands: marketDataCapabilitiesSchema.shape.commands,
  fixture_mode: z.literal(true),
  fixture_ids: marketDataCapabilitiesSchema.shape.fixture_ids,
  live_data: z.literal(false),
  broker_access: z.literal(false),
  trade_execution: z.literal(false),
  transport_policy: marketDataCapabilitiesSchema.shape.transport_policy,
}).superRefine((capabilities, context) => {
  const commands = new Set(capabilities.commands)
  if (commands.size !== capabilities.commands.length || requiredMarketDataCommands.some((command) => !commands.has(command))) {
    context.addIssue({ code: 'custom', path: ['commands'], message: 'Market-data commands must match the declared RPC capability set' })
  }
  const replayCommands = ['market.replay_batch', 'market.replay_next', 'market.cancel'] as const
  if (replayCommands.some((command) => commands.has(command)) && replayCommands.some((command) => !commands.has(command))) {
    context.addIssue({ code: 'custom', path: ['commands'], message: 'Paced replay capabilities must be declared as one complete set' })
  }
})

export const marketDataErrorSchema = z.object({
  code: identifierSchema,
  category: z.enum(['validation', 'data-quality', 'internal', 'lifecycle', 'canceled', 'timeout', 'transport']),
  message: z.string().min(1).max(500),
  retryable: z.literal(false),
  quality_report: marketQualityReportSchema.optional(),
})

export const marketLoadFixtureRequestSchema = z.object({
  fixture_id: identifierSchema,
  trace_id: identifierSchema,
  batch_id: identifierSchema,
})

export const marketReplayStartRequestSchema = z.object({
  fixture_id: identifierSchema,
  trace_id: identifierSchema,
  batch_id: identifierSchema,
  replay_id: identifierSchema,
  cancellation_id: identifierSchema,
  pace_interval_ms: z.number().int().min(1).max(60_000),
  deadline_at: utcTimestampSchema,
}).strict()

export const marketReplaySessionSchema = z.object({
  replay_schema_version: z.literal(MARKET_REPLAY_SESSION_SCHEMA_VERSION),
  replay_id: identifierSchema,
  cancellation_id: identifierSchema,
  trace_id: identifierSchema,
  batch_id: identifierSchema,
  instrument_id: identifierSchema,
  event_count: z.number().int().positive().max(MARKET_TRADE_BATCH_MAX_EVENTS),
  canonical_events_sha256: sha256Schema,
  pace_interval_ms: z.number().int().min(1).max(60_000),
  state: z.literal('ready'),
  next_index: z.literal(0),
  started_at: utcTimestampSchema,
  deadline_at: utcTimestampSchema,
}).strict().superRefine((session, context) => {
  if (Date.parse(session.deadline_at) <= Date.parse(session.started_at)) {
    context.addIssue({ code: 'custom', path: ['deadline_at'], message: 'Replay deadline must follow its start' })
  }
})

export const marketReplayNextRequestSchema = z.object({ replay_id: identifierSchema }).strict()
export const marketReplayCancelRequestSchema = z.object({ cancellation_id: identifierSchema }).strict()

const marketReplayStepBase = {
  replay_step_schema_version: z.literal(MARKET_REPLAY_STEP_SCHEMA_VERSION),
  replay_id: identifierSchema,
  trace_id: identifierSchema,
  batch_id: identifierSchema,
  emitted_count: z.number().int().nonnegative().max(MARKET_TRADE_BATCH_MAX_EVENTS),
  remaining_count: z.number().int().nonnegative().max(MARKET_TRADE_BATCH_MAX_EVENTS),
}

export const marketReplayEventStepSchema = z.object({
  ...marketReplayStepBase,
  state: z.literal('event'),
  event_index: z.number().int().nonnegative().max(MARKET_TRADE_BATCH_MAX_EVENTS - 1),
  emitted_at: utcTimestampSchema,
  event: marketTradeEventSchema,
}).strict().superRefine((step, context) => {
  if (step.emitted_count !== step.event_index + 1) {
    context.addIssue({ code: 'custom', path: ['emitted_count'], message: 'Replay event cursor must advance exactly once' })
  }
})

export const marketReplayCompletedStepSchema = z.object({
  ...marketReplayStepBase,
  state: z.literal('completed'),
  remaining_count: z.literal(0),
  completed_at: utcTimestampSchema,
  batch: marketTradeBatchSchema,
}).strict().superRefine((step, context) => {
  if (
    step.replay_id.length === 0
    || step.trace_id !== step.batch.trace_id
    || step.batch_id !== step.batch.batch_id
    || step.emitted_count !== step.batch.events.length
  ) context.addIssue({ code: 'custom', path: ['batch'], message: 'Completed replay identity and counts must match its batch' })
})

export const marketReplayStepSchema = z.union([marketReplayEventStepSchema, marketReplayCompletedStepSchema])

export const marketReplayCancellationSchema = z.object({
  replay_id: identifierSchema,
  cancellation_id: identifierSchema,
  state: z.literal('canceled'),
  canceled_at: utcTimestampSchema,
}).strict()

const positiveNanosecondDurationSchema = z.string().regex(/^[1-9]\d*$/, 'Expected a positive nanosecond duration string')

function scaledRaw(value: { raw: string; precision: number }, precision: number): bigint {
  return BigInt(value.raw) * (10n ** BigInt(precision - value.precision))
}

function compareFixedPoint(
  left: { raw: string; precision: number },
  right: { raw: string; precision: number },
): number {
  const precision = Math.max(left.precision, right.precision)
  const leftRaw = scaledRaw(left, precision)
  const rightRaw = scaledRaw(right, precision)
  return leftRaw < rightRaw ? -1 : leftRaw > rightRaw ? 1 : 0
}

export const marketCandleSchema = z.object({
  candle_schema_version: z.literal(MARKET_CANDLE_SCHEMA_VERSION),
  candle_id: identifierSchema,
  trace_id: identifierSchema,
  instrument_id: identifierSchema,
  interval_ns: positiveNanosecondDurationSchema,
  alignment: z.literal('unix-epoch'),
  start_ns: nanosecondTimestampSchema,
  end_ns: nanosecondTimestampSchema,
  state: z.enum(['closed', 'developing']),
  open: fixedPointValueSchema,
  high: fixedPointValueSchema,
  low: fixedPointValueSchema,
  close: fixedPointValueSchema,
  volume: nonNegativeFixedPointValueSchema,
  buy_volume: nonNegativeFixedPointValueSchema,
  sell_volume: nonNegativeFixedPointValueSchema,
  unknown_volume: nonNegativeFixedPointValueSchema,
  delta: fixedPointValueSchema,
  trade_count: z.number().int().positive(),
  first_event_id: identifierSchema,
  last_event_id: identifierSchema,
  source_batch_ids: z.array(identifierSchema).min(1).max(64),
  quality_flags: z.array(identifierSchema).max(64),
}).superRefine((candle, context) => {
  if (BigInt(candle.end_ns) - BigInt(candle.start_ns) !== BigInt(candle.interval_ns)) {
    context.addIssue({ code: 'custom', path: ['end_ns'], message: 'Candle end must equal start plus interval' })
  }
  if (
    compareFixedPoint(candle.high, candle.open) < 0
    || compareFixedPoint(candle.high, candle.close) < 0
    || compareFixedPoint(candle.high, candle.low) < 0
    || compareFixedPoint(candle.low, candle.open) > 0
    || compareFixedPoint(candle.low, candle.close) > 0
  ) {
    context.addIssue({ code: 'custom', path: ['high'], message: 'Candle OHLC ordering is invalid' })
  }
  const volumePrecision = Math.max(
    candle.volume.precision,
    candle.buy_volume.precision,
    candle.sell_volume.precision,
    candle.unknown_volume.precision,
  )
  const componentVolume = scaledRaw(candle.buy_volume, volumePrecision)
    + scaledRaw(candle.sell_volume, volumePrecision)
    + scaledRaw(candle.unknown_volume, volumePrecision)
  if (scaledRaw(candle.volume, volumePrecision) !== componentVolume) {
    context.addIssue({ code: 'custom', path: ['volume'], message: 'Candle volume must equal side volumes' })
  }
  const deltaPrecision = Math.max(candle.delta.precision, candle.buy_volume.precision, candle.sell_volume.precision)
  if (
    scaledRaw(candle.delta, deltaPrecision)
    !== scaledRaw(candle.buy_volume, deltaPrecision) - scaledRaw(candle.sell_volume, deltaPrecision)
  ) {
    context.addIssue({ code: 'custom', path: ['delta'], message: 'Candle delta must equal buy minus sell volume' })
  }
  if (new Set(candle.source_batch_ids).size !== candle.source_batch_ids.length) {
    context.addIssue({ code: 'custom', path: ['source_batch_ids'], message: 'Candle source batches must be unique' })
  }
})

export const marketCandleSeriesSchema = z.object({
  series_schema_version: z.literal(MARKET_CANDLE_SERIES_SCHEMA_VERSION),
  snapshot_id: identifierSchema,
  trace_id: identifierSchema,
  instrument_id: identifierSchema,
  interval_ns: positiveNanosecondDurationSchema,
  alignment: z.literal('unix-epoch'),
  watermark_ns: nanosecondTimestampSchema,
  as_of_event_ns: nanosecondTimestampSchema.optional(),
  current_price: fixedPointValueSchema.optional(),
  current_event_id: identifierSchema.optional(),
  closed: z.array(marketCandleSchema).max(10_000),
  developing: marketCandleSchema.optional(),
  source_batch_ids: z.array(identifierSchema).max(64),
  quality_flags: z.array(identifierSchema).max(64),
}).superRefine((series, context) => {
  const currentFields = [series.as_of_event_ns, series.current_price, series.current_event_id]
  if (currentFields.some(Boolean) && !currentFields.every(Boolean)) {
    context.addIssue({ code: 'custom', path: ['current_price'], message: 'Current event time, price, and identity must appear together' })
  }
  if (series.as_of_event_ns && BigInt(series.as_of_event_ns) > BigInt(series.watermark_ns)) {
    context.addIssue({ code: 'custom', path: ['as_of_event_ns'], message: 'Current event cannot exceed the replay watermark' })
  }
  if (new Set(series.source_batch_ids).size !== series.source_batch_ids.length) {
    context.addIssue({ code: 'custom', path: ['source_batch_ids'], message: 'Series source batches must be unique' })
  }

  let priorEnd: bigint | undefined
  const allCandles = [...series.closed, ...(series.developing ? [series.developing] : [])]
  for (const [index, candle] of allCandles.entries()) {
    if (
      candle.trace_id !== series.trace_id
      || candle.instrument_id !== series.instrument_id
      || candle.interval_ns !== series.interval_ns
      || candle.alignment !== series.alignment
    ) {
      context.addIssue({ code: 'custom', path: ['closed', index], message: 'Candle identity must match its series' })
    }
    if (priorEnd !== undefined && BigInt(candle.start_ns) < priorEnd) {
      context.addIssue({ code: 'custom', path: ['closed', index, 'start_ns'], message: 'Candles must be ordered and non-overlapping' })
    }
    priorEnd = BigInt(candle.end_ns)
  }
  for (const [index, candle] of series.closed.entries()) {
    if (candle.state !== 'closed' || BigInt(candle.end_ns) > BigInt(series.watermark_ns)) {
      context.addIssue({ code: 'custom', path: ['closed', index, 'state'], message: 'Closed candles must end at or before the watermark' })
    }
  }
  if (series.developing && (
    series.developing.state !== 'developing'
    || BigInt(series.developing.start_ns) > BigInt(series.watermark_ns)
    || BigInt(series.developing.end_ns) <= BigInt(series.watermark_ns)
  )) {
    context.addIssue({ code: 'custom', path: ['developing'], message: 'Developing candle must contain the watermark' })
  }
  const latest = allCandles.at(-1)
  const hasCurrent = currentFields.every(Boolean)
  if ((latest && !hasCurrent) || (!latest && hasCurrent)) {
    context.addIssue({ code: 'custom', path: ['current_price'], message: 'Current market fields and visible candles must appear together' })
  }
  if (latest && series.current_event_id && latest.last_event_id !== series.current_event_id) {
    context.addIssue({ code: 'custom', path: ['current_event_id'], message: 'Current event must close the latest visible candle' })
  }
  if (latest && series.current_price && compareFixedPoint(latest.close, series.current_price) !== 0) {
    context.addIssue({ code: 'custom', path: ['current_price'], message: 'Current price must equal the latest visible close' })
  }
  const seriesBatchIds = new Set(series.source_batch_ids)
  const seriesFlags = new Set(series.quality_flags)
  for (const [index, candle] of allCandles.entries()) {
    if (candle.source_batch_ids.some((batchId) => !seriesBatchIds.has(batchId))) {
      context.addIssue({ code: 'custom', path: ['closed', index, 'source_batch_ids'], message: 'Candle source batches must belong to the series' })
    }
    if (candle.quality_flags.some((flag) => !seriesFlags.has(flag))) {
      context.addIssue({ code: 'custom', path: ['closed', index, 'quality_flags'], message: 'Candle quality flags must propagate to the series' })
    }
  }
  if (series.source_batch_ids.some((batchId) => !allCandles.some((candle) => candle.source_batch_ids.includes(batchId)))) {
    context.addIssue({ code: 'custom', path: ['source_batch_ids'], message: 'Series source batches must contribute to a visible candle' })
  }
})

export const AGENT_MARKET_SNAPSHOT_MAX_TRADES = 500
export const AGENT_MARKET_SNAPSHOT_MAX_CLOSED_CANDLES = 200
export const AGENT_MARKET_SNAPSHOT_MAX_ISSUES = 100

export const marketSessionWindowSchema = z.object({
  session_window_schema_version: z.literal(MARKET_SESSION_WINDOW_SCHEMA_VERSION),
  session_id: identifierSchema,
  exchange_timezone: z.string().min(1).max(100),
  calendar_id: identifierSchema,
  calendar_version: semverSchema,
  trade_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(['rth', 'eth', 'custom', 'synthetic']),
  segments: z.array(z.object({
    open_ns: nanosecondTimestampSchema,
    close_ns: nanosecondTimestampSchema,
  }).strict()).min(1).max(8),
}).strict().superRefine((window, context) => {
  let priorClose: bigint | undefined
  for (const [index, segment] of window.segments.entries()) {
    const open = BigInt(segment.open_ns)
    const close = BigInt(segment.close_ns)
    if (close <= open) {
      context.addIssue({ code: 'custom', path: ['segments', index, 'close_ns'], message: 'Session segment close must follow open' })
    }
    if (priorClose !== undefined && open < priorClose) {
      context.addIssue({ code: 'custom', path: ['segments', index, 'open_ns'], message: 'Session segments must be ordered and non-overlapping' })
    }
    priorClose = close
  }
})

const marketSequenceGapSchema = z.object({
  start_sequence: positiveIntegerStringSchema,
  end_sequence: positiveIntegerStringSchema,
}).strict().superRefine((gap, context) => {
  if (BigInt(gap.end_sequence) < BigInt(gap.start_sequence)) {
    context.addIssue({ code: 'custom', path: ['end_sequence'], message: 'Sequence gap end cannot precede start' })
  }
})

export const marketFeedContinuitySchema = z.object({
  continuity_schema_version: z.literal(MARKET_FEED_CONTINUITY_SCHEMA_VERSION),
  provider: identifierSchema,
  instrument_id: identifierSchema,
  state: z.enum(['healthy', 'recovering', 'gapped', 'stale', 'unavailable']),
  connection_epoch: z.number().int().nonnegative(),
  observed_at_ns: nanosecondTimestampSchema,
  stale_after_ns: z.string().regex(/^[1-9]\d*$/, 'Expected a positive nanosecond duration string'),
  last_event_ns: nanosecondTimestampSchema.optional(),
  last_sequence: positiveIntegerStringSchema.optional(),
  resynchronized_at_ns: nanosecondTimestampSchema.optional(),
  missing_ranges: z.array(marketSequenceGapSchema).max(64),
  faults: z.array(identifierSchema).max(64),
}).strict().superRefine((continuity, context) => {
  const hasCursor = continuity.last_event_ns !== undefined && continuity.last_sequence !== undefined
  if ((continuity.last_event_ns === undefined) !== (continuity.last_sequence === undefined)) {
    context.addIssue({ code: 'custom', path: ['last_sequence'], message: 'Continuity event time and sequence cursor must appear together' })
  }
  if (continuity.last_event_ns && BigInt(continuity.last_event_ns) > BigInt(continuity.observed_at_ns)) {
    context.addIssue({ code: 'custom', path: ['last_event_ns'], message: 'Continuity event time cannot exceed observation time' })
  }
  if (continuity.resynchronized_at_ns && BigInt(continuity.resynchronized_at_ns) > BigInt(continuity.observed_at_ns)) {
    context.addIssue({ code: 'custom', path: ['resynchronized_at_ns'], message: 'Resynchronization time cannot exceed observation time' })
  }
  if (continuity.state === 'healthy' && (!hasCursor || !continuity.resynchronized_at_ns || continuity.missing_ranges.length > 0 || continuity.faults.length > 0)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Healthy continuity requires a resynchronized cursor with no unresolved defects' })
  }
  if (
    continuity.state === 'healthy'
    && continuity.last_event_ns
    && BigInt(continuity.observed_at_ns) - BigInt(continuity.last_event_ns) > BigInt(continuity.stale_after_ns)
  ) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Healthy continuity cannot exceed its event-age threshold' })
  }
  if (continuity.state === 'gapped' && continuity.missing_ranges.length === 0 && continuity.faults.length === 0) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Gapped continuity must identify an unresolved defect' })
  }
  if (continuity.state === 'stale') {
    if (!hasCursor || BigInt(continuity.observed_at_ns) - BigInt(continuity.last_event_ns!) <= BigInt(continuity.stale_after_ns)) {
      context.addIssue({ code: 'custom', path: ['state'], message: 'Stale continuity must exceed its event-age threshold' })
    }
  }
  if (continuity.state === 'unavailable' && (hasCursor || continuity.resynchronized_at_ns || continuity.missing_ranges.length > 0)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Unavailable continuity cannot claim a sequence cursor or resynchronization' })
  }
  let priorEnd: bigint | undefined
  for (const [index, gap] of continuity.missing_ranges.entries()) {
    const start = BigInt(gap.start_sequence)
    if (priorEnd !== undefined && start <= priorEnd) {
      context.addIssue({ code: 'custom', path: ['missing_ranges', index], message: 'Sequence gaps must be ordered and non-overlapping' })
    }
    priorEnd = BigInt(gap.end_sequence)
  }
})

export const marketSessionAdmissionSchema = z.object({
  state: z.enum(['inside', 'outside', 'no-data']),
  window: marketSessionWindowSchema,
}).strict()

export const agentMarketSnapshotSchema = z.object({
  snapshot_schema_version: z.literal(AGENT_MARKET_SNAPSHOT_SCHEMA_VERSION),
  snapshot_id: identifierSchema,
  trace_id: identifierSchema,
  mode: z.literal('replay'),
  authority: z.object({
    purpose: z.literal('analysis'),
    execution_allowed: z.literal(false),
    order_submission_allowed: z.literal(false),
  }),
  instrument: instrumentSchema.catchall(jsonValueSchema),
  watermark_ns: nanosecondTimestampSchema,
  as_of_event_ns: nanosecondTimestampSchema.optional(),
  current: z.object({
    price: fixedPointValueSchema,
    event_id: identifierSchema,
  }).optional(),
  freshness: z.object({
    state: z.enum(['fresh', 'stale', 'no-data']),
    age_ns: nanosecondTimestampSchema.optional(),
    stale_after_ns: positiveNanosecondDurationSchema,
  }),
  readiness: z.object({
    continuity: marketFeedContinuitySchema,
    session: marketSessionAdmissionSchema,
  }).strict(),
  candles: z.object({
    interval_ns: positiveNanosecondDurationSchema,
    alignment: z.literal('unix-epoch'),
    closed: z.array(marketCandleSchema).max(AGENT_MARKET_SNAPSHOT_MAX_CLOSED_CANDLES),
    developing: marketCandleSchema.optional(),
    total_closed_count: z.number().int().nonnegative(),
    returned_closed_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  trades: z.object({
    events: z.array(marketTradeEventSchema).max(AGENT_MARKET_SNAPSHOT_MAX_TRADES),
    visible_count: z.number().int().nonnegative(),
    returned_count: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  quality: z.object({
    state: z.enum(['valid', 'degraded', 'unavailable']),
    flags: z.array(identifierSchema).max(256),
    counts: z.object({
      received: z.number().int().nonnegative(),
      accepted: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      duplicates: z.number().int().nonnegative(),
      out_of_order: z.number().int().nonnegative(),
    }),
    issues: z.array(marketQualityIssueSchema).max(AGENT_MARKET_SNAPSHOT_MAX_ISSUES),
    total_issue_count: z.number().int().nonnegative(),
    returned_issue_count: z.number().int().nonnegative(),
    issues_truncated: z.boolean(),
  }),
  provenance: z.object({
    batches: z.array(z.object({
      batch_id: identifierSchema,
      source_sha256: sha256Schema,
      canonical_events_sha256: sha256Schema,
    })).max(64),
    replay_engine: z.object({
      name: z.literal('trade-god-market-state'),
      version: semverSchema,
    }),
    deterministic: z.literal(true),
  }),
  snapshot_content_sha256: sha256Schema,
}).superRefine((snapshot, context) => {
  const hasCurrent = Boolean(snapshot.current && snapshot.as_of_event_ns)
  if (Boolean(snapshot.current) !== Boolean(snapshot.as_of_event_ns)) {
    context.addIssue({ code: 'custom', path: ['current'], message: 'Current price and event time must appear together' })
  }
  if (snapshot.as_of_event_ns && BigInt(snapshot.as_of_event_ns) > BigInt(snapshot.watermark_ns)) {
    context.addIssue({ code: 'custom', path: ['as_of_event_ns'], message: 'Agent context cannot exceed its watermark' })
  }
  if (hasCurrent) {
    const age = BigInt(snapshot.watermark_ns) - BigInt(snapshot.as_of_event_ns!)
    if (!snapshot.freshness.age_ns || BigInt(snapshot.freshness.age_ns) !== age) {
      context.addIssue({ code: 'custom', path: ['freshness', 'age_ns'], message: 'Freshness age must equal watermark minus current event time' })
    }
    const expectedState = age <= BigInt(snapshot.freshness.stale_after_ns) ? 'fresh' : 'stale'
    if (snapshot.freshness.state !== expectedState) {
      context.addIssue({ code: 'custom', path: ['freshness', 'state'], message: 'Freshness state does not match its threshold' })
    }
  } else if (snapshot.freshness.state !== 'no-data' || snapshot.freshness.age_ns !== undefined) {
    context.addIssue({ code: 'custom', path: ['freshness'], message: 'No-data context cannot claim freshness age' })
  }
  if (snapshot.readiness.continuity.instrument_id !== snapshot.instrument.id) {
    context.addIssue({ code: 'custom', path: ['readiness', 'continuity', 'instrument_id'], message: 'Continuity instrument must match snapshot instrument' })
  }
  if (snapshot.readiness.continuity.observed_at_ns !== snapshot.watermark_ns) {
    context.addIssue({ code: 'custom', path: ['readiness', 'continuity', 'observed_at_ns'], message: 'Continuity observation must match snapshot watermark' })
  }
  if (snapshot.readiness.continuity.stale_after_ns !== snapshot.freshness.stale_after_ns) {
    context.addIssue({ code: 'custom', path: ['readiness', 'continuity', 'stale_after_ns'], message: 'Continuity and freshness thresholds must match' })
  }
  const sessionContains = (timestamp: string): boolean => snapshot.readiness.session.window.segments.some(
    (segment) => BigInt(timestamp) >= BigInt(segment.open_ns) && BigInt(timestamp) < BigInt(segment.close_ns),
  )
  const expectedSessionState = snapshot.as_of_event_ns
    ? snapshot.trades.events.every((event) => sessionContains(event.ts_event_ns)) ? 'inside' : 'outside'
    : 'no-data'
  if (snapshot.readiness.session.state !== expectedSessionState) {
    context.addIssue({ code: 'custom', path: ['readiness', 'session', 'state'], message: 'Session admission state does not match the current event time' })
  }

  if (
    snapshot.trades.returned_count !== snapshot.trades.events.length
    || snapshot.trades.returned_count > snapshot.trades.visible_count
    || snapshot.trades.truncated !== (snapshot.trades.returned_count < snapshot.trades.visible_count)
  ) {
    context.addIssue({ code: 'custom', path: ['trades'], message: 'Trade context counts and truncation must agree' })
  }
  let priorTrade: MarketTradeEvent | undefined
  for (const [index, event] of snapshot.trades.events.entries()) {
    if (event.instrument.id !== snapshot.instrument.id || BigInt(event.ts_event_ns) > BigInt(snapshot.watermark_ns)) {
      context.addIssue({ code: 'custom', path: ['trades', 'events', index], message: 'Trade context instrument/time is outside snapshot scope' })
    }
    if (priorTrade) {
      const priorTime = BigInt(priorTrade.ts_event_ns)
      const eventTime = BigInt(event.ts_event_ns)
      if (eventTime < priorTime || (eventTime === priorTime && event.event_id.localeCompare(priorTrade.event_id) < 0)) {
        context.addIssue({ code: 'custom', path: ['trades', 'events', index], message: 'Trade context must be deterministically ordered' })
      }
    }
    priorTrade = event
  }
  const latestTrade = snapshot.trades.events.at(-1)
  if (hasCurrent && !latestTrade) {
    context.addIssue({ code: 'custom', path: ['trades', 'events'], message: 'Current context requires at least one returned trade' })
  }
  if (latestTrade && snapshot.current?.event_id !== latestTrade.event_id) {
    context.addIssue({ code: 'custom', path: ['current', 'event_id'], message: 'Current event must equal the latest returned trade' })
  }
  if (latestTrade && snapshot.current && compareFixedPoint(snapshot.current.price, latestTrade.price) !== 0) {
    context.addIssue({ code: 'custom', path: ['current', 'price'], message: 'Current price must equal the latest returned trade' })
  }
  if (
    latestTrade
    && (
      snapshot.readiness.continuity.provider !== latestTrade.source.provider
      || snapshot.readiness.continuity.last_event_ns !== latestTrade.ts_event_ns
      || snapshot.readiness.continuity.last_sequence !== latestTrade.source.sequence
    )
  ) {
    context.addIssue({ code: 'custom', path: ['readiness', 'continuity'], message: 'Continuity cursor must match the latest returned market event' })
  }
  if (!latestTrade && snapshot.readiness.continuity.state !== 'unavailable') {
    context.addIssue({ code: 'custom', path: ['readiness', 'continuity', 'state'], message: 'Context without market events must report unavailable continuity' })
  }

  if (
    snapshot.candles.returned_closed_count !== snapshot.candles.closed.length
    || snapshot.candles.returned_closed_count > snapshot.candles.total_closed_count
    || snapshot.candles.truncated !== (snapshot.candles.returned_closed_count < snapshot.candles.total_closed_count)
  ) {
    context.addIssue({ code: 'custom', path: ['candles'], message: 'Candle context counts and truncation must agree' })
  }
  const contextCandles = [...snapshot.candles.closed, ...(snapshot.candles.developing ? [snapshot.candles.developing] : [])]
  let priorCandleEnd: bigint | undefined
  for (const [index, candle] of contextCandles.entries()) {
    if (
      candle.trace_id !== snapshot.trace_id
      || candle.instrument_id !== snapshot.instrument.id
      || candle.interval_ns !== snapshot.candles.interval_ns
      || candle.alignment !== snapshot.candles.alignment
    ) {
      context.addIssue({ code: 'custom', path: ['candles', 'closed', index], message: 'Agent candle identity must match snapshot scope' })
    }
    if (priorCandleEnd !== undefined && BigInt(candle.start_ns) < priorCandleEnd) {
      context.addIssue({ code: 'custom', path: ['candles', 'closed', index], message: 'Agent candles must be ordered and non-overlapping' })
    }
    priorCandleEnd = BigInt(candle.end_ns)
  }
  const latestCandle = contextCandles.at(-1)
  if (latestCandle && snapshot.current && compareFixedPoint(snapshot.current.price, latestCandle.close) !== 0) {
    context.addIssue({ code: 'custom', path: ['current', 'price'], message: 'Current price must equal the latest returned candle close' })
  }

  const qualityHasDefect = snapshot.quality.flags.length > 0
    || snapshot.quality.issues.length > 0
    || snapshot.quality.counts.rejected > 0
    || snapshot.quality.counts.duplicates > 0
    || snapshot.quality.counts.out_of_order > 0
  if (snapshot.quality.state === 'valid' && qualityHasDefect) {
    context.addIssue({ code: 'custom', path: ['quality', 'state'], message: 'Valid agent context cannot contain quality defects' })
  }
  if (snapshot.quality.state === 'degraded' && !qualityHasDefect) {
    context.addIssue({ code: 'custom', path: ['quality', 'state'], message: 'Degraded agent context must identify a defect' })
  }
  if (snapshot.quality.state === 'unavailable' && hasCurrent) {
    context.addIssue({ code: 'custom', path: ['quality', 'state'], message: 'Unavailable agent context cannot contain current market data' })
  }
  if (!hasCurrent && snapshot.quality.state !== 'unavailable') {
    context.addIssue({ code: 'custom', path: ['quality', 'state'], message: 'Context without current market data must be unavailable' })
  }
  if (
    snapshot.quality.returned_issue_count !== snapshot.quality.issues.length
    || snapshot.quality.returned_issue_count > snapshot.quality.total_issue_count
    || snapshot.quality.issues_truncated !== (snapshot.quality.returned_issue_count < snapshot.quality.total_issue_count)
  ) {
    context.addIssue({ code: 'custom', path: ['quality', 'issues'], message: 'Quality issue counts and truncation must agree' })
  }
  if (snapshot.quality.counts.received !== snapshot.quality.counts.accepted + snapshot.quality.counts.rejected) {
    context.addIssue({ code: 'custom', path: ['quality', 'counts'], message: 'Quality received count must equal accepted plus rejected' })
  }
  const provenanceBatchIds = snapshot.provenance.batches.map((batch) => batch.batch_id)
  if (new Set(provenanceBatchIds).size !== provenanceBatchIds.length) {
    context.addIssue({ code: 'custom', path: ['provenance', 'batches'], message: 'Agent snapshot provenance batch IDs must be unique' })
  }
  const provenanceBatchSet = new Set(provenanceBatchIds)
  if (contextCandles.some((candle) => candle.source_batch_ids.some((batchId) => !provenanceBatchSet.has(batchId)))) {
    context.addIssue({ code: 'custom', path: ['provenance', 'batches'], message: 'Agent candle sources must map to snapshot batch provenance' })
  }
})

export type FixedPointValue = z.infer<typeof fixedPointValueSchema>
export type PositiveFixedPointValue = z.infer<typeof positiveFixedPointValueSchema>
export type MarketTradeEvent = z.infer<typeof marketTradeEventSchema>
export type MarketQualityIssue = z.infer<typeof marketQualityIssueSchema>
export type MarketQualityReport = z.infer<typeof marketQualityReportSchema>
export type MarketTradeBatch = z.infer<typeof marketTradeBatchSchema>
export type MarketDataHealth = z.infer<typeof marketDataHealthSchema>
export type MarketDataCapabilitiesResponse = z.infer<typeof marketDataCapabilitiesResponseSchema>
export type MarketDataError = z.infer<typeof marketDataErrorSchema>
export type MarketLoadFixtureRequest = z.infer<typeof marketLoadFixtureRequestSchema>
export type MarketReplayStartRequest = z.infer<typeof marketReplayStartRequestSchema>
export type MarketReplaySession = z.infer<typeof marketReplaySessionSchema>
export type MarketReplayStep = z.infer<typeof marketReplayStepSchema>
export type MarketReplayCancellation = z.infer<typeof marketReplayCancellationSchema>
export type NonNegativeFixedPointValue = z.infer<typeof nonNegativeFixedPointValueSchema>
export type MarketCandle = z.infer<typeof marketCandleSchema>
export type MarketCandleSeries = z.infer<typeof marketCandleSeriesSchema>
export type MarketSessionWindow = z.infer<typeof marketSessionWindowSchema>
export type MarketFeedContinuity = z.infer<typeof marketFeedContinuitySchema>
export type MarketSessionAdmission = z.infer<typeof marketSessionAdmissionSchema>
export type AgentMarketSnapshot = z.infer<typeof agentMarketSnapshotSchema>
