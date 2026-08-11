import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  semverSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'

export const TRADING_CONNECTION_SCHEMA_VERSION = 'trading-connection@1'
export const ORDER_INTENT_SCHEMA_VERSION = 'order-intent@1'
export const RISK_DECISION_SCHEMA_VERSION = 'risk-decision@1'
export const EXECUTION_AUTHORIZATION_SCHEMA_VERSION = 'execution-authorization@1'
export const EXTERNAL_AUTHORIZATION_BASIS_SCHEMA_VERSION = 'external-authorization-basis@1'
export const EXECUTION_COMMAND_SCHEMA_VERSION = 'execution-command@1'
export const EXECUTION_MANAGEMENT_COMMAND_SCHEMA_VERSION = 'execution-management-command@1'
export const EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION = 'execution-management-ack@1'
export const EXECUTION_RECORD_SCHEMA_VERSION = 'execution-record@1'
export const EXECUTION_RECEIPT_SCHEMA_VERSION = 'execution-receipt@1'
export const EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION = 'execution-account-snapshot@1'
export const EXECUTION_SUBMIT_ACK_SCHEMA_VERSION = 'execution-submit-ack@1'
export const EXECUTION_RECONCILIATION_SCHEMA_VERSION = 'execution-reconciliation@1'
export const EXECUTION_PROTECTION_ORDER_SCHEMA_VERSION = 'execution-protection-order@1'

export const executionEnvironmentSchema = z.enum([
  'paper',
  'evaluation',
  'performance',
  'live',
])

export const executionEnvironmentClassSchema = z.enum(['rehearsal', 'consequential'])

export const executionTransportSchema = z.enum(['api', 'browser'])
export const executionTransportPreferenceSchema = z.enum(['auto', 'api', 'browser'])

export const executionConnectionStateSchema = z.enum([
  'unconfigured',
  'auth-required',
  'connecting',
  'ready',
  'degraded',
  'suspended',
  'revoked',
])

export const executionCertificationSchema = z.enum([
  'read-certified',
  'paper-entry-certified',
  'paper-lifecycle-certified',
  'consequential-entry-certified',
  'consequential-lifecycle-certified',
])

export const executionCapabilitiesSchema = z.object({
  read_accounts: z.boolean(),
  read_orders: z.boolean(),
  read_positions: z.boolean(),
  read_executions: z.boolean(),
  submit_market: z.boolean(),
  submit_limit: z.boolean(),
  submit_stop: z.boolean(),
  submit_stop_limit: z.boolean(),
  native_bracket: z.boolean(),
  native_oco: z.boolean(),
  modify_order: z.boolean(),
  cancel_order: z.boolean(),
  partial_close: z.boolean(),
  flatten: z.boolean(),
  streaming_events: z.boolean(),
}).strict()

