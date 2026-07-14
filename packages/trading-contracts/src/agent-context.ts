import { z } from 'zod'

import { identifierSchema, sha256Schema, utcTimestampSchema } from './common.ts'
import {
  AGENT_CONTEXT_DELIVERY_RECEIPT_SCHEMA_VERSION,
  AGENT_CONTEXT_REFERENCE_SCHEMA_VERSION,
  AGENT_MARKET_SNAPSHOT_SCHEMA_VERSION,
} from './version.ts'

export const agentContextReferenceSchema = z.object({
  reference_schema_version: z.literal(AGENT_CONTEXT_REFERENCE_SCHEMA_VERSION),
  context_id: identifierSchema,
  context_schema_version: z.literal(AGENT_MARKET_SNAPSHOT_SCHEMA_VERSION),
  content_sha256: sha256Schema,
  snapshot_id: identifierSchema,
  trace_id: identifierSchema,
  instrument_id: identifierSchema,
  created_at: utcTimestampSchema,
  authority: z.object({
    purpose: z.literal('analysis'),
    execution_allowed: z.literal(false),
    order_submission_allowed: z.literal(false),
  }).strict(),
}).strict()

export const agentContextDeliveryReceiptSchema = z.object({
  delivery_receipt_schema_version: z.literal(AGENT_CONTEXT_DELIVERY_RECEIPT_SCHEMA_VERSION),
  delivery_id: identifierSchema,
  trace_id: identifierSchema,
  consumer: z.object({
    agent_id: identifierSchema,
    capability: identifierSchema,
  }).strict(),
  delivery_mode: z.literal('reference'),
  context: agentContextReferenceSchema,
  status: z.enum(['queued', 'resolved']),
  queued_at: utcTimestampSchema,
  resolved_at: utcTimestampSchema.optional(),
}).strict().superRefine((receipt, context) => {
  if (receipt.trace_id !== receipt.context.trace_id) {
    context.addIssue({ code: 'custom', path: ['trace_id'], message: 'Delivery and context trace identities must match' })
  }
  if (receipt.status === 'queued' && receipt.resolved_at) {
    context.addIssue({ code: 'custom', path: ['resolved_at'], message: 'Queued delivery cannot be resolved' })
  }
  if (receipt.status === 'resolved' && !receipt.resolved_at) {
    context.addIssue({ code: 'custom', path: ['resolved_at'], message: 'Resolved delivery requires a timestamp' })
  }
  if (receipt.resolved_at && Date.parse(receipt.resolved_at) < Date.parse(receipt.queued_at)) {
    context.addIssue({ code: 'custom', path: ['resolved_at'], message: 'Resolution cannot precede queueing' })
  }
})

export type AgentContextReference = z.infer<typeof agentContextReferenceSchema>
export type AgentContextDeliveryReceipt = z.infer<typeof agentContextDeliveryReceiptSchema>
