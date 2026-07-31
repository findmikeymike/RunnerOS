import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  utcTimestampSchema,
} from './common.ts'
import { CHART_ANNOTATION_SCHEMA_VERSION } from './version.ts'

export const chartAnnotationSourceKindSchema = z.enum(['user', 'agent', 'system'])
export const chartAnnotationStateSchema = z.enum(['active', 'invalidated', 'expired', 'hidden'])
export const chartAnnotationTimeframeSchema = z.string()
  .min(1)
  .max(16)
  .regex(/^\d+(?:s|m|h|d|w|M)$/, 'Expected a canonical chart timeframe')

const chartPointSchema = z.object({
  time: utcTimestampSchema,
  price: decimalStringSchema,
}).strict()

const chartAnnotationStyleSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  line_width: z.number().int().min(1).max(4).optional(),
  line_style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  opacity: z.number().min(0.1).max(1).optional(),
}).strict()

const horizontalLineSchema = z.object({
  kind: z.literal('horizontal-line'),
  price: decimalStringSchema,
  label: z.string().min(1).max(120).optional(),
}).strict()

const trendLineSchema = z.object({
  kind: z.literal('trend-line'),
  from: chartPointSchema,
  to: chartPointSchema,
  label: z.string().min(1).max(120).optional(),
}).strict()

const priceZoneSchema = z.object({
  kind: z.literal('price-zone'),
  low: decimalStringSchema,
  high: decimalStringSchema,
  start_time: utcTimestampSchema.optional(),
  end_time: utcTimestampSchema.optional(),
  label: z.string().min(1).max(120).optional(),
}).strict()

const markerSchema = z.object({
  kind: z.literal('marker'),
  time: utcTimestampSchema,
  price: decimalStringSchema.optional(),
  shape: z.enum(['circle', 'square', 'arrow-up', 'arrow-down']),
  text: z.string().min(1).max(160),
}).strict()

export const chartAnnotationPayloadSchema = z.discriminatedUnion('kind', [
  horizontalLineSchema,
  trendLineSchema,
  priceZoneSchema,
  markerSchema,
])

export const chartAnnotationSchema = z.object({
  annotation_schema_version: z.literal(CHART_ANNOTATION_SCHEMA_VERSION),
  annotation_id: identifierSchema,
  scene_id: identifierSchema,
  instrument_id: identifierSchema,
  timeframe: chartAnnotationTimeframeSchema,
  session_id: identifierSchema.optional(),
  source_kind: chartAnnotationSourceKindSchema,
  source_id: identifierSchema,
  created_at: utcTimestampSchema,
  as_of: utcTimestampSchema,
  state: chartAnnotationStateSchema,
  payload: chartAnnotationPayloadSchema,
  style: chartAnnotationStyleSchema.optional(),
  evidence_refs: z.array(identifierSchema).max(32),
  thesis_ref: identifierSchema.optional(),
  expires_at: utcTimestampSchema.optional(),
  invalidated_at: utcTimestampSchema.optional(),
  authority: z.literal('analysis-only'),
}).strict().superRefine((annotation, context) => {
  if (Date.parse(annotation.as_of) > Date.parse(annotation.created_at)) {
    context.addIssue({ code: 'custom', path: ['as_of'], message: 'Annotation evidence cannot be newer than creation time' })
  }
  if (annotation.expires_at && Date.parse(annotation.expires_at) <= Date.parse(annotation.created_at)) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'Annotation expiry must follow creation time' })
  }
  if (annotation.state === 'invalidated' && !annotation.invalidated_at) {
    context.addIssue({ code: 'custom', path: ['invalidated_at'], message: 'Invalidated annotations require a timestamp' })
  }
  if (annotation.state !== 'invalidated' && annotation.invalidated_at) {
    context.addIssue({ code: 'custom', path: ['invalidated_at'], message: 'Only invalidated annotations may carry an invalidation timestamp' })
  }
})

export const chartAnnotationCollectionSchema = z.array(chartAnnotationSchema).max(500)

export type ChartAnnotation = z.infer<typeof chartAnnotationSchema>
export type ChartAnnotationPayload = z.infer<typeof chartAnnotationPayloadSchema>