export const tradingConnectionSchema = z.object({
  connection_schema_version: z.literal(TRADING_CONNECTION_SCHEMA_VERSION),
  connection_id: identifierSchema,
  display_name: z.string().trim().min(1).max(120),
  firm: z.object({
    slug: identifierSchema,
    name: z.string().trim().min(1).max(120),
  }).strict(),
  platform: z.object({
    slug: identifierSchema,
    name: z.string().trim().min(1).max(120),
  }).strict(),
  environment: executionEnvironmentSchema,
  environment_class: executionEnvironmentClassSchema,
  transport_preference: executionTransportPreferenceSchema,
  account_ref: identifierSchema,
  account_display: z.object({
    label: z.string().trim().min(1).max(120),
    last4: z.string().regex(/^[A-Za-z0-9]{4}$/).optional(),
  }).strict(),
  credential_ref: identifierSchema.optional(),
  browser_session_ref: identifierSchema.optional(),
  browser_login_confirmed_at: utcTimestampSchema.optional(),
  browser_login_origin: z.string().url().max(2_048).optional(),
  risk_policy_ref: identifierSchema,
  authorization_basis_ref: identifierSchema,
  approval_policy_ref: identifierSchema,
  state: executionConnectionStateSchema,
  capabilities: executionCapabilitiesSchema,
  certifications: z.array(executionCertificationSchema).max(5),
  adapter_certifications: z.array(z.object({
    certification_id: identifierSchema,
    adapter_id: identifierSchema,
    adapter_version: semverSchema,
    provider_contract_version: z.string().trim().min(1).max(120),
    transport: executionTransportSchema,
    levels: z.array(executionCertificationSchema).min(1).max(5),
  }).strict()).max(20).optional(),
  consequential_enabled_until: utcTimestampSchema.optional(),
  enabled: z.boolean(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
}).strict().superRefine((connection, context) => {
  const expectedClass = connection.environment === 'paper' ? 'rehearsal' : 'consequential'
  if (connection.environment_class !== expectedClass) {
    context.addIssue({
      code: 'custom',
      path: ['environment_class'],
      message: `${connection.environment} must use the ${expectedClass} environment class`,
    })
  }
  if (connection.transport_preference === 'api' && !connection.credential_ref) {
    context.addIssue({
      code: 'custom',
      path: ['credential_ref'],
      message: 'API connections require an opaque credential reference',
    })
  }
  if (connection.transport_preference === 'browser' && !connection.browser_session_ref) {
    context.addIssue({
      code: 'custom',
      path: ['browser_session_ref'],
      message: 'Browser connections require an opaque browser-session reference',
    })
  }
  if (Date.parse(connection.updated_at) < Date.parse(connection.created_at)) {
    context.addIssue({
      code: 'custom',
      path: ['updated_at'],
      message: 'Connection update cannot precede creation',
    })
  }
})

export const orderSideSchema = z.enum(['buy', 'sell'])
export const orderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop-limit'])
export const timeInForceSchema = z.enum(['day', 'gtc'])

export const orderEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('market') }).strict(),
  z.object({
    type: z.literal('limit'),
    price: decimalStringSchema,
  }).strict(),
  z.object({
    type: z.literal('stop'),
    stop_price: decimalStringSchema,
  }).strict(),
  z.object({
    type: z.literal('stop-limit'),
    stop_price: decimalStringSchema,
    limit_price: decimalStringSchema,
  }).strict(),
])

export const protectionLegSchema = z.object({
  type: z.enum(['price', 'ticks']),
  value: decimalStringSchema.refine((value) => !value.startsWith('-') && value !== '0', {
    message: 'Protection values must be positive',
  }),
}).strict()

