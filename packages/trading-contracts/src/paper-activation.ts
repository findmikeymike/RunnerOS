import { z } from 'zod'

import { identifierSchema, sha256Schema, utcTimestampSchema } from './common.ts'
import { executionLifecycleStateSchema } from './execution.ts'

export const PAPER_ACTIVATION_REVIEW_SCHEMA_VERSION = 'paper-activation-review@1'
export const PAPER_ACTIVATION_EVENT_SCHEMA_VERSION = 'paper-activation-event@1'

export const paperActivationConnectionEvidenceSchema = z.object({
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  provider_verification_id: identifierSchema,
  provider_verification_checksum: sha256Schema,
  release_snapshot_id: identifierSchema,
  release_snapshot_checksum: sha256Schema,
  release_snapshot_captured_at: utcTimestampSchema,
  release_position_count: z.literal(0),
  release_working_order_count: z.literal(0),
  certification_id: identifierSchema,
  certification_checksum: sha256Schema,
  authorization_id: identifierSchema,
  authorization_checksum: sha256Schema,
  authorized_symbols: z.array(identifierSchema).min(1).max(100),
  max_contracts: z.number().int().positive().max(10_000),
  allowed_sides: z.array(z.enum(['buy', 'sell'])).min(1).max(2),
  allowed_order_types: z.array(z.enum(['market', 'limit', 'stop', 'stop-limit'])).min(1).max(4),
  session_start: utcTimestampSchema,
  session_end: utcTimestampSchema,
  max_daily_loss: z.string().regex(/^\d+(?:\.\d+)?$/),
  max_open_risk: z.string().regex(/^\d+(?:\.\d+)?$/),
  authorization_expires_at: utcTimestampSchema,
}).strict()

export const paperActivationPendingIntentSchema = z.object({
  intent_id: identifierSchema,
  intent_checksum: sha256Schema,
  execution_record_checksum: sha256Schema,
  connection_id: identifierSchema,
  source_id: identifierSchema,
  source_artifact_checksum: sha256Schema,
  source_ticket_checksum: sha256Schema,
  symbol: identifierSchema,
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive().max(10_000),
  state: executionLifecycleStateSchema,
  created_at: utcTimestampSchema,
  valid_until: utcTimestampSchema,
}).strict()

export const paperActivationBlockerSchema = z.object({
  code: identifierSchema,
  connection_id: identifierSchema.optional(),
  detail: z.string().trim().min(1).max(500),
}).strict()

export const paperActivationReviewSchema = z.object({
  review_schema_version: z.literal(PAPER_ACTIVATION_REVIEW_SCHEMA_VERSION),
  review_id: identifierSchema,
  adapter_set_checksum: sha256Schema,
  control_checksum: sha256Schema,
  connections: z.array(paperActivationConnectionEvidenceSchema).max(100),
  pending_intents: z.array(paperActivationPendingIntentSchema).max(10_000),
  blockers: z.array(paperActivationBlockerSchema).max(1_000),
  ready: z.boolean(),
  created_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  state_checksum: sha256Schema,
  content_checksum: sha256Schema,
}).strict().superRefine((review, context) => {
  if (review.ready !== (review.blockers.length === 0)) {
    context.addIssue({ code: 'custom', path: ['ready'], message: 'Activation readiness must match its blocker set' })
  }
  const lifetime = Date.parse(review.expires_at) - Date.parse(review.created_at)
  if (lifetime <= 0 || lifetime > 60_000) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'Activation reviews must expire within 60 seconds' })
  }
  const intentIds = review.pending_intents.map((intent) => intent.intent_id)
  if (new Set(intentIds).size !== intentIds.length) {
    context.addIssue({ code: 'custom', path: ['pending_intents'], message: 'Pending intent IDs must be unique' })
  }
})

export const paperActivationEventSchema = z.object({
  event_schema_version: z.literal(PAPER_ACTIVATION_EVENT_SCHEMA_VERSION),
  event_id: identifierSchema,
  release_id: identifierSchema,
  review_id: identifierSchema,
  review_checksum: sha256Schema,
  state_checksum: sha256Schema,
  status: z.enum(['prepared', 'dismissed', 'released', 'halted']),
  account_snapshots: z.array(z.object({
    connection_id: identifierSchema,
    snapshot_id: identifierSchema,
    snapshot_checksum: sha256Schema,
    captured_at: utcTimestampSchema,
    position_count: z.literal(0),
    working_order_count: z.literal(0),
  }).strict()).max(100),
  intent_results: z.array(z.object({
    intent_id: identifierSchema,
    decision: z.literal('cancel'),
    outcome: z.enum(['planned', 'canceled', 'failed']),
    final_state: executionLifecycleStateSchema.optional(),
    error: z.string().trim().min(1).max(500).optional(),
  }).strict()).max(10_000),
  detail: z.string().trim().min(1).max(1_000),
  occurred_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export type PaperActivationConnectionEvidence = z.infer<typeof paperActivationConnectionEvidenceSchema>
export type PaperActivationPendingIntent = z.infer<typeof paperActivationPendingIntentSchema>
export type PaperActivationBlocker = z.infer<typeof paperActivationBlockerSchema>
export type PaperActivationReview = z.infer<typeof paperActivationReviewSchema>
export type PaperActivationEvent = z.infer<typeof paperActivationEventSchema>
