import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  positiveDecimalStringSchema,
  semverSchema,
  sha256Schema,
  utcTimestampSchema,
  wireMetaSchema,
} from './common.ts'
import { ANALYSIS_ARTIFACT_SCHEMA_VERSION } from './version.ts'

export const fixtureRefSchema = z.object({
  id: identifierSchema,
  sha256: sha256Schema,
}).passthrough()

export const instrumentSchema = z.object({
  id: identifierSchema,
  symbol: identifierSchema,
  venue: identifierSchema,
  asset_class: z.enum(['future', 'equity', 'option', 'forex', 'crypto']),
  currency: z.string().length(3).regex(/^[A-Z]{3}$/),
  tick_size: positiveDecimalStringSchema,
  multiplier: positiveDecimalStringSchema,
}).passthrough()

export const sessionSchema = z.object({
  exchange_timezone: z.string().min(1).max(100),
  session_id: identifierSchema,
}).passthrough()

export const analysisConfigurationSchema = z.object({
  name: identifierSchema,
  version: semverSchema,
  configuration_hash: sha256Schema,
}).passthrough()

export const analyzeFixtureRequestSchema = z.object({
  meta: wireMetaSchema,
  fixture: fixtureRefSchema,
  instrument: instrumentSchema,
  session: sessionSchema,
  analysis: analysisConfigurationSchema,
  deadline_at: utcTimestampSchema,
  cancellation_id: identifierSchema,
}).passthrough()

export const qualitySchema = z.object({
  state: z.enum(['valid', 'degraded', 'invalid']),
  flags: z.array(identifierSchema),
  warnings: z.array(z.string().max(500)),
}).passthrough()

export const orderFlowSummarySchema = z.object({
  event_count: z.number().int().nonnegative(),
  total_volume: decimalStringSchema,
  buy_volume: decimalStringSchema,
  sell_volume: decimalStringSchema,
  delta: decimalStringSchema,
  point_of_control_price: decimalStringSchema,
}).passthrough()

export const analysisArtifactSchema = z.object({
  meta: wireMetaSchema,
  artifact_schema_version: z.literal(ANALYSIS_ARTIFACT_SCHEMA_VERSION),
  artifact_id: identifierSchema,
  artifact_type: z.literal('order-flow-summary'),
  algorithm: analysisConfigurationSchema,
  input: z.object({
    fixture_id: identifierSchema,
    fixture_sha256: sha256Schema,
  }).passthrough(),
  instrument_id: identifierSchema,
  session_id: identifierSchema,
  event_time_range: z.object({
    start: utcTimestampSchema,
    end: utcTimestampSchema,
  }).passthrough(),
  quality: qualitySchema,
  content_hash: sha256Schema,
  summary: orderFlowSummarySchema,
}).passthrough()

export type AnalyzeFixtureRequest = z.infer<typeof analyzeFixtureRequestSchema>
export type AnalysisArtifact = z.infer<typeof analysisArtifactSchema>