export const orderIntentSchema = z.object({
  intent_schema_version: z.literal(ORDER_INTENT_SCHEMA_VERSION),
  intent_id: identifierSchema,
  source: z.object({
    type: z.enum(['discord', 'alert', 'agent', 'manual']),
    source_id: identifierSchema,
    author_id: identifierSchema.optional(),
  }).strict(),
  connection_id: identifierSchema,
  instrument: z.object({
    canonical_id: identifierSchema,
    symbol: identifierSchema,
    exchange: identifierSchema,
    expiry: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    tick_size: decimalStringSchema.refine((value) => Number(value) > 0, {
      message: 'Instrument tick size must be positive',
    }).optional(),
    point_value_usd: decimalStringSchema.refine((value) => Number(value) > 0, {
      message: 'Instrument point value must be positive',
    }).optional(),
  }).strict(),
  side: orderSideSchema,
  quantity: z.number().int().positive().max(1_000),
  entry: orderEntrySchema,
  protection: z.object({
    stop_loss: protectionLegSchema,
    take_profit: protectionLegSchema.optional(),
  }).strict(),
  max_loss_usd: decimalStringSchema.optional(),
  time_in_force: timeInForceSchema,
  created_at: utcTimestampSchema,
  valid_until: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((intent, context) => {
  if (Date.parse(intent.valid_until) <= Date.parse(intent.created_at)) {
    context.addIssue({
      code: 'custom',
      path: ['valid_until'],
      message: 'Order intent must expire after it is created',
    })
  }
  if (intent.source.type === 'discord' && !intent.source.author_id) {
    context.addIssue({
      code: 'custom',
      path: ['source', 'author_id'],
      message: 'Discord intents require an immutable author ID',
    })
  }
})

export const riskDecisionSchema = z.object({
  risk_decision_schema_version: z.literal(RISK_DECISION_SCHEMA_VERSION),
  decision_id: identifierSchema,
  intent_id: identifierSchema,
  account_snapshot_id: identifierSchema,
  risk_policy_version: semverSchema,
  result: z.enum(['allow', 'deny']),
  reasons: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  evaluated_at: utcTimestampSchema,
  valid_until: utcTimestampSchema,
}).strict().superRefine((decision, context) => {
  if (Date.parse(decision.valid_until) <= Date.parse(decision.evaluated_at)) {
    context.addIssue({
      code: 'custom',
      path: ['valid_until'],
      message: 'Risk decision must expire after evaluation',
    })
  }
})

export const executionAuthorizationSchema = z.object({
  authorization_schema_version: z.literal(EXECUTION_AUTHORIZATION_SCHEMA_VERSION),
  authorization_id: identifierSchema,
  connection_id: identifierSchema,
  mode: z.enum(['per-order', 'standing-mandate']),
  intent_id: identifierSchema.optional(),
  action_digest: sha256Schema.optional(),
  scope: z.object({
    symbols: z.array(identifierSchema).min(1).max(100),
    max_contracts: z.number().int().positive().max(10_000),
    allowed_sides: z.array(orderSideSchema).min(1).max(2),
    allowed_order_types: z.array(orderTypeSchema).min(1).max(4),
    session_start: utcTimestampSchema,
    session_end: utcTimestampSchema,
    max_daily_loss: decimalStringSchema,
    max_open_risk: decimalStringSchema,
  }).strict(),
  issued_by: identifierSchema,
  issued_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
}).strict().superRefine((authorization, context) => {
  if (Date.parse(authorization.expires_at) <= Date.parse(authorization.issued_at)) {
    context.addIssue({
      code: 'custom',
      path: ['expires_at'],
      message: 'Execution authorization must expire after issue',
    })
  }
  if (Date.parse(authorization.scope.session_end) <= Date.parse(authorization.scope.session_start)) {
    context.addIssue({
      code: 'custom',
      path: ['scope', 'session_end'],
      message: 'Authorization session must end after it starts',
    })
  }
  if (authorization.mode === 'per-order' && (!authorization.intent_id || !authorization.action_digest)) {
    context.addIssue({
      code: 'custom',
      path: ['intent_id'],
      message: 'Per-order authorization must bind an intent and action digest',
    })
  }
})

export const externalAuthorizationBasisSchema = z.object({
  authorization_basis_schema_version: z.literal(EXTERNAL_AUTHORIZATION_BASIS_SCHEMA_VERSION),
  authorization_basis_id: identifierSchema,
  firm_slug: identifierSchema,
  account_ref: identifierSchema,
  kind: z.enum([
    'platform-policy',
    'prior-written-consent',
    'owner-authorization',
    'operator-attestation',
  ]),
  evidence_ref: identifierSchema.optional(),
  recorded_by: identifierSchema,
  effective_at: utcTimestampSchema,
  expires_at: utcTimestampSchema.optional(),
  notes: z.string().trim().max(1_000).optional(),
}).strict().superRefine((basis, context) => {
  if (basis.expires_at && Date.parse(basis.expires_at) <= Date.parse(basis.effective_at)) {
    context.addIssue({
      code: 'custom',
      path: ['expires_at'],
      message: 'External authorization expiry must follow its effective time',
    })
  }
  if (
    (basis.kind === 'prior-written-consent' || basis.kind === 'owner-authorization')
    && !basis.evidence_ref
  ) {
    context.addIssue({
      code: 'custom',
      path: ['evidence_ref'],
      message: 'Written or owner authorization requires an evidence reference',
    })
  }
})

export const executionCommandSchema = z.object({
  command_schema_version: z.literal(EXECUTION_COMMAND_SCHEMA_VERSION),
  command_id: identifierSchema,
  intent_id: identifierSchema,
  claim_id: identifierSchema,
  connection_id: identifierSchema,
  adapter_id: identifierSchema,
  adapter_version: semverSchema,
  action_digest: sha256Schema,
  idempotency_key: sha256Schema,
  issued_at: utcTimestampSchema,
}).strict()

export const executionManagementOperationSchema = z.enum([
  'cancel',
  'modify',
  'partial-close',
  'flatten',
])

export const executionManagementPayloadSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('cancel'),
    provider_order_ids: z.array(identifierSchema).min(1).max(100),
  }).strict(),
  z.object({
    operation: z.literal('modify'),
    provider_order_id: identifierSchema,
    quantity: z.number().int().positive().max(10_000),
    order_type: orderTypeSchema,
    limit_price: decimalStringSchema.optional(),
    stop_price: decimalStringSchema.optional(),
    time_in_force: timeInForceSchema,
  }).strict().superRefine((payload, context) => {
    if (
      (payload.order_type === 'limit' || payload.order_type === 'stop-limit')
      && !payload.limit_price
    ) {
      context.addIssue({
        code: 'custom',
        path: ['limit_price'],
        message: 'Limit and stop-limit modifications require a limit price',
      })
    }
    if (
      (payload.order_type === 'stop' || payload.order_type === 'stop-limit')
      && !payload.stop_price
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stop_price'],
        message: 'Stop and stop-limit modifications require a stop price',
      })
    }
  }),
  z.object({
    operation: z.literal('partial-close'),
    quantity: z.number().int().positive().max(10_000),
  }).strict(),
  z.object({
    operation: z.literal('flatten'),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
])

