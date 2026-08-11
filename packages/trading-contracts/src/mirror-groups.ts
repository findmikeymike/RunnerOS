import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'
import {
  exitLegSchema,
  executionEnvironmentSchema,
  orderSideSchema,
  orderTypeSchema,
  protectionLegSchema,
} from './execution.ts'

export const MIRROR_GROUP_SCHEMA_VERSION = 'mirror-group@1'
export const MIRROR_EXECUTION_PREVIEW_SCHEMA_VERSION = 'mirror-execution-preview@1'
export const SOURCE_EXECUTION_BINDING_SCHEMA_VERSION = 'source-execution-binding@2'
export const LEGACY_MIRROR_CHILD_SOURCE_SCHEMA_VERSION = 'mirror-child-source@1'
export const MIRROR_CHILD_SOURCE_SCHEMA_VERSION = 'mirror-child-source@2'
export const MIRROR_CHILD_RISK_PROJECTION_SCHEMA_VERSION = 'mirror-child-risk-projection@1'
export const MIRROR_DISPATCH_GRANT_SCHEMA_VERSION = 'mirror-dispatch-grant@1'
export const MIRROR_RISK_RESERVATION_SCHEMA_VERSION = 'mirror-risk-reservation@1'
export const MIRROR_EXECUTION_SCHEMA_VERSION = 'mirror-execution@1'

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

export const mirrorChildSourceSchema = z.object({
  mirror_child_source_schema_version: z.union([
    z.literal(LEGACY_MIRROR_CHILD_SOURCE_SCHEMA_VERSION),
    z.literal(MIRROR_CHILD_SOURCE_SCHEMA_VERSION),
  ]),
  mirror_child_source_id: identifierSchema,
  mirror_execution_id: identifierSchema,
  mirror_group_id: identifierSchema,
  mirror_group_revision: z.number().int().positive(),
  group_snapshot_checksum: sha256Schema,
  source_binding_id: identifierSchema,
  source_binding_checksum: sha256Schema,
  route_id: identifierSchema,
  member_id: identifierSchema,
  connection_id: identifierSchema,
  ticket_id: identifierSchema,
  ticket_checksum: sha256Schema,
  instrument: sourceExecutionInstrumentSchema,
  side: orderSideSchema,
  entry_order_type: orderTypeSchema,
  entry_price: decimalStringSchema.optional(),
  stop_loss: protectionLegSchema,
  target_prices: z.array(decimalStringSchema).max(20),
  exit_legs: z.array(exitLegSchema).min(1).max(20).optional(),
  source_quantity: z.number().int().positive().max(1_000),
  planned_quantity: z.number().int().positive().max(1_000),
  quantity_rule_snapshot: mirrorQuantityRuleSchema,
  derived_initial_risk_upper_bound_usd: decimalStringSchema.refine(
    (value) => Number(value) > 0,
    'Derived risk must be positive',
  ),
  derivation_version: z.union([z.literal('1.0.0'), z.literal('2.0.0')]),
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((source, context) => {
  const legacy = source.mirror_child_source_schema_version
    === LEGACY_MIRROR_CHILD_SOURCE_SCHEMA_VERSION
  if (legacy && (source.derivation_version !== '1.0.0' || source.exit_legs)) {
    context.addIssue({
      code: 'custom',
      path: ['mirror_child_source_schema_version'],
      message: 'Legacy Mirror child sources cannot contain version 2 exit-leg derivation',
    })
  }
  if (!legacy && source.derivation_version !== '2.0.0') {
    context.addIssue({
      code: 'custom',
      path: ['derivation_version'],
      message: 'Version 2 Mirror child sources require derivation version 2.0.0',
    })
  }
  if (source.target_prices.length > 1 && !source.exit_legs) {
    context.addIssue({
      code: 'custom',
      path: ['exit_legs'],
      message: 'Multiple Mirror targets require exact immutable exit-leg allocations',
    })
  }
  if (source.exit_legs) {
    const exitQuantity = source.exit_legs.reduce((total, leg) => total + leg.quantity, 0)
    if (exitQuantity !== source.planned_quantity) {
      context.addIssue({
        code: 'custom',
        path: ['exit_legs'],
        message: 'Mirror exit-leg quantities must exactly cover planned quantity',
      })
    }
    const legTargets = source.exit_legs.flatMap((leg) => (
      leg.take_profit?.type === 'price' ? [leg.take_profit.value] : []
    )).sort()
    const evidenceTargets = [...source.target_prices].sort()
    if (
      legTargets.length !== evidenceTargets.length
      || legTargets.some((target, index) => target !== evidenceTargets[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['exit_legs'],
        message: 'Mirror exit-leg prices must exactly match frozen target evidence',
      })
    }
  }
})

export const mirrorChildRiskProjectionSchema = z.object({
  mirror_child_risk_projection_schema_version: z.literal(
    MIRROR_CHILD_RISK_PROJECTION_SCHEMA_VERSION,
  ),
  projection_id: identifierSchema,
  mirror_execution_id: identifierSchema,
  intent_id: identifierSchema,
  connection_id: identifierSchema,
  provider_account_key: z.string().trim().min(1).max(512),
  account_snapshot_id: identifierSchema,
  risk_decision_id: identifierSchema,
  mirror_child_source_checksum: sha256Schema,
  instrument_canonical_id: identifierSchema,
  planned_quantity: z.number().int().positive().max(1_000),
  valuation: z.object({
    currency: z.literal('USD'),
    side: orderSideSchema,
    entry_order_type: orderTypeSchema,
    adverse_entry_bound: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('maximum-price'), price: decimalStringSchema }).strict(),
      z.object({ kind: z.literal('minimum-price'), price: decimalStringSchema }).strict(),
    ]),
    protection: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('absolute-price'), stop_price: decimalStringSchema }).strict(),
      z.object({
        kind: z.literal('tick-distance'),
        ticks: z.number().int().positive(),
        tick_size: decimalStringSchema,
      }).strict(),
    ]),
    tick_value_usd: decimalStringSchema,
    instrument_value_version: z.string().trim().min(1).max(120),
    slippage_policy_version: z.string().trim().min(1).max(120),
    risk_policy_version: z.string().trim().min(1).max(120),
    fees_policy_version: z.string().trim().min(1).max(120),
    risk_model_authority: z.literal('planning-stop-distance-with-fees'),
  }).strict(),
  initial_risk_upper_bound_usd: decimalStringSchema.refine(
    (value) => Number(value) > 0,
    'Projected risk must be positive',
  ),
  evaluated_at: utcTimestampSchema,
  valid_until: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((projection, context) => {
  if (Date.parse(projection.valid_until) <= Date.parse(projection.evaluated_at)) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Projection must expire after evaluation' })
  }
  const expectedBound = projection.valuation.side === 'buy' ? 'maximum-price' : 'minimum-price'
  if (projection.valuation.adverse_entry_bound.kind !== expectedBound) {
    context.addIssue({
      code: 'custom', path: ['valuation', 'adverse_entry_bound'],
      message: 'Adverse entry bound must match the child side',
    })
  }
})

