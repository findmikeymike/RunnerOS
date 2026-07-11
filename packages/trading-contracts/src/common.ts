import { z } from 'zod'

export const semverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected a semantic version')
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest')
export const utcTimestampSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
  'Expected an ISO-8601 UTC timestamp',
)
export const identifierSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/)
export const decimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/, 'Expected a canonical decimal string')
export const positiveDecimalStringSchema = decimalStringSchema.refine((value) => !value.startsWith('-') && value !== '0', {
  message: 'Expected a positive decimal string',
})

export const producerSchema = z.object({
  name: identifierSchema,
  version: semverSchema,
  instance_id: identifierSchema,
}).passthrough()

export const wireMetaSchema = z.object({
  schema_version: semverSchema,
  trace_id: identifierSchema,
  created_at: utcTimestampSchema,
  producer: producerSchema,
}).passthrough()

export type WireMeta = z.infer<typeof wireMetaSchema>