export const executionManagementCommandSchema = z.object({
  management_command_schema_version: z.literal(EXECUTION_MANAGEMENT_COMMAND_SCHEMA_VERSION),
  management_command_id: identifierSchema,
  // New commands carry the durable caller operation identity. Optional keeps
  // existing on-disk records readable while event-scoped idempotency rolls out.
  request_id: identifierSchema.optional(),
  parent_command_id: identifierSchema,
  intent_id: identifierSchema,
  claim_id: identifierSchema,
  connection_id: identifierSchema,
  adapter_id: identifierSchema,
  adapter_version: semverSchema,
  payload: executionManagementPayloadSchema,
  action_digest: sha256Schema,
  idempotency_key: sha256Schema,
  issued_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export const executionManagementAcknowledgmentSchema = z.object({
  management_ack_schema_version: z.literal(EXECUTION_MANAGEMENT_ACK_SCHEMA_VERSION),
  management_command_id: identifierSchema,
  status: z.enum(['acknowledged', 'rejected', 'unknown']),
  provider_command_ids: z.array(identifierSchema).max(100),
  evidence_refs: z.array(identifierSchema).max(100),
  acknowledged_at: utcTimestampSchema,
  message: z.string().trim().min(1).max(500),
  content_checksum: sha256Schema,
}).strict().superRefine((acknowledgment, context) => {
  if (
    acknowledgment.status === 'acknowledged'
    && acknowledgment.provider_command_ids.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['provider_command_ids'],
      message: 'Acknowledged management commands require a provider command ID',
    })
  }
})

