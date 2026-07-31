import { z } from 'zod'

import { identifierSchema, utcTimestampSchema } from './common.ts'
import { discordManagementMessageSchema } from './discord-management.ts'

export const DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION = 'discotrader-intent-source@1'

const finiteNumberSchema = z.number().finite()
const positiveNumberSchema = finiteNumberSchema.positive()

export const discoTraderParsedActionSchema = z.object({
  intent: z.enum([
    'entry',
    'add',
    'partial_exit',
    'full_exit',
    'stop_move',
    'target_move',
    'cancel',
    'watch',
    'chatter',
    'ambiguous',
  ]),
  symbol: identifierSchema.optional(),
  rawSymbol: z.string().trim().min(1).max(80).optional(),
  side: z.enum(['long', 'short']).optional(),
  entry: positiveNumberSchema.optional(),
  stop: positiveNumberSchema.optional(),
  stopPoints: positiveNumberSchema.optional(),
  targets: z.array(positiveNumberSchema).max(20).optional(),
  fraction: positiveNumberSchema.max(1).optional(),
  quantity: z.number().int().positive().max(10_000).optional(),
  stopTo: z.union([
    positiveNumberSchema,
    z.enum(['breakeven', 'trail', 'tighten']),
  ]).optional(),
  targetTo: positiveNumberSchema.optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  confidence: finiteNumberSchema.min(0).max(1),
  evidence: z.array(z.string().trim().min(1).max(500)).max(100),
}).strict()

export const discoTraderTicketSchema = z.object({
  id: identifierSchema,
  createdAt: utcTimestampSchema,
  mode: z.enum(['observe-only', 'alert-only', 'stage-only', 'armed-live']),
  action: discoTraderParsedActionSchema,
  symbol: identifierSchema,
  tradedSymbol: identifierSchema,
  side: z.enum(['long', 'short']),
  contracts: z.number().int().positive().max(1_000),
  entry: positiveNumberSchema.optional(),
  stop: positiveNumberSchema.optional(),
  stopDistancePoints: positiveNumberSchema,
  targets: z.array(positiveNumberSchema).max(20),
  targetRR: positiveNumberSchema.optional(),
  riskUsd: positiveNumberSchema,
  provenance: z.object({
    messageId: identifierSchema,
    author: z.string().trim().min(1).max(160),
    authorId: identifierSchema.optional(),
    channelUrl: z.string().url().max(2_048),
    rawText: z.string().min(1).max(20_000),
    postedAt: utcTimestampSchema.optional(),
    observedAt: utcTimestampSchema,
    latencyMs: finiteNumberSchema.nonnegative(),
  }).strict(),
  gateTrail: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
  llmVeto: z.object({
    decision: z.enum(['accept', 'reject']),
    reason: z.string().trim().min(1).max(1_000),
    model: z.string().trim().min(1).max(160),
    ms: finiteNumberSchema.nonnegative(),
  }).strict().optional(),
}).strict()

export const discoTraderPushPayloadSchema = z.object({
  kind: z.enum([
    'ticket',
    'management',
    'filled',
    'reconcile_halt',
    'unprotected_position',
    'session_flatten',
    'daily_limit',
  ]),
  severity: z.enum(['info', 'action_required', 'urgent']),
  summary: z.string().trim().min(1).max(2_000),
  ticket: discoTraderTicketSchema.optional(),
  management: discordManagementMessageSchema.optional(),
  detail: z.unknown().optional(),
  at: utcTimestampSchema,
}).strict().superRefine((payload, context) => {
  if (payload.kind === 'ticket' && !payload.ticket) {
    context.addIssue({
      code: 'custom',
      path: ['ticket'],
      message: 'Ticket pushes require a full immutable DiscoTrader ticket',
    })
  }
  if (payload.kind === 'management' && !payload.management) {
    context.addIssue({
      code: 'custom',
      path: ['management'],
      message: 'Management pushes require an immutable Discord management message',
    })
  }
})

export type DiscoTraderParsedAction = z.infer<typeof discoTraderParsedActionSchema>
export type DiscoTraderTicket = z.infer<typeof discoTraderTicketSchema>
export type DiscoTraderPushPayload = z.infer<typeof discoTraderPushPayloadSchema>
