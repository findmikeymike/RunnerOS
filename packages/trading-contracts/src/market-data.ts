import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  positiveDecimalStringSchema,
  semverSchema,
  sha256Schema,
} from './common.ts'
import { instrumentSchema } from './analysis.ts'
import {
  MARKET_QUALITY_REPORT_SCHEMA_VERSION,
  MARKET_TRADE_BATCH_SCHEMA_VERSION,
  MARKET_TRADE_EVENT_SCHEMA_VERSION,
} from './version.ts'

export const MARKET_TRADE_BATCH_MAX_EVENTS = 10_000

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

function createFixedPointSchema(valueSchema: typeof decimalStringSchema, rawSchema: z.ZodString) {
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

const marketProducerSchema = z.object({
  name: identifierSchema,
  version: semverSchema,
}).catchall(jsonValueSchema)

const marketSourceSchema = z.object({
  provider: identifierSchema,
  record_id: identifierSchema,
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

export type FixedPointValue = z.infer<typeof fixedPointValueSchema>
export type PositiveFixedPointValue = z.infer<typeof positiveFixedPointValueSchema>
export type MarketTradeEvent = z.infer<typeof marketTradeEventSchema>
export type MarketQualityIssue = z.infer<typeof marketQualityIssueSchema>
export type MarketQualityReport = z.infer<typeof marketQualityReportSchema>
export type MarketTradeBatch = z.infer<typeof marketTradeBatchSchema>