export const executionAccountSnapshotSchema = z.object({
  account_snapshot_schema_version: z.literal(EXECUTION_ACCOUNT_SNAPSHOT_SCHEMA_VERSION),
  account_snapshot_id: identifierSchema,
  connection_id: identifierSchema,
  account_ref: identifierSchema,
  environment: executionEnvironmentSchema,
  captured_at: utcTimestampSchema,
  can_trade: z.boolean(),
  balance: decimalStringSchema,
  realized_pnl: decimalStringSchema,
  open_pnl: decimalStringSchema,
  trailing_threshold: decimalStringSchema.optional(),
  positions: z.array(z.object({
    instrument_id: identifierSchema,
    symbol: identifierSchema,
    side: orderSideSchema,
    quantity: z.number().int().positive().max(10_000),
    average_price: decimalStringSchema,
  }).strict()).max(1_000),
  working_orders: z.array(z.object({
    provider_order_id: identifierSchema,
    instrument_id: identifierSchema,
    side: orderSideSchema,
    quantity: z.number().int().positive().max(10_000),
    order_type: orderTypeSchema,
    status: z.enum(['pending', 'working', 'partially-filled']),
  }).strict()).max(10_000),
}).strict()

export const executionSubmitAcknowledgmentSchema = z.object({
  submit_ack_schema_version: z.literal(EXECUTION_SUBMIT_ACK_SCHEMA_VERSION),
  command_id: identifierSchema,
  status: z.enum(['acknowledged', 'rejected']),
  provider_order_ids: z.array(identifierSchema).max(100),
  acknowledged_at: utcTimestampSchema,
  rejection_code: identifierSchema.optional(),
  rejection_message: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((acknowledgment, context) => {
  if (
    acknowledgment.status === 'rejected'
    && (!acknowledgment.rejection_code || !acknowledgment.rejection_message)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['rejection_code'],
      message: 'Rejected submissions require a safe code and message',
    })
  }
  if (
    acknowledgment.status === 'acknowledged'
    && acknowledgment.provider_order_ids.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['provider_order_ids'],
      message: 'Acknowledged submissions require a provider order ID',
    })
  }
})

export const executionProtectionOrderSchema = z.object({
  protection_order_schema_version: z.literal(EXECUTION_PROTECTION_ORDER_SCHEMA_VERSION),
  provider_order_id: identifierSchema,
  role: z.enum(['stop-loss', 'take-profit']),
  quantity: z.number().int().positive().max(10_000),
  order_type: orderTypeSchema,
  time_in_force: timeInForceSchema,
  limit_price: decimalStringSchema.optional(),
  stop_price: decimalStringSchema.optional(),
  status: z.enum(['pending', 'working', 'partially-filled']),
}).strict().superRefine((order, context) => {
  if (
    (order.order_type === 'limit' || order.order_type === 'stop-limit')
    && !order.limit_price
  ) {
    context.addIssue({
      code: 'custom',
      path: ['limit_price'],
      message: 'Limit protection orders require their current limit price',
    })
  }
  if (
    (order.order_type === 'stop' || order.order_type === 'stop-limit')
    && !order.stop_price
  ) {
    context.addIssue({
      code: 'custom',
      path: ['stop_price'],
      message: 'Stop protection orders require their current stop price',
    })
  }
  if (
    order.role === 'stop-loss'
    && order.order_type !== 'stop'
    && order.order_type !== 'stop-limit'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['order_type'],
      message: 'Stop-loss protection must identify a stop or stop-limit order',
    })
  }
  if (order.role === 'take-profit' && order.order_type !== 'limit') {
    context.addIssue({
      code: 'custom',
      path: ['order_type'],
      message: 'Take-profit protection must identify a limit order',
    })
  }
})

