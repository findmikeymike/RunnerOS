import { z } from 'zod'

import {
  analysisConfigurationSchema,
  qualitySchema,
  sessionSchema,
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

export const canonicalOrderFlowSummarySchema = z.object({
  event_count: z.number().int().positive(),
  total_volume: decimalStringSchema,
  buy_volume: decimalStringSchema,
  sell_volume: decimalStringSchema,
  unknown_volume: decimalStringSchema,
  delta: decimalStringSchema,
  point_of_control_price: decimalStringSchema,
}).passthrough()

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
    mode: z.enum(['replay', 'live']),
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
}).passthrough()

export type AnalyzeMarketBatchRequest = z.infer<typeof analyzeMarketBatchRequestSchema>
export type CanonicalOrderFlowArtifact = z.infer<typeof canonicalOrderFlowArtifactSchema>
