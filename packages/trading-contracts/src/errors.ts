import { z } from 'zod'

import { identifierSchema, wireMetaSchema } from './common.ts'

export const tradingErrorCategorySchema = z.enum([
  'validation',
  'incompatible',
  'timeout',
  'canceled',
  'unavailable',
  'internal',
])

export const tradingErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'UNSUPPORTED_PROTOCOL_VERSION',
  'UNSUPPORTED_ARTIFACT_VERSION',
  'CAPABILITY_UNAVAILABLE',
  'FIXTURE_NOT_FOUND',
  'FIXTURE_CHECKSUM_MISMATCH',
  'DEADLINE_EXCEEDED',
  'CANCELED',
  'SIDECAR_UNAVAILABLE',
  'SIDECAR_EXITED',
  'INTERNAL_ERROR',
])

export const tradingErrorSchema = z.object({
  meta: wireMetaSchema,
  code: tradingErrorCodeSchema,
  category: tradingErrorCategorySchema,
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
  diagnostic_id: identifierSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional(),
}).passthrough()

export type TradingError = z.infer<typeof tradingErrorSchema>
