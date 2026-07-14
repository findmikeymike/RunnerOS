import { z } from 'zod'

import { identifierSchema, semverSchema, wireMetaSchema } from './common.ts'

export const serviceLifecycleStateSchema = z.enum([
  'starting',
  'ready',
  'degraded',
  'incompatible',
  'stopping',
  'stopped',
])

export const serviceCommandSchema = z.enum([
  'health',
  'capabilities',
  'analyze_fixture',
  'analyze_market_batch',
  'cancel',
  'shutdown',
])

export const dependencyHealthSchema = z.object({
  name: identifierSchema,
  state: z.enum(['ready', 'degraded', 'unavailable']),
  message: z.string().max(500).optional(),
}).passthrough()

export const serviceCapabilitiesSchema = z.object({
  commands: z.array(serviceCommandSchema).min(1),
  fixture_mode: z.boolean(),
}).passthrough()

export const healthResponseSchema = z.object({
  meta: wireMetaSchema,
  state: serviceLifecycleStateSchema,
  protocol_version: semverSchema,
  artifact_versions: z.array(z.string().min(1)).min(1),
  capabilities: serviceCapabilitiesSchema,
  dependencies: z.array(dependencyHealthSchema),
  last_error: z.string().max(500).optional(),
}).passthrough()

export type HealthResponse = z.infer<typeof healthResponseSchema>
