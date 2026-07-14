import { z } from 'zod'

import {
  analysisConfigurationSchema,
  qualitySchema,
  sessionSchema,
  type AnalysisArtifact,
} from './analysis.ts'
import {
  decimalStringSchema,
  identifierSchema,
  sha256Schema,
  utcTimestampSchema,
  wireMetaSchema,
} from './common.ts'
import { marketTradeBatchSchema } from './market-data.ts'
import {
  MARKET_TRADE_BATCH_SCHEMA_VERSION,
  ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION,
  ORDER_FLOW_MARKET_INPUT_SCHEMA_VERSION,
} from './version.ts'

export const CANONICAL_ORDER_FLOW_CONFIGURATION = {
  name: 'order-flow-summary',
  version: '0.2.0',
  configuration_hash: '91a4a14d0c702dbef9100ef4c01c9cfc96766e1c1b258822f479257f8ed61737',
} as const

export const analyzeMarketBatchRequestSchema = z.object({
  meta: wireMetaSchema,
  input: z.object({
    schema_version: z.literal(ORDER_FLOW_MARKET_INPUT_SCHEMA_VERSION),
    kind: z.literal('canonical-market-batch'),
    batch: marketTradeBatchSchema,
  }),
  session: sessionSchema,
  analysis: analysisConfigurationSchema,
  deadline_at: utcTimestampSchema,
  cancellation_id: identifierSchema,
}).passthrough()

function scaledDecimal(value: string, precision: number): bigint {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole, fraction = ''] = unsigned.split('.')
  const raw = BigInt(`${whole}${fraction.padEnd(precision, '0')}`)
  return negative ? -raw : raw
}

function decimalPrecision(value: string): number {
  return value.includes('.') ? value.length - value.indexOf('.') - 1 : 0
}

export const canonicalOrderFlowSummarySchema = z.object({
  event_count: z.number().int().positive(),
  total_volume: decimalStringSchema,
  buy_volume: decimalStringSchema,
  sell_volume: decimalStringSchema,
  unknown_volume: decimalStringSchema,
  delta: decimalStringSchema,
  point_of_control_price: decimalStringSchema,
}).passthrough().superRefine((summary, context) => {
  const volumes = [summary.total_volume, summary.buy_volume, summary.sell_volume, summary.unknown_volume]
  if (volumes.some((value) => value.startsWith('-'))) {
    context.addIssue({ code: 'custom', path: ['total_volume'], message: 'Order Flow volumes cannot be negative' })
  }
  const precision = Math.max(...[
    ...volumes.map(decimalPrecision),
    decimalPrecision(summary.delta),
  ])
  const total = scaledDecimal(summary.total_volume, precision)
  const buy = scaledDecimal(summary.buy_volume, precision)
  const sell = scaledDecimal(summary.sell_volume, precision)
  const unknown = scaledDecimal(summary.unknown_volume, precision)
  if (total !== buy + sell + unknown) {
    context.addIssue({ code: 'custom', path: ['total_volume'], message: 'Total volume must equal buy + sell + unknown volume' })
  }
  if (scaledDecimal(summary.delta, precision) !== buy - sell) {
    context.addIssue({ code: 'custom', path: ['delta'], message: 'Delta must equal buy volume - sell volume' })
  }
})

export const canonicalOrderFlowArtifactSchema = z.object({
  meta: wireMetaSchema,
  artifact_schema_version: z.literal(ORDER_FLOW_MARKET_ARTIFACT_SCHEMA_VERSION),
  artifact_id: identifierSchema,
  artifact_type: z.literal('order-flow-summary'),
  algorithm: analysisConfigurationSchema,
  input: z.object({
    schema_version: z.literal(ORDER_FLOW_MARKET_INPUT_SCHEMA_VERSION),
    kind: z.literal('canonical-market-batch'),
    batch_schema_version: z.literal(MARKET_TRADE_BATCH_SCHEMA_VERSION),
    batch_id: identifierSchema,
    batch_trace_id: identifierSchema,
    canonical_events_sha256: sha256Schema,
    source_sha256: sha256Schema,
    mode: z.literal('replay'),
    quality_state: z.enum(['valid', 'degraded', 'invalid']),
    event_count: z.number().int().positive(),
  }).passthrough(),
  instrument_id: identifierSchema,
  session_id: identifierSchema,
  event_time_range: z.object({
    start_ns: z.string().regex(/^\d+$/),
    end_ns: z.string().regex(/^\d+$/),
  }).passthrough(),
  quality: qualitySchema,
  content_hash: sha256Schema,
  summary: canonicalOrderFlowSummarySchema,
}).passthrough().superRefine((artifact, context) => {
  if (artifact.input.event_count !== artifact.summary.event_count) {
    context.addIssue({ code: 'custom', path: ['summary', 'event_count'], message: 'Artifact event count must match input' })
  }
  if (artifact.input.quality_state !== artifact.quality.state) {
    context.addIssue({ code: 'custom', path: ['quality', 'state'], message: 'Artifact quality must match input quality' })
  }
  if (BigInt(artifact.event_time_range.start_ns) > BigInt(artifact.event_time_range.end_ns)) {
    context.addIssue({ code: 'custom', path: ['event_time_range'], message: 'Artifact event-time range is reversed' })
  }
})

export type AnalyzeMarketBatchRequest = z.infer<typeof analyzeMarketBatchRequestSchema>
export type CanonicalOrderFlowArtifact = z.infer<typeof canonicalOrderFlowArtifactSchema>
export type OrderFlowArtifact = AnalysisArtifact | CanonicalOrderFlowArtifact