export const executionReconciliationSchema = z.object({
  reconciliation_schema_version: z.literal(EXECUTION_RECONCILIATION_SCHEMA_VERSION),
  reconciliation_id: identifierSchema,
  command_id: identifierSchema,
  connection_id: identifierSchema,
  status: z.enum([
    'not-found',
    'working',
    'partially-filled',
    'filled',
    'filled-protected',
    'closing',
    'closed',
    'canceled',
    'divergent',
  ]),
  provider_order_ids: z.array(identifierSchema).max(100),
  filled_quantity: z.number().int().nonnegative().max(10_000),
  open_quantity: z.number().int().nonnegative().max(10_000).optional(),
  average_fill_price: decimalStringSchema.optional(),
  protection_verified: z.boolean(),
  protection_orders: z.array(executionProtectionOrderSchema).max(20).optional(),
  evidence_refs: z.array(identifierSchema).max(100),
  reconciled_at: utcTimestampSchema,
  reason: z.string().trim().min(1).max(500),
}).strict().superRefine((result, context) => {
  if (result.filled_quantity === 0 && result.average_fill_price) {
    context.addIssue({
      code: 'custom',
      path: ['average_fill_price'],
      message: 'An unfilled reconciliation cannot claim an average fill price',
    })
  }
  if (result.status === 'filled-protected' && !result.protection_verified) {
    context.addIssue({
      code: 'custom',
      path: ['protection_verified'],
      message: 'Filled-protected reconciliation requires verified protection',
    })
  }
  if (result.status === 'filled-protected') {
    const stops = result.protection_orders?.filter((order) => order.role === 'stop-loss') ?? []
    if (
      !result.open_quantity
      || stops.length !== 1
      || stops[0]?.quantity !== result.open_quantity
    ) {
      context.addIssue({
        code: 'custom',
        path: ['open_quantity'],
        message: 'Filled-protected reconciliation requires one stop sized to the confirmed open position',
      })
    }
  }
})

export const executionLifecycleStateSchema = z.enum([
  'created',
  'risk-denied',
  'awaiting-authorization',
  'approved',
  'claimed',
  'submitting',
  'acknowledged',
  'partially-filled',
  'filled',
  'protecting',
  'protected',
  'closing',
  'closed',
  'submit-unknown',
  'protection-unknown',
  'reconcile-halted',
  'rejected',
  'canceled',
  'expired',
  'error',
])

export const executionTransitionSchema = z.object({
  transition_id: identifierSchema,
  from: executionLifecycleStateSchema.nullable(),
  to: executionLifecycleStateSchema,
  occurred_at: utcTimestampSchema,
  reason: z.string().trim().min(1).max(500),
}).strict()

export const executionReceiptResultSchema = z.enum([
  'rejected',
  'working',
  'partially-filled',
  'filled-protected',
  'canceled',
  'closed',
  'submit-unknown',
  'reconcile-halted',
])