export const mirrorDispatchGrantSchema = z.object({
  mirror_dispatch_grant_schema_version: z.literal(MIRROR_DISPATCH_GRANT_SCHEMA_VERSION),
  grant_id: identifierSchema,
  mirror_execution_id: identifierSchema,
  intent_id: identifierSchema,
  connection_id: identifierSchema,
  admitted_parent_checksum: sha256Schema,
  complete_child_set_checksum: sha256Schema,
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  projection_set_checksum: sha256Schema,
  dispatch_authority: z.literal('fake-provider-test-only'),
  issued_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((grant, context) => {
  if (Date.parse(grant.expires_at) <= Date.parse(grant.issued_at)) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'Dispatch grant must expire after issue' })
  }
})

export const mirrorRiskReservationSchema = z.object({
  mirror_risk_reservation_schema_version: z.literal(MIRROR_RISK_RESERVATION_SCHEMA_VERSION),
  reservation_id: identifierSchema,
  mirror_execution_id: identifierSchema,
  mirror_group_id: identifierSchema,
  mirror_group_revision: z.number().int().positive(),
  group_snapshot_checksum: sha256Schema,
  projections: z.array(z.object({
    projection_id: identifierSchema,
    connection_id: identifierSchema,
    initial_risk_upper_bound_usd: decimalStringSchema,
    projection_checksum: sha256Schema,
  }).strict()).min(2).max(20),
  aggregate_initial_risk_upper_bound_usd: decimalStringSchema,
  active_parent_slot: z.literal(1),
  state: z.enum(['reserved', 'releasing', 'released', 'halted']),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export const mirrorExecutionSchema = z.object({
  mirror_execution_schema_version: z.literal(MIRROR_EXECUTION_SCHEMA_VERSION),
  mirror_execution_id: identifierSchema,
  trace_id: identifierSchema,
  route_id: identifierSchema,
  mirror_group_id: identifierSchema,
  mirror_group_revision: z.number().int().positive(),
  group_snapshot_checksum: sha256Schema,
  source: z.object({
    ticket_id: identifierSchema,
    message_id: identifierSchema,
    author_id: identifierSchema,
    server_id: identifierSchema,
    channel_id: identifierSchema,
    ticket_checksum: sha256Schema,
    instrument_canonical_id: identifierSchema,
  }).strict(),
  state: z.enum([
    'planning', 'blocked', 'admitted', 'dispatching', 'active',
    'partial', 'closing', 'closed', 'halted',
  ]),
  children: z.array(z.object({
    member_id: identifierSchema,
    connection_id: identifierSchema,
    intent_id: identifierSchema,
    planned_quantity: z.number().int().positive().max(1_000),
    quantity_rule_snapshot: mirrorQuantityRuleSchema,
    state: z.enum([
      'planned', 'admitted', 'blocked', 'dispatching', 'protected',
      'terminal', 'unknown', 'divergent',
    ]),
    execution_record_checksum: sha256Schema.optional(),
    error_code: identifierSchema.optional(),
  }).strict()).min(2).max(20),
  reservation_id: identifierSchema.optional(),
  order_mutation_io_started_at: utcTimestampSchema.optional(),
  transitions: z.array(z.object({
    from: z.string().trim().min(1).max(40).optional(),
    to: z.string().trim().min(1).max(40),
    reason: z.string().trim().min(1).max(500),
    at: utcTimestampSchema,
  }).strict()).min(1).max(1_000),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export type MirrorQuantityRule = z.infer<typeof mirrorQuantityRuleSchema>
export type MirrorGroupMember = z.infer<typeof mirrorGroupMemberSchema>
export type MirrorGroup = z.infer<typeof mirrorGroupSchema>
export type MirrorExecutionPreview = z.infer<typeof mirrorExecutionPreviewSchema>
export type SourceExecutionBinding = z.infer<typeof sourceExecutionBindingSchema>
export type SourceExecutionInstrument = z.infer<typeof sourceExecutionInstrumentSchema>
export type MirrorChildSource = z.infer<typeof mirrorChildSourceSchema>
export type MirrorChildRiskProjection = z.infer<typeof mirrorChildRiskProjectionSchema>
export type MirrorDispatchGrant = z.infer<typeof mirrorDispatchGrantSchema>
export type MirrorRiskReservation = z.infer<typeof mirrorRiskReservationSchema>
export type MirrorExecution = z.infer<typeof mirrorExecutionSchema>
