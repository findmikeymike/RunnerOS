import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'
import { executionEnvironmentSchema } from './execution.ts'

export const MIRROR_GROUP_SCHEMA_VERSION = 'mirror-group@1'
export const MIRROR_EXECUTION_PREVIEW_SCHEMA_VERSION = 'mirror-execution-preview@1'
export const SOURCE_EXECUTION_BINDING_SCHEMA_VERSION = 'source-execution-binding@2'

export const sourceExecutionInstrumentSchema = z.object({
  canonical_id: identifierSchema,
  symbol: identifierSchema,
  exchange: identifierSchema,
  expiry: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  tick_size: decimalStringSchema.refine((value) => Number(value) > 0, 'Tick size must be positive'),
  point_value_usd: decimalStringSchema.refine(
    (value) => Number(value) > 0,
    'Point value must be positive',
  ),
}).strict()

export const sourceExecutionBindingSchema = z.object({
  source_execution_binding_schema_version: z.literal(SOURCE_EXECUTION_BINDING_SCHEMA_VERSION),
  binding_id: identifierSchema,
  source_type: z.literal('discord'),
  server_id: identifierSchema,
  channel_id: identifierSchema,
  author_id: identifierSchema,
  message_id: identifierSchema,
  ticket_id: identifierSchema,
  ticket_checksum: sha256Schema,
  route_id: identifierSchema,
  instrument: sourceExecutionInstrumentSchema,
  received_at: utcTimestampSchema,
  target: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('connection'),
      connection_id: identifierSchema,
      intent_id: identifierSchema,
    }).strict(),
    z.object({
      type: z.literal('mirror-group'),
      mirror_group_id: identifierSchema,
      mirror_group_revision: z.number().int().positive(),
      group_snapshot_checksum: sha256Schema,
      mirror_execution_id: identifierSchema,
    }).strict(),
  ]),
  state: z.enum(['bound', 'materialized', 'halted']),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export const mirrorQuantityRuleSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('source-quantity'),
    max_contracts: z.number().int().positive().max(1_000),
  }).strict(),
  z.object({
    mode: z.literal('fixed-contracts'),
    contracts: z.number().int().positive().max(1_000),
    max_contracts: z.number().int().positive().max(1_000),
  }).strict().superRefine((rule, context) => {
    if (rule.contracts > rule.max_contracts) {
      context.addIssue({
        code: 'custom',
        path: ['contracts'],
        message: 'Fixed contracts cannot exceed the member maximum',
      })
    }
  }),
])

export const mirrorGroupMemberSchema = z.object({
  member_id: identifierSchema,
  connection_id: identifierSchema,
  enabled: z.boolean(),
  quantity_rule: mirrorQuantityRuleSchema,
}).strict()

export const mirrorGroupSchema = z.object({
  mirror_group_schema_version: z.literal(MIRROR_GROUP_SCHEMA_VERSION),
  mirror_group_id: identifierSchema,
  revision: z.number().int().positive(),
  display_name: z.string().trim().min(1).max(120),
  environment: executionEnvironmentSchema,
  state: z.enum(['draft', 'active', 'paused', 'archived']),
  admission_policy: z.literal('all-members-before-order-mutation-io'),
  dispatch_policy: z.object({
    mode: z.literal('bounded-parallel'),
    max_concurrency: z.number().int().min(1).max(4),
  }).strict(),
  portfolio_limits: z.object({
    currency: z.literal('USD'),
    max_aggregate_initial_risk: decimalStringSchema.refine(
      (value) => Number(value) > 0,
      'Aggregate risk must be positive',
    ),
    max_active_parent_trades: z.number().int().positive().max(100),
  }).strict(),
  members: z.array(mirrorGroupMemberSchema).min(2).max(20),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((group, context) => {
  if (Date.parse(group.updated_at) < Date.parse(group.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Update cannot precede creation' })
  }
  const connectionIds = group.members.map((member) => member.connection_id)
  if (new Set(connectionIds).size !== connectionIds.length) {
    context.addIssue({ code: 'custom', path: ['members'], message: 'A connection may appear only once' })
  }
  const memberIds = group.members.map((member) => member.member_id)
  if (new Set(memberIds).size !== memberIds.length) {
    context.addIssue({ code: 'custom', path: ['members'], message: 'A member ID may appear only once' })
  }
  if (group.state === 'active' && group.members.filter((member) => member.enabled).length < 2) {
    context.addIssue({
      code: 'custom',
      path: ['members'],
      message: 'An active Mirror Group requires at least two enabled members',
    })
  }
})

export const mirrorPreviewChildSchema = z.object({
  member_id: identifierSchema,
  connection_id: identifierSchema,
  child_intent_id: identifierSchema,
  provider_account_key: z.string().trim().min(1).max(512),
  planned_quantity: z.number().int().positive().max(1_000),
  quantity_rule_snapshot: mirrorQuantityRuleSchema,
  readiness: z.enum(['ready', 'blocked']),
  blocking_reasons: z.array(identifierSchema).max(20),
  estimated_price_distance_risk_usd: decimalStringSchema.optional(),
}).strict()

export const mirrorExecutionPreviewSchema = z.object({
  mirror_execution_preview_schema_version: z.literal(MIRROR_EXECUTION_PREVIEW_SCHEMA_VERSION),
  mirror_execution_id: identifierSchema,
  route_id: identifierSchema,
  mirror_group_id: identifierSchema,
  mirror_group_revision: z.number().int().positive(),
  group_snapshot_checksum: sha256Schema,
  source: z.object({
    ticket_id: identifierSchema,
    message_id: identifierSchema,
    author_id: identifierSchema,
    ticket_checksum: sha256Schema,
    instrument_canonical_id: identifierSchema,
  }).strict(),
  state: z.enum(['ready', 'blocked']),
  children: z.array(mirrorPreviewChildSchema).min(2).max(20),
  aggregate_estimated_price_distance_risk_usd: decimalStringSchema.optional(),
  blocking_reasons: z.array(identifierSchema).max(100),
  execution_blockers: z.array(identifierSchema).min(1).max(20),
  order_mutation_allowed: z.literal(false),
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export type MirrorQuantityRule = z.infer<typeof mirrorQuantityRuleSchema>
export type MirrorGroupMember = z.infer<typeof mirrorGroupMemberSchema>
export type MirrorGroup = z.infer<typeof mirrorGroupSchema>
export type MirrorExecutionPreview = z.infer<typeof mirrorExecutionPreviewSchema>
export type SourceExecutionBinding = z.infer<typeof sourceExecutionBindingSchema>
export type SourceExecutionInstrument = z.infer<typeof sourceExecutionInstrumentSchema>