export const executionReceiptSchema = z.object({
  receipt_schema_version: z.literal(EXECUTION_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  trace_id: identifierSchema,
  intent_id: identifierSchema,
  connection_id: identifierSchema,
  transport: executionTransportSchema,
  adapter: z.object({
    id: identifierSchema,
    version: semverSchema,
  }).strict(),
  provider_order_ids: z.array(identifierSchema).max(100),
  result: executionReceiptResultSchema,
  filled_quantity: z.number().int().nonnegative().max(10_000),
  open_quantity: z.number().int().nonnegative().max(10_000).optional(),
  average_fill_price: decimalStringSchema.optional(),
  protection_verified: z.boolean(),
  protection_orders: z.array(executionProtectionOrderSchema).max(20).optional(),
  evidence_refs: z.array(identifierSchema).max(100),
  completed_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((receipt, context) => {
  if (receipt.filled_quantity === 0 && receipt.average_fill_price) {
    context.addIssue({
      code: 'custom',
      path: ['average_fill_price'],
      message: 'An unfilled receipt cannot claim an average fill price',
    })
  }
  if (receipt.result === 'filled-protected' && !receipt.protection_verified) {
    context.addIssue({
      code: 'custom',
      path: ['protection_verified'],
      message: 'Filled-protected receipts require verified protection',
    })
  }
  if (receipt.result === 'filled-protected') {
    const stops = receipt.protection_orders?.filter((order) => order.role === 'stop-loss') ?? []
    if (
      !receipt.open_quantity
      || stops.length !== 1
      || stops[0]?.quantity !== receipt.open_quantity
    ) {
      context.addIssue({
        code: 'custom',
        path: ['open_quantity'],
        message: 'Filled-protected receipts require one stop sized to the confirmed open position',
      })
    }
  }
})

export const executionRecordSchema = z.object({
  record_schema_version: z.literal(EXECUTION_RECORD_SCHEMA_VERSION),
  trace_id: identifierSchema,
  intent: orderIntentSchema,
  state: executionLifecycleStateSchema,
  risk_decision: riskDecisionSchema.optional(),
  authorization: executionAuthorizationSchema.optional(),
  claim: z.object({
    claim_id: identifierSchema,
    claimed_at: utcTimestampSchema,
  }).strict().optional(),
  command: executionCommandSchema.optional(),
  management_actions: z.array(z.object({
    command: executionManagementCommandSchema,
    acknowledgment: executionManagementAcknowledgmentSchema.optional(),
  }).strict()).max(1_000).default([]),
  receipt: executionReceiptSchema.optional(),
  transitions: z.array(executionTransitionSchema).min(1).max(1_000),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
}).strict().superRefine((record, context) => {
  if (record.transitions.at(-1)?.to !== record.state) {
    context.addIssue({
      code: 'custom',
      path: ['transitions'],
      message: 'The last transition must match the record state',
    })
  }
  if (Date.parse(record.updated_at) < Date.parse(record.created_at)) {
    context.addIssue({
      code: 'custom',
      path: ['updated_at'],
      message: 'Execution record update cannot precede creation',
    })
  }
  if (record.command && !record.claim) {
    context.addIssue({
      code: 'custom',
      path: ['claim'],
      message: 'An execution command requires a durable claim',
    })
  }
  if (record.receipt && !record.command) {
    context.addIssue({
      code: 'custom',
      path: ['command'],
      message: 'An execution receipt requires a command',
    })
  }
})

export type ExecutionEnvironment = z.infer<typeof executionEnvironmentSchema>
export type ExecutionEnvironmentClass = z.infer<typeof executionEnvironmentClassSchema>
export type ExecutionTransport = z.infer<typeof executionTransportSchema>
export type ExecutionTransportPreference = z.infer<typeof executionTransportPreferenceSchema>
export type ExecutionConnectionState = z.infer<typeof executionConnectionStateSchema>
export type ExecutionCertification = z.infer<typeof executionCertificationSchema>
export type ExecutionCapabilities = z.infer<typeof executionCapabilitiesSchema>
export type TradingConnection = z.infer<typeof tradingConnectionSchema>
export type OrderSide = z.infer<typeof orderSideSchema>
export type OrderType = z.infer<typeof orderTypeSchema>
export type OrderEntry = z.infer<typeof orderEntrySchema>
export type OrderIntent = z.infer<typeof orderIntentSchema>
export type RiskDecision = z.infer<typeof riskDecisionSchema>
export type ExecutionAuthorization = z.infer<typeof executionAuthorizationSchema>
export type ExternalAuthorizationBasis = z.infer<typeof externalAuthorizationBasisSchema>
export type ExecutionCommand = z.infer<typeof executionCommandSchema>
export type ExecutionManagementOperation = z.infer<typeof executionManagementOperationSchema>
export type ExecutionManagementPayload = z.infer<typeof executionManagementPayloadSchema>
export type ExecutionManagementCommand = z.infer<typeof executionManagementCommandSchema>
export type ExecutionManagementAcknowledgment = z.infer<typeof executionManagementAcknowledgmentSchema>
export type ExecutionAccountSnapshot = z.infer<typeof executionAccountSnapshotSchema>
export type ExecutionSubmitAcknowledgment = z.infer<typeof executionSubmitAcknowledgmentSchema>
export type ExecutionReconciliation = z.infer<typeof executionReconciliationSchema>
export type ExecutionProtectionOrder = z.infer<typeof executionProtectionOrderSchema>
export type ExecutionLifecycleState = z.infer<typeof executionLifecycleStateSchema>
export type ExecutionTransition = z.infer<typeof executionTransitionSchema>
export type ExecutionReceipt = z.infer<typeof executionReceiptSchema>
export type ExecutionRecord = z.infer<typeof executionRecordSchema>
