import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  positiveDecimalStringSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'
import { discordManagementMessageSchema } from './discord-management.ts'

export const DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION = 'discord-options-signal@1' as const
export const OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION = 'option-contract-identity@1' as const
export const OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION = 'option-quote-snapshot@1' as const
export const OPTIONS_ENTRY_POLICY_SCHEMA_VERSION = 'options-entry-policy@1' as const
export const OPTIONS_DEBIT_RESERVATION_SCHEMA_VERSION = 'options-debit-reservation@1' as const
export const OPTIONS_ENTRY_DECISION_SCHEMA_VERSION = 'options-entry-decision@1' as const
export const OPTIONS_PROVIDER_PREVIEW_SCHEMA_VERSION = 'options-provider-preview@1' as const
export const OPTIONS_ORDER_INTENT_SCHEMA_VERSION = 'options-order-intent@1' as const
export const OPTIONS_EXECUTION_RECEIPT_SCHEMA_VERSION = 'options-execution-receipt@1' as const
export const OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION = 'options-reservation-release-proof@1' as const
export const OPTIONS_EXECUTION_COMMAND_SCHEMA_VERSION = 'options-execution-command@1' as const
export const OPTIONS_EXECUTION_RECORD_SCHEMA_VERSION = 'options-execution-record@1' as const
export const OPTIONS_CONNECTION_SCHEMA_VERSION = 'options-connection@1' as const
export const OPTIONS_PROVIDER_READ_PROOF_SCHEMA_VERSION = 'options-provider-read-proof@1' as const
export const OPTIONS_CERTIFICATION_EVIDENCE_SCHEMA_VERSION = 'options-certification-evidence@2' as const
export const OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION = 'options-certification-application@1' as const
export const OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION = 'options-manual-paper-authority@2' as const
export const OPTIONS_AUTHORITY_REVOCATION_SCHEMA_VERSION = 'options-authority-revocation@1' as const
export const OPTIONS_MANUAL_ORDER_SOURCE_SCHEMA_VERSION = 'options-manual-order-source@1' as const
export const OPTIONS_MANUAL_ORDER_REVIEW_SCHEMA_VERSION = 'options-manual-order-review@1' as const
export const OPTIONS_MANAGEMENT_COMMAND_SCHEMA_VERSION = 'options-management-command@1' as const
export const OPTIONS_MANAGEMENT_RECORD_SCHEMA_VERSION = 'options-management-record@1' as const
export const OPTIONS_DISCORD_FOLLOWUP_RECEIPT_SCHEMA_VERSION = 'options-discord-followup-receipt@1' as const
export const OPTIONS_EXPIRATION_SCHEDULE_SCHEMA_VERSION = 'options-expiration-schedule@1' as const
export const OPTIONS_EXPIRATION_ASSESSMENT_SCHEMA_VERSION = 'options-expiration-assessment@1' as const
export const OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION = 'options-automation-route@1' as const
export const OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION = 'options-autopilot-authority@1' as const
export const OPTIONS_AUTOPILOT_REVOCATION_SCHEMA_VERSION = 'options-autopilot-revocation@1' as const
export const OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION = 'options-autopilot-certification@2' as const
export const OPTIONS_AUTOMATION_RECEIPT_SCHEMA_VERSION = 'options-automation-receipt@1' as const
export const OPTIONS_AUTOMATION_PLAN_SCHEMA_VERSION = 'options-automation-plan@1' as const

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Expected a real calendar date')
const clockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')
const nonnegativeDecimalStringSchema = decimalStringSchema.refine((value) => !value.startsWith('-'), {
  message: 'Expected a nonnegative decimal string',
})
const positiveIntegerSchema = z.number().int().positive()
const nonnegativeIntegerSchema = z.number().int().nonnegative()

export const optionsProviderSchema = z.enum(['ibkr', 'webull'])

export const discordOptionsEntryInputSchema = z.object({
  guild_id: identifierSchema,
  channel_id: identifierSchema,
  thread_id: identifierSchema.nullable(),
  message_id: identifierSchema,
  author_id: identifierSchema,
  reply_to_message_id: identifierSchema.nullable(),
  posted_at: utcTimestampSchema,
  received_at: utcTimestampSchema,
  raw_text: z.string().trim().min(1).max(20_000),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.received_at) < Date.parse(value.posted_at)) {
    context.addIssue({ code: 'custom', path: ['received_at'], message: 'Options signal receipt cannot precede posting' })
  }
})

export const optionsConnectionSchema = z.object({
  connection_schema_version: z.literal(OPTIONS_CONNECTION_SCHEMA_VERSION),
  connection_id: identifierSchema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  auth_profile: z.enum(['ibkr-oauth-access-token', 'webull-individual-hmac']),
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  account_ref: z.string().min(1).max(120),
  account_label: z.string().min(1).max(160),
  endpoint: z.string().url().refine((value) => value.startsWith('https://'), 'Provider endpoint must use HTTPS'),
  credential_ref: identifierSchema,
  credential_generation: sha256Schema,
  state: z.enum(['credentials-saved', 'read-only-verified', 'blocked']),
  read_only: z.literal(true),
  execution_enabled: z.literal(false),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.provider === 'ibkr' && value.auth_profile !== 'ibkr-oauth-access-token') {
    context.addIssue({ code: 'custom', path: ['auth_profile'], message: 'IBKR requires its OAuth access-token profile' })
  }
  if (value.provider === 'webull' && value.auth_profile !== 'webull-individual-hmac') {
    context.addIssue({ code: 'custom', path: ['auth_profile'], message: 'Webull requires its Individual HMAC profile' })
  }
  if (value.provider === 'ibkr' && value.environment !== 'paper') {
    context.addIssue({ code: 'custom', path: ['environment'], message: 'Initial IBKR options enrollment is paper-only' })
  }
  if (value.provider === 'webull' && value.environment !== 'sandbox') {
    context.addIssue({ code: 'custom', path: ['environment'], message: 'Initial Webull options enrollment is sandbox-only' })
  }
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Connection update cannot precede creation' })
  }
})

export const optionsProviderReadProofSchema = z.object({
  proof_schema_version: z.literal(OPTIONS_PROVIDER_READ_PROOF_SCHEMA_VERSION),
  proof_id: identifierSchema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  credential_generation: sha256Schema,
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  account_ref: z.string().min(1).max(120),
  account_label: z.string().min(1).max(160),
  authenticated: z.literal(true),
  account_matched: z.literal(true),
  balances_readable: z.literal(true),
  positions_readable: z.literal(true),
  open_orders_readable: z.literal(true),
  option_contracts_readable: z.boolean(),
  option_quotes_readable: z.boolean(),
  option_quotes_realtime: z.boolean(),
  position_count: nonnegativeIntegerSchema,
  open_order_count: nonnegativeIntegerSchema,
  currency: z.string().min(3).max(8),
  net_liquidation: nonnegativeDecimalStringSchema.optional(),
  buying_power: nonnegativeDecimalStringSchema.optional(),
  provider_timestamp: utcTimestampSchema.optional(),
  verified_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  safe_evidence: z.array(z.string().min(1).max(240)).min(1).max(30),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expires_at) <= Date.parse(value.verified_at)) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'Read proof must expire after verification' })
  }
})

export const optionsCertificationScenarioSchema = z.enum([
  'exact-account-environment',
  'exact-standard-contract',
  'fresh-realtime-option-quote',
  'bounded-preview',
  'one-contract-limit-entry',
  'duplicate-submit-suppressed',
  'cancel-working-order-proved',
  'full-close-no-short-proved',
  'restart-reconciliation-proved',
  'unknown-submit-contained',
  'final-flat-zero-orders',
])

export const optionsCertificationEvidenceSchema = z.object({
  certification_schema_version: z.literal(OPTIONS_CERTIFICATION_EVIDENCE_SCHEMA_VERSION),
  certification_id: identifierSchema,
  certification_session_id: identifierSchema,
  journal_head_checksum: sha256Schema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  credential_generation: sha256Schema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  account_ref: z.string().min(1).max(120),
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  max_test_debit: positiveDecimalStringSchema,
  client_order_prefix: z.string().regex(/^tgcert-[a-z0-9-]{1,16}$/),
  allowed_contract_id: identifierSchema,
  allowed_provider_instrument_id: identifierSchema,
  started_at: utcTimestampSchema,
  completed_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  scenarios: z.array(z.object({
    scenario: optionsCertificationScenarioSchema,
    status: z.enum(['pass', 'fail', 'blocked']),
    evidence_checksum: sha256Schema,
    detail: z.string().min(1).max(300),
    observed_at: utcTimestampSchema,
  }).strict()).length(optionsCertificationScenarioSchema.options.length),
  mutation_count: nonnegativeIntegerSchema,
  final_position_quantity: nonnegativeIntegerSchema,
  final_working_order_count: nonnegativeIntegerSchema,
  final_truth_evidence_checksum: sha256Schema,
  eligible_level: z.enum(['options-sandbox-entry-certified']).nullable(),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (!(Date.parse(value.started_at) <= Date.parse(value.completed_at)
    && Date.parse(value.completed_at) < Date.parse(value.expires_at))) {
    context.addIssue({ code: 'custom', path: ['completed_at'], message: 'Certification chronology is invalid' })
  }
  const expected = new Set(optionsCertificationScenarioSchema.options)
  for (const result of value.scenarios) {
    if (!expected.delete(result.scenario)) {
      context.addIssue({ code: 'custom', path: ['scenarios'], message: 'Certification scenarios must be exact and unique' })
    }
  }
  const eligible = value.scenarios.every((result) => result.status === 'pass')
    && value.final_position_quantity === 0
    && value.final_working_order_count === 0
    && value.mutation_count >= 4
  if ((value.eligible_level !== null) !== eligible) {
    context.addIssue({ code: 'custom', path: ['eligible_level'], message: 'Certification eligibility overstates retained evidence' })
  }
})

export const optionsCertificationApplicationSchema = z.object({
  application_schema_version: z.literal(OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION),
  application_id: identifierSchema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  credential_generation: sha256Schema,
  certification_id: identifierSchema,
  certification_checksum: sha256Schema,
  certification_expires_at: utcTimestampSchema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  account_ref: z.string().min(1).max(120),
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  applied_at: utcTimestampSchema,
  operator_confirmed: z.literal(true),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.certification_expires_at) <= Date.parse(value.applied_at)) {
    context.addIssue({ code: 'custom', path: ['certification_expires_at'], message: 'Applied certification is already expired' })
  }
})

export const optionsManualPaperAuthoritySchema = z.object({
  authority_schema_version: z.literal(OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION),
  authority_id: identifierSchema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  credential_generation: sha256Schema,
  certification_id: identifierSchema,
  certification_checksum: sha256Schema,
  certification_expires_at: utcTimestampSchema,
  certification_application_id: identifierSchema,
  certification_application_checksum: sha256Schema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  account_ref: z.string().min(1).max(120),
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  allowed_contract_id: identifierSchema,
  allowed_provider_instrument_id: identifierSchema,
  mode: z.literal('manual-confirmed-paper'),
  max_contracts_per_order: z.literal(1),
  max_debit_per_order: positiveDecimalStringSchema,
  valid_from: utcTimestampSchema,
  valid_until: utcTimestampSchema,
  operator_confirmed_at: utcTimestampSchema,
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (!(value.valid_from === value.created_at
    && value.operator_confirmed_at === value.created_at
    && Date.parse(value.valid_until) > Date.parse(value.valid_from)
    && Date.parse(value.valid_until) <= Date.parse(value.certification_expires_at))) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Manual paper authority chronology exceeds its certification' })
  }
})

export const optionsAuthorityRevocationSchema = z.object({
  revocation_schema_version: z.literal(OPTIONS_AUTHORITY_REVOCATION_SCHEMA_VERSION),
  revocation_id: identifierSchema,
  authority_id: identifierSchema,
  authority_checksum: sha256Schema,
  connection_id: identifierSchema,
  reason: z.enum(['operator', 'account-change', 'credential-change', 'certification-expired', 'integrity-failure']),
  revoked_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export const optionsManualOrderSourceSchema = z.object({
  source_schema_version: z.literal(OPTIONS_MANUAL_ORDER_SOURCE_SCHEMA_VERSION),
  source_id: identifierSchema,
  source_kind: z.literal('manual-operator'),
  connection_id: identifierSchema,
  account_id: identifierSchema,
  authority_id: identifierSchema,
  authority_checksum: sha256Schema,
  canonical_contract_id: identifierSchema,
  operator_max_premium: positiveDecimalStringSchema,
  created_at: utcTimestampSchema,
  valid_until: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.valid_until) <= Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Manual order source must expire after creation' })
  }
})

export const optionsAutomationRouteSchema = z.object({
  route_schema_version: z.literal(OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION),
  route_id: identifierSchema,
  revision: positiveIntegerSchema,
  display_name: z.string().trim().min(1).max(160),
  guild_id: identifierSchema,
  channel_id: identifierSchema,
  thread_id: identifierSchema.nullable(),
  author_id: identifierSchema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  account_id: z.string().min(1).max(120),
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  policy_id: identifierSchema,
  policy_revision: positiveIntegerSchema,
  policy_checksum: sha256Schema,
  required_certification: z.literal('options-paper-autopilot-certified'),
  state: z.enum(['draft', 'paused', 'archived']),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Route update cannot precede creation' })
  }
})

export const optionsAutopilotAuthoritySchema = z.object({
  authority_schema_version: z.literal(OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION),
  authority_id: identifierSchema,
  route_id: identifierSchema,
  route_revision: positiveIntegerSchema,
  route_checksum: sha256Schema,
  policy_id: identifierSchema,
  policy_revision: positiveIntegerSchema,
  policy_checksum: sha256Schema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  credential_generation: sha256Schema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  account_id: z.string().min(1).max(120),
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  certification_id: identifierSchema,
  certification_checksum: sha256Schema,
  certification_level: z.literal('options-paper-autopilot-certified'),
  certification_expires_at: utcTimestampSchema,
  certification_application_id: identifierSchema,
  certification_application_checksum: sha256Schema,
  mode: z.literal('automatic-paper'),
  valid_from: utcTimestampSchema,
  valid_until: utcTimestampSchema,
  operator_confirmed_at: utcTimestampSchema,
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (!(value.valid_from === value.created_at
    && value.operator_confirmed_at === value.created_at
    && Date.parse(value.valid_until) > Date.parse(value.valid_from)
    && Date.parse(value.valid_until) <= Date.parse(value.certification_expires_at))) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Autopilot authority must stay inside its exact certification window' })
  }
})

export const optionsAutopilotRevocationSchema = z.object({
  revocation_schema_version: z.literal(OPTIONS_AUTOPILOT_REVOCATION_SCHEMA_VERSION),
  revocation_id: identifierSchema,
  authority_id: identifierSchema,
  authority_checksum: sha256Schema,
  route_id: identifierSchema,
  connection_id: identifierSchema,
  reason: z.enum(['operator', 'route-change', 'policy-change', 'account-change', 'credential-change', 'certification-expired', 'integrity-failure']),
  revoked_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict()

export const optionsAutopilotCertificationScenarioSchema = z.enum([
  'exact-source-route-proved',
  'bounded-entry-proved',
  'duplicate-entry-suppressed',
  'working-entry-cancel-proved',
  'partial-fill-contained',
  'full-close-no-short-proved',
  'management-restart-proved',
  'stale-followup-suppressed',
  'expiration-close-proved',
  'do-not-exercise-proved',
  'unknown-submit-contained',
  'fifty-clean-lifecycles-proved',
  'final-flat-zero-orders',
])

export const optionsAutopilotCertificationEvidenceSchema = z.object({
  certification_schema_version: z.literal(OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION),
  certification_id: identifierSchema,
  certification_session_id: identifierSchema,
  journal_head_checksum: sha256Schema,
  connection_id: identifierSchema,
  connection_checksum: sha256Schema,
  credential_generation: sha256Schema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  account_id: z.string().min(1).max(120),
  adapter_id: identifierSchema,
  adapter_version: z.string().regex(/^\d+\.\d+\.\d+$/),
  provider_contract_version: identifierSchema,
  base_certification_id: identifierSchema,
  base_certification_checksum: sha256Schema,
  base_application_id: identifierSchema,
  base_application_checksum: sha256Schema,
  started_at: utcTimestampSchema,
  completed_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  scenarios: z.array(z.object({
    scenario: optionsAutopilotCertificationScenarioSchema,
    status: z.enum(['pass', 'fail', 'blocked']),
    evidence_checksum: sha256Schema,
    detail: z.string().min(1).max(300),
    observed_at: utcTimestampSchema,
  }).strict()).length(optionsAutopilotCertificationScenarioSchema.options.length),
  completed_lifecycle_count: nonnegativeIntegerSchema,
  lifecycle_evidence: z.array(z.object({
    lifecycle_id: identifierSchema,
    evidence_checksum: sha256Schema,
    completed_at: utcTimestampSchema,
  }).strict()),
  provider_automatic_close_certified: z.boolean(),
  provider_do_not_exercise_certified: z.boolean(),
  provider_calendar_checksum: sha256Schema,
  account_exercise_setting_checksum: sha256Schema,
  custody_certification_checksum: sha256Schema,
  final_position_quantity: nonnegativeIntegerSchema,
  final_working_order_count: nonnegativeIntegerSchema,
  eligible_level: z.literal('options-paper-autopilot-certified').nullable(),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (!(Date.parse(value.started_at) <= Date.parse(value.completed_at)
    && Date.parse(value.completed_at) < Date.parse(value.expires_at))) {
    context.addIssue({ code: 'custom', path: ['completed_at'], message: 'Autopilot certification chronology is invalid' })
  }
  const expected = new Set(optionsAutopilotCertificationScenarioSchema.options)
  for (const result of value.scenarios) {
    if (!expected.delete(result.scenario)) context.addIssue({ code: 'custom', path: ['scenarios'], message: 'Autopilot scenarios must be exact and unique' })
  }
  const eligible = value.scenarios.every((result) => result.status === 'pass')
    && value.completed_lifecycle_count >= 50
    && value.provider_automatic_close_certified
    && value.provider_do_not_exercise_certified
    && value.final_position_quantity === 0
    && value.final_working_order_count === 0
  const lifecycleIds = new Set(value.lifecycle_evidence.map((item) => item.lifecycle_id))
  if (lifecycleIds.size !== value.lifecycle_evidence.length
    || value.lifecycle_evidence.length !== value.completed_lifecycle_count) {
    context.addIssue({ code: 'custom', path: ['lifecycle_evidence'], message: 'Every clean lifecycle requires one unique retained proof' })
  }
  if ((value.eligible_level !== null) !== eligible) {
    context.addIssue({ code: 'custom', path: ['eligible_level'], message: 'Autopilot eligibility overstates retained provider evidence' })
  }
})

export const optionsAutomationReceiptSchema = z.object({
  receipt_schema_version: z.literal(OPTIONS_AUTOMATION_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  guild_id: identifierSchema,
  channel_id: identifierSchema,
  thread_id: identifierSchema.nullable(),
  message_id: identifierSchema,
  author_id: identifierSchema,
  raw_content_checksum: sha256Schema,
  signal_checksum: sha256Schema.nullable(),
  route_id: identifierSchema.nullable(),
  route_checksum: sha256Schema.nullable(),
  connection_id: identifierSchema.nullable(),
  policy_checksum: sha256Schema.nullable(),
  authority_checksum: sha256Schema.nullable(),
  decision_checksum: sha256Schema.nullable(),
  reservation_id: identifierSchema.nullable(),
  execution_intent_id: identifierSchema.nullable(),
  state: z.enum(['blocked', 'skipped', 'prepared', 'working', 'active', 'flat', 'halted']),
  reason_codes: z.array(identifierSchema).min(1),
  detail: z.string().min(1).max(500),
  posted_at: utcTimestampSchema,
  received_at: utcTimestampSchema,
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (!(Date.parse(value.posted_at) <= Date.parse(value.received_at)
    && Date.parse(value.received_at) <= Date.parse(value.created_at)
    && Date.parse(value.created_at) <= Date.parse(value.updated_at))) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Options automation receipt chronology is invalid' })
  }
  if ((value.state === 'prepared' || value.state === 'working' || value.state === 'active' || value.state === 'flat')
    && (!value.signal_checksum || !value.route_id || !value.route_checksum || !value.connection_id
      || !value.policy_checksum || !value.authority_checksum || !value.decision_checksum || !value.reservation_id)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Executable automation receipts require complete frozen authority lineage' })
  }
})

function decimalParts(value: string): { coefficient: bigint; scale: number } {
  const negative = value.startsWith('-')
  const unsigned = negative ? value.slice(1) : value
  const [whole = '0', fraction = ''] = unsigned.split('.')
  const coefficient = BigInt(`${whole}${fraction}` || '0') * (negative ? -1n : 1n)
  return { coefficient, scale: fraction.length }
}

function compareDecimals(left: string, right: string): number {
  const a = decimalParts(left)
  const b = decimalParts(right)
  const scale = Math.max(a.scale, b.scale)
  const scaledA = a.coefficient * (10n ** BigInt(scale - a.scale))
  const scaledB = b.coefficient * (10n ** BigInt(scale - b.scale))
  return scaledA < scaledB ? -1 : scaledA > scaledB ? 1 : 0
}

function addDecimals(left: string, right: string): string {
  const a = decimalParts(left)
  const b = decimalParts(right)
  const scale = Math.max(a.scale, b.scale)
  const coefficient = (a.coefficient * (10n ** BigInt(scale - a.scale)))
    + (b.coefficient * (10n ** BigInt(scale - b.scale)))
  const negative = coefficient < 0n
  const absolute = negative ? -coefficient : coefficient
  if (scale === 0) return `${negative ? '-' : ''}${absolute}`
  const digits = absolute.toString().padStart(scale + 1, '0')
  return normalizeDecimal(`${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`)
}

function multiplyDecimalByInteger(value: string, multiplier: number): string {
  const parts = decimalParts(value)
  const coefficient = parts.coefficient * BigInt(multiplier)
  const negative = coefficient < 0n
  const absolute = negative ? -coefficient : coefficient
  if (parts.scale === 0) return `${negative ? '-' : ''}${absolute}`
  const digits = absolute.toString().padStart(parts.scale + 1, '0')
  return normalizeDecimal(`${negative ? '-' : ''}${digits.slice(0, -parts.scale)}.${digits.slice(-parts.scale)}`)
}

function expectedDebit(price: string, quantity: number, fees: string): string {
  return addDecimals(multiplyDecimalByInteger(price, quantity * 100), fees)
}

function normalizeDecimal(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
}

const referencePremiumSchema = z.object({
  low: positiveDecimalStringSchema,
  high: positiveDecimalStringSchema,
}).strict().superRefine((value, context) => {
  if (compareDecimals(value.high, value.low) < 0) {
    context.addIssue({ code: 'custom', path: ['high'], message: 'Premium high must be at least the low' })
  }
})

export const discordOptionsSignalSchema = z.object({
  signal_schema_version: z.literal(DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION),
  signal_id: identifierSchema,
  provenance: z.object({
    guild_id: identifierSchema,
    channel_id: identifierSchema,
    message_id: identifierSchema,
    author_id: identifierSchema,
    thread_id: identifierSchema.nullable(),
    reply_to_message_id: identifierSchema.nullable(),
    posted_at: utcTimestampSchema,
    received_at: utcTimestampSchema,
    content_sha256: sha256Schema,
  }).strict(),
  raw_text: z.string().min(1).max(10_000),
  action: z.literal('buy_to_open'),
  strategy: z.literal('single-leg'),
  underlying: z.string().regex(/^[A-Z][A-Z0-9.]{0,14}$/),
  expiration: dateSchema,
  strike: positiveDecimalStringSchema,
  right: z.enum(['call', 'put']),
  reference_entry: positiveDecimalStringSchema,
  reference_kind: z.enum(['single_price', 'trader_fill', 'entry_range']),
  reference_range: referencePremiumSchema.optional(),
  source_quantity: positiveIntegerSchema.optional(),
  trader_label: z.string().min(1).max(160).optional(),
  source_stop: positiveDecimalStringSchema.optional(),
  source_target: positiveDecimalStringSchema.optional(),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.provenance.received_at) < Date.parse(value.provenance.posted_at)) {
    context.addIssue({ code: 'custom', path: ['provenance', 'received_at'], message: 'Receipt cannot precede posting' })
  }
  if (value.reference_kind === 'entry_range' && value.reference_range === undefined) {
    context.addIssue({ code: 'custom', path: ['reference_range'], message: 'Entry-range evidence requires exact bounds' })
  }
  if (value.reference_kind !== 'entry_range' && value.reference_range !== undefined) {
    context.addIssue({ code: 'custom', path: ['reference_range'], message: 'Only entry-range evidence can carry bounds' })
  }
  if (value.reference_range && compareDecimals(value.reference_entry, value.reference_range.high) !== 0) {
    context.addIssue({ code: 'custom', path: ['reference_entry'], message: 'Entry-range reference must equal its high bound' })
  }
})

export const optionContractIdentitySchema = z.object({
  contract_schema_version: z.literal(OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION),
  canonical_id: identifierSchema,
  underlying: z.string().regex(/^[A-Z][A-Z0-9.]{0,14}$/),
  expiration: dateSchema,
  strike: positiveDecimalStringSchema,
  right: z.enum(['call', 'put']),
  currency: z.literal('USD'),
  asset_class: z.enum(['US_EQUITY_OPTION', 'US_ETF_OPTION', 'US_LISTED_OPTION']),
  multiplier: z.literal(100),
  standard_deliverable: z.literal(true),
  provider: identifierSchema,
  provider_instrument_id: identifierSchema,
  provider_symbol: z.string().min(1).max(160),
  listing_eligible: z.boolean(),
  smart_routing_eligible: z.boolean(),
  minimum_tick: positiveDecimalStringSchema,
  increment_bands: z.array(z.object({
    minimum_price: nonnegativeDecimalStringSchema,
    increment: positiveDecimalStringSchema,
  }).strict()).min(1),
  resolved_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  const rightCode = value.right === 'call' ? 'C' : 'P'
  const expectedId = `USOPT:${value.underlying}:${value.expiration}:${rightCode}:${normalizeDecimal(value.strike)}`
  if (value.canonical_id !== expectedId) {
    context.addIssue({ code: 'custom', path: ['canonical_id'], message: 'Canonical contract ID does not match its economics' })
  }
  if (compareDecimals(value.increment_bands[0]!.minimum_price, '0') !== 0) {
    context.addIssue({ code: 'custom', path: ['increment_bands', 0, 'minimum_price'], message: 'Increment bands must begin at zero' })
  }
  if (compareDecimals(value.increment_bands[0]!.increment, value.minimum_tick) !== 0) {
    context.addIssue({ code: 'custom', path: ['minimum_tick'], message: 'Minimum tick must match the first increment band' })
  }
  for (let index = 1; index < value.increment_bands.length; index += 1) {
    if (compareDecimals(value.increment_bands[index]!.minimum_price, value.increment_bands[index - 1]!.minimum_price) <= 0) {
      context.addIssue({ code: 'custom', path: ['increment_bands', index, 'minimum_price'], message: 'Increment bands must be strictly increasing' })
    }
  }
})

export const optionQuoteSnapshotSchema = z.object({
  quote_schema_version: z.literal(OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION),
  quote_id: identifierSchema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  provider_instrument_id: identifierSchema,
  environment: z.enum(['paper', 'sandbox']),
  market_data_mode: z.enum(['realtime', 'delayed', 'indicative']),
  bid: positiveDecimalStringSchema,
  ask: positiveDecimalStringSchema,
  bid_size: nonnegativeIntegerSchema,
  ask_size: nonnegativeIntegerSchema,
  provider_timestamp: utcTimestampSchema,
  received_at: utcTimestampSchema,
  decision_at: utcTimestampSchema,
  quote_age_ms: nonnegativeIntegerSchema,
  delayed: z.boolean(),
  indicative: z.boolean(),
  halted: z.boolean(),
  minimum_tick: positiveDecimalStringSchema,
  provenance: z.string().min(1).max(240),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (compareDecimals(value.bid, value.ask) > 0) {
    context.addIssue({ code: 'custom', path: ['ask'], message: 'Ask cannot be below bid' })
  }
  if (Date.parse(value.received_at) < Date.parse(value.provider_timestamp)) {
    context.addIssue({ code: 'custom', path: ['received_at'], message: 'Receipt cannot precede provider timestamp' })
  }
  if (Date.parse(value.decision_at) < Date.parse(value.received_at)) {
    context.addIssue({ code: 'custom', path: ['decision_at'], message: 'Decision cannot precede receipt' })
  }
  const trustedAge = Date.parse(value.decision_at) - Date.parse(value.received_at)
  if (trustedAge !== value.quote_age_ms) {
    context.addIssue({ code: 'custom', path: ['quote_age_ms'], message: 'Quote age must match trusted receive-to-decision time' })
  }
  if ((value.market_data_mode === 'delayed') !== value.delayed) {
    context.addIssue({ code: 'custom', path: ['delayed'], message: 'Delayed flag must match market-data mode' })
  }
  if ((value.market_data_mode === 'indicative') !== value.indicative) {
    context.addIssue({ code: 'custom', path: ['indicative'], message: 'Indicative flag must match market-data mode' })
  }
})

export const optionsEntryPolicySchema = z.object({
  policy_schema_version: z.literal(OPTIONS_ENTRY_POLICY_SCHEMA_VERSION),
  policy_id: identifierSchema,
  revision: positiveIntegerSchema,
  max_signal_age_ms: positiveIntegerSchema,
  max_ingest_delay_ms: positiveIntegerSchema,
  regular_session_only: z.literal(true),
  entry_window: z.object({ earliest: clockSchema, latest: clockSchema, timezone: z.literal('America/New_York') }).strict(),
  allowed_weekdays: z.array(z.number().int().min(1).max(5)).min(1),
  min_days_to_expiration: positiveIntegerSchema,
  max_days_to_expiration: positiveIntegerSchema,
  max_quote_age_ms: positiveIntegerSchema,
  min_bid_size: nonnegativeIntegerSchema,
  min_ask_size: nonnegativeIntegerSchema,
  max_spread_abs: positiveDecimalStringSchema,
  max_spread_pct: positiveDecimalStringSchema,
  spread_gate_mode: z.literal('both'),
  max_chase_abs: nonnegativeDecimalStringSchema,
  max_chase_pct: nonnegativeDecimalStringSchema,
  max_favorable_retrace_pct: nonnegativeDecimalStringSchema,
  tight_spread_action: z.enum(['marketable_limit', 'skip']),
  wide_spread_action: z.enum(['passive_limit', 'skip']),
  passive_limit_offset_abs: nonnegativeDecimalStringSchema,
  working_order_ttl_ms: positiveIntegerSchema,
  max_reprice_attempts: nonnegativeIntegerSchema,
  reprice_interval_ms: positiveIntegerSchema,
  cancel_at_signal_expiry: z.boolean(),
  sizing: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('fixed_contracts'), fixed_contracts: positiveIntegerSchema }).strict(),
    z.object({ mode: z.literal('max_debit_budget'), max_debit_budget: positiveDecimalStringSchema }).strict(),
  ]),
  max_contracts_per_order: positiveIntegerSchema,
  max_debit_per_trade: positiveDecimalStringSchema,
  max_aggregate_open_debit: positiveDecimalStringSchema,
  max_daily_debit_initiated: positiveDecimalStringSchema,
  max_open_positions: z.literal(1),
  max_active_positions_per_source: z.literal(1),
  source_quantity_behavior: z.enum(['ignore', 'use_with_cap']),
  duplicate_contract_policy: z.literal('block'),
  expiration_custody: z.object({
    provider_calendar_checksum: sha256Schema,
    account_exercise_setting_checksum: sha256Schema,
    no_new_entry_minutes_before_close: positiveIntegerSchema,
    automatic_close_start_minutes_before_close: positiveIntegerSchema,
    operator_escalation_minutes_before_close: positiveIntegerSchema,
    do_not_exercise_mode: z.enum(['provider-supported', 'manual-required']),
    custody_certification_checksum: sha256Schema,
  }).strict(),
  environment: z.enum(['paper', 'sandbox']),
  provider_slug: identifierSchema,
  adapter_id: identifierSchema,
  required_certification: identifierSchema,
  certification_checksum: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  source_route_id: identifierSchema,
  global_halt_required: z.literal(true),
  account_halt_required: z.literal(true),
  source_halt_required: z.literal(true),
  mandate_expires_at: utcTimestampSchema,
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.min_days_to_expiration > value.max_days_to_expiration) {
    context.addIssue({ code: 'custom', path: ['max_days_to_expiration'], message: 'Maximum DTE must not be below minimum DTE' })
  }
  if (Date.parse(value.mandate_expires_at) <= Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['mandate_expires_at'], message: 'Mandate must expire after creation' })
  }
  if (value.entry_window.earliest >= value.entry_window.latest) {
    context.addIssue({ code: 'custom', path: ['entry_window', 'latest'], message: 'Entry window must end after it begins' })
  }
  if (new Set(value.allowed_weekdays).size !== value.allowed_weekdays.length) {
    context.addIssue({ code: 'custom', path: ['allowed_weekdays'], message: 'Allowed weekdays must be unique' })
  }
  if (value.sizing.mode === 'fixed_contracts' && value.sizing.fixed_contracts > value.max_contracts_per_order) {
    context.addIssue({ code: 'custom', path: ['sizing', 'fixed_contracts'], message: 'Fixed quantity cannot exceed the order cap' })
  }
  if (value.sizing.mode === 'max_debit_budget' && compareDecimals(value.sizing.max_debit_budget, value.max_debit_per_trade) > 0) {
    context.addIssue({ code: 'custom', path: ['sizing', 'max_debit_budget'], message: 'Sizing budget cannot exceed the per-trade debit cap' })
  }
  const custody = value.expiration_custody
  if (!(custody.no_new_entry_minutes_before_close > custody.automatic_close_start_minutes_before_close
    && custody.automatic_close_start_minutes_before_close > custody.operator_escalation_minutes_before_close)) {
    context.addIssue({ code: 'custom', path: ['expiration_custody'], message: 'Expiration deadlines must progress toward market close' })
  }
})

export const optionsEntryDecisionSchema = z.object({
  decision_schema_version: z.literal(OPTIONS_ENTRY_DECISION_SCHEMA_VERSION),
  decision_id: identifierSchema,
  signal_checksum: sha256Schema,
  route_checksum: sha256Schema,
  account_checksum: sha256Schema,
  contract_checksum: sha256Schema,
  quote_checksum: sha256Schema,
  policy_checksum: sha256Schema,
  source_reference_price: positiveDecimalStringSchema,
  bid: nonnegativeDecimalStringSchema,
  ask: nonnegativeDecimalStringSchema,
  midpoint: nonnegativeDecimalStringSchema,
  spread_abs: nonnegativeDecimalStringSchema,
  spread_pct: nonnegativeDecimalStringSchema,
  unfavorable_drift_abs: nonnegativeDecimalStringSchema,
  unfavorable_drift_pct: nonnegativeDecimalStringSchema,
  favorable_retrace_pct: nonnegativeDecimalStringSchema,
  absolute_chase_cap: positiveDecimalStringSchema,
  percentage_chase_cap: positiveDecimalStringSchema,
  effective_chase_cap: positiveDecimalStringSchema,
  action: z.enum(['marketable_limit', 'passive_limit', 'skip', 'block']),
  limit_price: positiveDecimalStringSchema.optional(),
  planned_quantity: positiveIntegerSchema,
  maximum_debit: positiveDecimalStringSchema,
  reason_codes: z.array(identifierSchema).min(1),
  decided_at: utcTimestampSchema,
  valid_until: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if ((value.action === 'marketable_limit' || value.action === 'passive_limit') && value.limit_price === undefined) {
    context.addIssue({ code: 'custom', path: ['limit_price'], message: 'Entry decisions require an exact limit price' })
  }
  if ((value.action === 'skip' || value.action === 'block') && value.limit_price !== undefined) {
    context.addIssue({ code: 'custom', path: ['limit_price'], message: 'Non-entry decisions cannot carry a limit price' })
  }
  if (Date.parse(value.valid_until) <= Date.parse(value.decided_at)) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Decision validity must extend past decision time' })
  }
})

export const optionsDebitReservationSchema = z.object({
  reservation_schema_version: z.literal(OPTIONS_DEBIT_RESERVATION_SCHEMA_VERSION),
  reservation_id: identifierSchema,
  intent_id: identifierSchema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  source_id: identifierSchema,
  policy_id: identifierSchema,
  policy_checksum: sha256Schema,
  mandate_id: identifierSchema,
  mandate_checksum: sha256Schema,
  canonical_contract_id: identifierSchema,
  contract_checksum: sha256Schema,
  reserved_contracts: positiveIntegerSchema,
  limit_price: positiveDecimalStringSchema,
  multiplier: z.literal(100),
  estimated_fees: nonnegativeDecimalStringSchema,
  worst_case_debit: positiveDecimalStringSchema,
  account_capacity_snapshot_checksum: sha256Schema,
  active_reservation_set_checksum: sha256Schema,
  admission_request_checksum: sha256Schema,
  state: z.enum(['prepared', 'submitting', 'working', 'partially-filled', 'submit-unknown', 'open-position', 'releasing', 'released', 'halted']),
  filled_quantity: nonnegativeIntegerSchema,
  open_quantity: nonnegativeIntegerSchema,
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  initiated_at: utcTimestampSchema.nullable(),
  execution_record_checksum: sha256Schema.nullable(),
  terminal_proof_at: utcTimestampSchema.nullable(),
  terminal_proof_checksum: sha256Schema.nullable(),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.filled_quantity > value.reserved_contracts || value.open_quantity > value.reserved_contracts) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Reservation quantities cannot exceed the reserved contracts' })
  }
  if (value.open_quantity > value.filled_quantity) {
    context.addIssue({ code: 'custom', path: ['open_quantity'], message: 'Open quantity cannot exceed confirmed fills' })
  }
  if (value.state === 'prepared'
    && (value.filled_quantity !== 0
      || value.open_quantity !== 0
      || value.initiated_at !== null
      || value.execution_record_checksum !== null)) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Prepared reservations cannot claim provider delivery or exposure' })
  }
  if (value.state === 'partially-filled' && (value.filled_quantity <= 0 || value.filled_quantity >= value.reserved_contracts)) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Partial-fill state requires a strict partial quantity' })
  }
  if (value.state === 'open-position' && value.open_quantity <= 0) {
    context.addIssue({ code: 'custom', path: ['open_quantity'], message: 'Open-position state requires owned open quantity' })
  }
  if (compareDecimals(value.worst_case_debit, expectedDebit(value.limit_price, value.reserved_contracts, value.estimated_fees)) !== 0) {
    context.addIssue({ code: 'custom', path: ['worst_case_debit'], message: 'Worst-case debit does not match price, multiplier, quantity, and fees' })
  }
  if (Date.parse(value.updated_at) < Date.parse(value.created_at) || Date.parse(value.expires_at) <= Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Reservation chronology is invalid' })
  }
  if (value.initiated_at !== null
    && (Date.parse(value.initiated_at) < Date.parse(value.created_at)
      || Date.parse(value.initiated_at) > Date.parse(value.updated_at))) {
    context.addIssue({ code: 'custom', path: ['initiated_at'], message: 'Initiation time must fall within the reservation history' })
  }
  if (value.state !== 'prepared'
    && value.state !== 'released'
    && (value.initiated_at === null || value.execution_record_checksum === null)) {
    context.addIssue({ code: 'custom', path: ['initiated_at'], message: 'Provider-delivery states require initiation and execution evidence' })
  }
  if ((value.terminal_proof_at === null) !== (value.terminal_proof_checksum === null)) {
    context.addIssue({ code: 'custom', path: ['terminal_proof_at'], message: 'Terminal proof time and checksum must appear together' })
  }
  if (value.state === 'released' && value.terminal_proof_checksum === null) {
    context.addIssue({ code: 'custom', path: ['terminal_proof_checksum'], message: 'Released capacity requires exact terminal proof' })
  }
  if (value.state === 'released' && value.open_quantity !== 0) {
    context.addIssue({ code: 'custom', path: ['open_quantity'], message: 'Released capacity cannot retain open exposure' })
  }
  if (value.state !== 'released' && value.terminal_proof_checksum !== null) {
    context.addIssue({ code: 'custom', path: ['terminal_proof_checksum'], message: 'Terminal release proof belongs only to released capacity' })
  }
})

export const optionsReservationReleaseProofSchema = z.object({
  proof_schema_version: z.literal(OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION),
  proof_id: identifierSchema,
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  provider_snapshot_checksum: sha256Schema,
  provider_order_ids: z.array(identifierSchema),
  open_position_quantity: z.literal(0),
  working_order_count: z.literal(0),
  delivery_state: z.enum(['not-sent', 'terminal-flat']),
  proven_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (new Set(value.provider_order_ids).size !== value.provider_order_ids.length) {
    context.addIssue({ code: 'custom', path: ['provider_order_ids'], message: 'Provider order IDs must be unique' })
  }
  if (value.delivery_state === 'not-sent' && value.provider_order_ids.length > 0) {
    context.addIssue({ code: 'custom', path: ['provider_order_ids'], message: 'A not-sent proof cannot identify provider orders' })
  }
})

export const optionsProviderPreviewSchema = z.object({
  preview_schema_version: z.literal(OPTIONS_PROVIDER_PREVIEW_SCHEMA_VERSION),
  preview_id: identifierSchema,
  provider_request_id: identifierSchema,
  provider_response_id: identifierSchema,
  adapter_id: identifierSchema,
  adapter_version: z.string().min(1),
  provider_contract_version: z.string().min(1),
  environment: z.enum(['paper', 'sandbox']),
  credential_generation: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  route_checksum: sha256Schema,
  decision_checksum: sha256Schema,
  reservation_checksum: sha256Schema,
  mandate_checksum: sha256Schema,
  side: z.literal('buy'),
  position_intent: z.literal('BUY_TO_OPEN'),
  order_type: z.literal('limit'),
  limit_price: positiveDecimalStringSchema,
  quantity: positiveIntegerSchema,
  time_in_force: z.literal('day'),
  provider_request_checksum: sha256Schema,
  estimated_debit: positiveDecimalStringSchema,
  estimated_fees: nonnegativeDecimalStringSchema,
  buying_power_impact: positiveDecimalStringSchema,
  warnings: z.array(z.string().min(1)),
  rejects: z.array(z.string().min(1)),
  option_permission: z.enum(['approved', 'denied', 'unknown']),
  provider_timestamp: utcTimestampSchema,
  received_at: utcTimestampSchema,
  max_age_ms: positiveIntegerSchema,
  result: z.enum(['approved', 'rejected', 'unknown']),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.result === 'approved' && (value.rejects.length > 0 || value.option_permission !== 'approved')) {
    context.addIssue({ code: 'custom', path: ['result'], message: 'Approved previews cannot contain rejects or missing permission' })
  }
  if (compareDecimals(value.buying_power_impact, addDecimals(value.estimated_debit, value.estimated_fees)) !== 0) {
    context.addIssue({ code: 'custom', path: ['buying_power_impact'], message: 'Buying-power impact must equal estimated debit plus fees' })
  }
})

export const optionsOrderIntentSchema = z.object({
  intent_schema_version: z.literal(OPTIONS_ORDER_INTENT_SCHEMA_VERSION),
  intent_id: identifierSchema,
  source_id: identifierSchema,
  source_checksum: sha256Schema,
  decision_checksum: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  contract_checksum: sha256Schema,
  provider_instrument_id: identifierSchema,
  action: z.literal('BUY_TO_OPEN'),
  order_type: z.literal('limit'),
  limit_price: positiveDecimalStringSchema,
  quantity: positiveIntegerSchema,
  time_in_force: z.literal('day'),
  regular_hours_only: z.literal(true),
  planned_maximum_debit: positiveDecimalStringSchema,
  estimated_fees: nonnegativeDecimalStringSchema,
  policy_checksum: sha256Schema,
  mandate_checksum: sha256Schema,
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  preview_checksum: sha256Schema,
  valid_until: utcTimestampSchema,
  provider_client_order_id: identifierSchema,
  idempotency_checksum: sha256Schema,
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.valid_until) <= Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Intent must remain valid after creation' })
  }
  if (compareDecimals(value.planned_maximum_debit, expectedDebit(value.limit_price, value.quantity, value.estimated_fees)) !== 0) {
    context.addIssue({ code: 'custom', path: ['planned_maximum_debit'], message: 'Planned debit does not match limit, quantity, multiplier, and fees' })
  }
})

export const optionsExecutionCommandSchema = z.object({
  command_schema_version: z.literal(OPTIONS_EXECUTION_COMMAND_SCHEMA_VERSION),
  command_id: identifierSchema,
  intent_id: identifierSchema,
  intent_checksum: sha256Schema,
  source_checksum: sha256Schema,
  contract_checksum: sha256Schema,
  quote_checksum: sha256Schema,
  decision_checksum: sha256Schema,
  policy_checksum: sha256Schema,
  mandate_checksum: sha256Schema,
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  preview_checksum: sha256Schema,
  adapter_id: identifierSchema,
  adapter_version: z.string().min(1),
  provider_contract_version: z.string().min(1),
  adapter_checksum: sha256Schema,
  credential_generation: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  provider_instrument_id: identifierSchema,
  action: z.literal('BUY_TO_OPEN'),
  order_type: z.literal('limit'),
  limit_price: positiveDecimalStringSchema,
  quantity: positiveIntegerSchema,
  time_in_force: z.literal('day'),
  regular_hours_only: z.literal(true),
  provider_client_order_id: identifierSchema,
  provider_request_checksum: sha256Schema,
  valid_until: utcTimestampSchema,
  prepared_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.valid_until) <= Date.parse(value.prepared_at)) {
    context.addIssue({ code: 'custom', path: ['valid_until'], message: 'Command must remain valid after preparation' })
  }
})

export const optionsExecutionRecordSchema = z.object({
  record_schema_version: z.literal(OPTIONS_EXECUTION_RECORD_SCHEMA_VERSION),
  record_id: identifierSchema,
  command_id: identifierSchema,
  command_checksum: sha256Schema,
  intent_id: identifierSchema,
  intent_checksum: sha256Schema,
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  provider_client_order_id: identifierSchema,
  state: z.enum(['prepared', 'submitting', 'working', 'partially-filled', 'open-position', 'not-sent', 'canceled-flat', 'closed-flat', 'submit-unknown', 'halted']),
  provider_order_id: identifierSchema.nullable(),
  requested_quantity: positiveIntegerSchema,
  filled_quantity: nonnegativeIntegerSchema,
  open_quantity: nonnegativeIntegerSchema,
  average_fill_price: positiveDecimalStringSchema.nullable(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  submitted_at: utcTimestampSchema.nullable(),
  reconciled_at: utcTimestampSchema.nullable(),
  failure_code: identifierSchema.nullable(),
  recovery_evidence: z.array(z.string().min(1)),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.filled_quantity > value.requested_quantity || value.open_quantity > value.filled_quantity) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Execution quantities are inconsistent' })
  }
  if ((value.filled_quantity > 0) !== (value.average_fill_price !== null)) {
    context.addIssue({ code: 'custom', path: ['average_fill_price'], message: 'Fill quantity and average price must appear together' })
  }
  if (value.state === 'prepared' && (value.submitted_at !== null || value.provider_order_id !== null || value.filled_quantity !== 0)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'Prepared execution cannot claim provider delivery' })
  }
  if (value.state !== 'prepared' && value.submitted_at === null) {
    context.addIssue({ code: 'custom', path: ['submitted_at'], message: 'Post-send states require a submitted timestamp' })
  }
  if ((value.state === 'working' || value.state === 'partially-filled' || value.state === 'open-position' || value.state === 'canceled-flat')
    && value.provider_order_id === null) {
    context.addIssue({ code: 'custom', path: ['provider_order_id'], message: 'Provider-confirmed states require the exact order ID' })
  }
  if (value.state === 'open-position' && value.open_quantity <= 0) {
    context.addIssue({ code: 'custom', path: ['open_quantity'], message: 'Open position requires owned quantity' })
  }
  if ((value.state === 'canceled-flat' || value.state === 'closed-flat') && value.open_quantity !== 0) {
    context.addIssue({ code: 'custom', path: ['open_quantity'], message: 'Flat terminal state cannot retain exposure' })
  }
  if (value.state === 'canceled-flat' && value.filled_quantity !== 0) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Canceled-flat state cannot retain confirmed fills' })
  }
  if (value.state === 'not-sent'
    && (value.provider_order_id !== null || value.filled_quantity !== 0 || value.open_quantity !== 0)) {
    context.addIssue({ code: 'custom', path: ['state'], message: 'No-send proof cannot claim an order, fill, or position' })
  }
  if (value.state === 'partially-filled'
    && (value.filled_quantity <= 0
      || value.filled_quantity >= value.requested_quantity
      || value.open_quantity !== value.filled_quantity)) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Partial-fill state requires exact owned partial exposure' })
  }
  if (value.state === 'working' && (value.filled_quantity !== 0 || value.open_quantity !== 0)) {
    context.addIssue({ code: 'custom', path: ['filled_quantity'], message: 'Working state cannot hide partial exposure' })
  }
  if ((value.state === 'submit-unknown' || value.state === 'halted') && value.failure_code === null) {
    context.addIssue({ code: 'custom', path: ['failure_code'], message: 'Unknown or halted execution requires a failure code' })
  }
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Execution record chronology is invalid' })
  }
  if (value.submitted_at !== null && Date.parse(value.submitted_at) < Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['submitted_at'], message: 'Submission cannot predate record creation' })
  }
  if (value.reconciled_at !== null
    && (value.submitted_at === null || Date.parse(value.reconciled_at) < Date.parse(value.submitted_at))) {
    context.addIssue({ code: 'custom', path: ['reconciled_at'], message: 'Reconciliation cannot predate submission' })
  }
})

export const optionsManagementCommandSchema = z.object({
  command_schema_version: z.literal(OPTIONS_MANAGEMENT_COMMAND_SCHEMA_VERSION),
  command_id: identifierSchema,
  entry_intent_id: identifierSchema,
  entry_record_checksum: sha256Schema,
  entry_command_checksum: sha256Schema,
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  provider_instrument_id: identifierSchema,
  action: z.enum(['cancel-entry', 'close-position']),
  reason: z.enum(['operator', 'signal-no-fill', 'signal-exit', 'expiration-custody']),
  expected_entry_order_id: identifierSchema,
  expected_open_quantity: nonnegativeIntegerSchema,
  close_quantity: positiveIntegerSchema.nullable(),
  limit_price: positiveDecimalStringSchema.nullable(),
  provider_client_order_id: identifierSchema.nullable(),
  prepared_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  const closing = value.action === 'close-position'
  if (closing !== (value.close_quantity !== null && value.limit_price !== null && value.provider_client_order_id !== null)) {
    context.addIssue({ code: 'custom', path: ['close_quantity'], message: 'Close commands require one exact quantity, limit, and provider client ID' })
  }
  if (closing && (value.expected_open_quantity <= 0 || value.close_quantity! > value.expected_open_quantity)) {
    context.addIssue({ code: 'custom', path: ['close_quantity'], message: 'Close quantity cannot exceed exact owned exposure' })
  }
})

export const optionsManagementRecordSchema = z.object({
  record_schema_version: z.literal(OPTIONS_MANAGEMENT_RECORD_SCHEMA_VERSION),
  management_id: identifierSchema,
  command_id: identifierSchema,
  command_checksum: sha256Schema,
  entry_intent_id: identifierSchema,
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  state: z.enum(['prepared', 'cancel-unknown', 'entry-canceled', 'position-open', 'close-unknown', 'close-working', 'close-canceled', 'partially-closed', 'partial-close-canceled', 'closed-flat', 'halted']),
  provider_close_order_id: identifierSchema.nullable(),
  provider_client_order_id: identifierSchema.nullable(),
  before_open_quantity: nonnegativeIntegerSchema,
  requested_close_quantity: nonnegativeIntegerSchema,
  closed_quantity: nonnegativeIntegerSchema,
  remaining_open_quantity: nonnegativeIntegerSchema,
  failure_code: identifierSchema.nullable(),
  evidence: z.array(z.string().min(1)),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.closed_quantity > value.requested_close_quantity
    || value.remaining_open_quantity + value.closed_quantity !== value.before_open_quantity) {
    context.addIssue({ code: 'custom', path: ['closed_quantity'], message: 'Management quantities do not conserve exact owned exposure' })
  }
  if (value.state === 'closed-flat' && value.remaining_open_quantity !== 0) {
    context.addIssue({ code: 'custom', path: ['remaining_open_quantity'], message: 'Closed-flat management cannot retain exposure' })
  }
  if ((value.state === 'cancel-unknown' || value.state === 'close-unknown' || value.state === 'halted') && value.failure_code === null) {
    context.addIssue({ code: 'custom', path: ['failure_code'], message: 'Unknown or halted management requires a failure code' })
  }
  if (Date.parse(value.updated_at) < Date.parse(value.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Management chronology is invalid' })
  }
})

export const optionsDiscordFollowupResolutionStrategySchema = z.enum([
  'reply-entry',
  'reply-followup',
  'single-thread-trade',
  'single-channel-trade',
])

export const optionsDiscordFollowupLogicalActionSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('cancel-entry'),
    reason: z.literal('signal-exit'),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    operation: z.literal('close-position'),
    quantity: z.union([z.literal('all'), positiveIntegerSchema]).nullable(),
    fraction: z.object({ numerator: positiveIntegerSchema, denominator: positiveIntegerSchema }).strict().nullable(),
    source_phrase: z.string().trim().min(1).max(500),
  }).strict().superRefine((value, context) => {
    if ((value.quantity === null) === (value.fraction === null)) {
      context.addIssue({ code: 'custom', path: ['quantity'], message: 'Close action requires one exact quantity or fraction' })
    }
    if (value.fraction && value.fraction.numerator >= value.fraction.denominator) {
      context.addIssue({ code: 'custom', path: ['fraction'], message: 'Close fraction must be a proper fraction' })
    }
  }),
])

export const optionsDiscordFollowupActionReceiptSchema = z.object({
  index: z.number().int().nonnegative().max(20),
  logical_action: optionsDiscordFollowupLogicalActionSchema,
  status: z.enum(['pending', 'executing', 'completed', 'failed']),
  management_id: identifierSchema.optional(),
  management_record_checksum: sha256Schema.optional(),
  completed_at: utcTimestampSchema.optional(),
  evidence: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
  error: z.string().trim().min(1).max(1_000).optional(),
}).strict().superRefine((action, context) => {
  if (action.status === 'completed' && !action.completed_at) {
    context.addIssue({ code: 'custom', path: ['completed_at'], message: 'Completed follow-up actions require a completion timestamp' })
  }
  if (action.status === 'completed' && !action.evidence?.length) {
    context.addIssue({ code: 'custom', path: ['evidence'], message: 'Completed follow-up actions require durable evidence' })
  }
  if ((action.status === 'executing' || action.status === 'completed') && !action.management_id
    && !(action.logical_action.operation === 'close-position' && action.logical_action.quantity === 'all' && action.status === 'completed')) {
    context.addIssue({ code: 'custom', path: ['management_id'], message: 'Issued follow-up actions require their exact durable management identity unless no close was needed' })
  }
  if (action.status === 'completed' && action.management_id && !action.management_record_checksum) {
    context.addIssue({ code: 'custom', path: ['management_record_checksum'], message: 'Completed follow-up actions require the latest durable management checksum' })
  }
  if (action.status === 'failed' && !action.error) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'Failed follow-up actions require an error' })
  }
})

export const optionsDiscordFollowupReceiptSchema = z.object({
  followup_receipt_schema_version: z.literal(OPTIONS_DISCORD_FOLLOWUP_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  source_message: discordManagementMessageSchema,
  resolution_strategy: optionsDiscordFollowupResolutionStrategySchema.optional(),
  candidate_intent_ids: z.array(identifierSchema).max(100),
  resolved_intent_id: identifierSchema.optional(),
  status: z.enum(['blocked', 'prepared', 'executing', 'completed', 'failed']),
  actions: z.array(optionsDiscordFollowupActionReceiptSchema).max(20),
  evidence: z.array(z.string().trim().min(1).max(500)).max(100),
  error: z.string().trim().min(1).max(1_000).optional(),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((receipt, context) => {
  if ((receipt.status === 'prepared' || receipt.status === 'executing' || receipt.status === 'completed') && !receipt.resolved_intent_id) {
    context.addIssue({ code: 'custom', path: ['resolved_intent_id'], message: 'Actionable options follow-up receipts require a resolved intent' })
  }
  if ((receipt.status === 'blocked' || receipt.status === 'failed') && !receipt.error) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'Blocked and failed follow-up receipts require an error' })
  }
  if (receipt.status === 'completed' && receipt.actions.some((action) => action.status !== 'completed')) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'A completed options follow-up receipt requires every action to be completed' })
  }
  if (Date.parse(receipt.updated_at) < Date.parse(receipt.created_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Follow-up receipt chronology is invalid' })
  }
  if (receipt.actions.some((action, index) => action.index !== index)) {
    context.addIssue({ code: 'custom', path: ['actions'], message: 'Follow-up action indices must be unique and sequential' })
  }
})

export const optionsExpirationScheduleSchema = z.object({
  schedule_schema_version: z.literal(OPTIONS_EXPIRATION_SCHEDULE_SCHEMA_VERSION),
  schedule_id: identifierSchema,
  provider: optionsProviderSchema,
  environment: z.enum(['paper', 'sandbox']),
  connection_id: identifierSchema,
  account_id: identifierSchema,
  canonical_contract_id: identifierSchema,
  expiration: dateSchema,
  provider_calendar_checksum: sha256Schema,
  account_exercise_setting_checksum: sha256Schema,
  automatic_close_start_at: utcTimestampSchema,
  operator_escalation_at: utcTimestampSchema,
  broker_order_cutoff_at: utcTimestampSchema,
  regular_close_at: utcTimestampSchema,
  exercise_instruction_cutoff_at: utcTimestampSchema,
  do_not_exercise_mode: z.enum(['provider-supported', 'manual-required']),
  source: z.string().min(1).max(240),
  captured_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  const times = [value.automatic_close_start_at, value.operator_escalation_at, value.broker_order_cutoff_at, value.regular_close_at, value.exercise_instruction_cutoff_at].map(Date.parse)
  if (!(times[0]! < times[1]! && times[1]! <= times[2]! && times[2]! <= times[3]! && times[3]! <= times[4]!)) {
    context.addIssue({ code: 'custom', path: ['automatic_close_start_at'], message: 'Expiration custody deadlines are not in safe order' })
  }
  if (!value.regular_close_at.startsWith(`${value.expiration}T`)) {
    context.addIssue({ code: 'custom', path: ['regular_close_at'], message: 'Regular close must occur on the exact expiration date' })
  }
})

export const optionsExpirationAssessmentSchema = z.object({
  assessment_schema_version: z.literal(OPTIONS_EXPIRATION_ASSESSMENT_SCHEMA_VERSION),
  assessment_id: identifierSchema,
  entry_intent_id: identifierSchema,
  entry_record_checksum: sha256Schema,
  schedule_checksum: sha256Schema,
  open_quantity: nonnegativeIntegerSchema,
  state: z.enum(['monitoring', 'close-due', 'operator-escalation', 'manual-do-not-exercise-required', 'provider-do-not-exercise-required', 'resolved-flat', 'custody-halted']),
  next_deadline_at: utcTimestampSchema.nullable(),
  automatic_close_allowed: z.boolean(),
  operator_action_required: z.boolean(),
  assessed_at: utcTimestampSchema,
  detail: z.string().min(1).max(300),
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.state === 'resolved-flat' && value.open_quantity !== 0) context.addIssue({ code: 'custom', path: ['open_quantity'], message: 'Resolved custody must be flat' })
  if (value.automatic_close_allowed && value.state !== 'close-due') context.addIssue({ code: 'custom', path: ['automatic_close_allowed'], message: 'Automatic close authority exists only during the certified close window' })
})

export const optionsManualOrderReviewSchema = z.object({
  review_schema_version: z.literal(OPTIONS_MANUAL_ORDER_REVIEW_SCHEMA_VERSION),
  review_id: identifierSchema,
  source: optionsManualOrderSourceSchema,
  connection_checksum: sha256Schema,
  authority_id: identifierSchema,
  authority_checksum: sha256Schema,
  contract: optionContractIdentitySchema,
  quote: optionQuoteSnapshotSchema,
  policy: optionsEntryPolicySchema,
  decision: optionsEntryDecisionSchema,
  reservation: optionsDebitReservationSchema,
  preview: optionsProviderPreviewSchema,
  prepared_at: utcTimestampSchema,
  expires_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expires_at) <= Date.parse(value.prepared_at)
    || value.expires_at !== value.source.valid_until
    || value.expires_at !== value.decision.valid_until
    || value.expires_at !== value.reservation.expires_at) {
    context.addIssue({ code: 'custom', path: ['expires_at'], message: 'Manual review expiry must bind all entry evidence' })
  }
  if (value.source.authority_id !== value.authority_id
    || value.source.authority_checksum !== value.authority_checksum
    || value.source.connection_id !== value.policy.connection_id
    || value.source.account_id !== value.policy.account_id
    || value.source.canonical_contract_id !== value.contract.canonical_id
    || value.decision.signal_checksum !== value.source.content_checksum
    || value.decision.contract_checksum !== value.contract.content_checksum
    || value.decision.quote_checksum !== value.quote.content_checksum
    || value.decision.policy_checksum !== value.policy.content_checksum
    || value.reservation.intent_id !== value.decision.decision_id
    || value.preview.decision_checksum !== value.decision.content_checksum
    || value.preview.reservation_checksum !== value.reservation.content_checksum) {
    context.addIssue({ code: 'custom', path: ['review_id'], message: 'Manual review evidence is not one exact order' })
  }
})

const optionsFillSchema = z.object({
  fill_id: identifierSchema,
  quantity: positiveIntegerSchema,
  price: positiveDecimalStringSchema,
  fee: nonnegativeDecimalStringSchema,
  filled_at: utcTimestampSchema,
}).strict()

export const optionsExecutionReceiptSchema = z.object({
  receipt_schema_version: z.literal(OPTIONS_EXECUTION_RECEIPT_SCHEMA_VERSION),
  receipt_id: identifierSchema,
  intent_id: identifierSchema,
  source_checksum: sha256Schema,
  contract_checksum: sha256Schema,
  quote_checksum: sha256Schema,
  decision_checksum: sha256Schema,
  intent_checksum: sha256Schema,
  command_checksum: sha256Schema,
  adapter_checksum: sha256Schema,
  preview_checksum: sha256Schema.nullable(),
  reservation_id: identifierSchema,
  reservation_checksum: sha256Schema,
  reservation_state: z.enum(['prepared', 'submitting', 'working', 'partially-filled', 'submit-unknown', 'open-position', 'releasing', 'released', 'halted']),
  provider_order_id: identifierSchema,
  provider_client_order_id: identifierSchema,
  submitted_at: utcTimestampSchema,
  acknowledged_at: utcTimestampSchema.optional(),
  filled_at: utcTimestampSchema.optional(),
  canceled_at: utcTimestampSchema.nullable(),
  reconciled_at: utcTimestampSchema,
  requested_quantity: positiveIntegerSchema,
  cumulative_fill_quantity: nonnegativeIntegerSchema,
  remaining_quantity: nonnegativeIntegerSchema,
  fills: z.array(optionsFillSchema),
  average_fill_price: positiveDecimalStringSchema.optional(),
  actual_debit: nonnegativeDecimalStringSchema,
  final_order_status: z.enum(['working', 'partially-filled', 'filled', 'canceled', 'partially-filled-canceled', 'rejected', 'unknown']),
  owned_position_quantity: nonnegativeIntegerSchema,
  recovery_evidence: z.array(z.string().min(1)),
  preview_unavailable_reason: z.string().min(1).nullable(),
  failure_code: identifierSchema.nullable(),
  result: z.enum(['working', 'active', 'flat', 'rejected', 'halted']),
  created_at: utcTimestampSchema,
  updated_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  const fillQuantity = value.fills.reduce((sum, fill) => sum + fill.quantity, 0)
  if (fillQuantity !== value.cumulative_fill_quantity) {
    context.addIssue({ code: 'custom', path: ['fills'], message: 'Fill quantities must equal cumulative fill quantity' })
  }
  if (value.cumulative_fill_quantity + value.remaining_quantity !== value.requested_quantity) {
    context.addIssue({ code: 'custom', path: ['remaining_quantity'], message: 'Filled and remaining quantities must equal requested quantity' })
  }
  if (value.cumulative_fill_quantity > 0 && value.average_fill_price === undefined) {
    context.addIssue({ code: 'custom', path: ['average_fill_price'], message: 'Filled receipts require an average fill price' })
  }
  if ((value.preview_checksum === null) === (value.preview_unavailable_reason === null)) {
    context.addIssue({ code: 'custom', path: ['preview_checksum'], message: 'Receipt requires either preview evidence or one unavailable reason' })
  }
  if (value.final_order_status === 'filled' && value.remaining_quantity !== 0) {
    context.addIssue({ code: 'custom', path: ['remaining_quantity'], message: 'Filled orders cannot have remaining quantity' })
  }
  const actualDebit = value.fills.reduce(
    (sum, fill) => addDecimals(sum, expectedDebit(fill.price, fill.quantity, fill.fee)),
    '0',
  )
  if (compareDecimals(value.actual_debit, actualDebit) !== 0) {
    context.addIssue({ code: 'custom', path: ['actual_debit'], message: 'Actual debit must equal exact fills plus fees' })
  }
  for (const [index, fill] of value.fills.entries()) {
    if (Date.parse(fill.filled_at) < Date.parse(value.submitted_at)) {
      context.addIssue({ code: 'custom', path: ['fills', index, 'filled_at'], message: 'A fill cannot precede submission' })
    }
  }
  if (value.filled_at && Date.parse(value.filled_at) < Date.parse(value.submitted_at)) {
    context.addIssue({ code: 'custom', path: ['filled_at'], message: 'Filled time cannot precede submission' })
  }
  if ((value.final_order_status === 'canceled' || value.final_order_status === 'partially-filled-canceled') && value.canceled_at === null) {
    context.addIssue({ code: 'custom', path: ['canceled_at'], message: 'Canceled orders require a cancellation timestamp' })
  }
  if (Date.parse(value.updated_at) < Date.parse(value.created_at) || Date.parse(value.reconciled_at) < Date.parse(value.submitted_at)) {
    context.addIssue({ code: 'custom', path: ['updated_at'], message: 'Receipt chronology is invalid' })
  }
})

export const optionsAutomationPlanSchema = z.object({
  plan_schema_version: z.literal(OPTIONS_AUTOMATION_PLAN_SCHEMA_VERSION),
  plan_id: identifierSchema,
  receipt_id: identifierSchema,
  raw_content_checksum: sha256Schema,
  signal: discordOptionsSignalSchema,
  route: optionsAutomationRouteSchema,
  connection: optionsConnectionSchema,
  policy: optionsEntryPolicySchema,
  authority: optionsAutopilotAuthoritySchema,
  contract: optionContractIdentitySchema,
  quote: optionQuoteSnapshotSchema,
  decision: optionsEntryDecisionSchema,
  reservation: optionsDebitReservationSchema,
  created_at: utcTimestampSchema,
  content_checksum: sha256Schema,
}).strict().superRefine((value, context) => {
  if (value.plan_id !== value.receipt_id
    || value.signal.provenance.content_sha256 !== value.raw_content_checksum
    || value.signal.provenance.guild_id !== value.route.guild_id
    || value.signal.provenance.channel_id !== value.route.channel_id
    || value.signal.provenance.thread_id !== value.route.thread_id
    || value.signal.provenance.author_id !== value.route.author_id
    || value.route.connection_id !== value.connection.connection_id
    || value.route.connection_checksum !== value.connection.content_checksum
    || value.route.policy_id !== value.policy.policy_id
    || value.route.policy_revision !== value.policy.revision
    || value.route.policy_checksum !== value.policy.content_checksum
    || value.authority.route_checksum !== value.route.content_checksum
    || value.authority.policy_checksum !== value.policy.content_checksum
    || value.authority.connection_checksum !== value.connection.content_checksum
    || value.decision.signal_checksum !== value.signal.content_checksum
    || value.decision.contract_checksum !== value.contract.content_checksum
    || value.decision.quote_checksum !== value.quote.content_checksum
    || value.decision.policy_checksum !== value.policy.content_checksum
    || value.decision.route_checksum !== value.route.content_checksum
    || value.decision.account_checksum !== value.connection.content_checksum
    || value.reservation.intent_id !== value.decision.decision_id
    || value.reservation.contract_checksum !== value.contract.content_checksum
    || value.reservation.policy_checksum !== value.policy.content_checksum
    || value.reservation.mandate_checksum !== value.authority.content_checksum) {
    context.addIssue({ code: 'custom', path: ['content_checksum'], message: 'Automation plan lineage is not exact' })
  }
  if (value.decision.action !== 'marketable_limit' && value.decision.action !== 'passive_limit') {
    context.addIssue({ code: 'custom', path: ['decision', 'action'], message: 'Automation plans require an executable decision' })
  }
})

export type DiscordOptionsSignal = z.infer<typeof discordOptionsSignalSchema>
export type DiscordOptionsEntryInput = z.infer<typeof discordOptionsEntryInputSchema>
export type OptionContractIdentity = z.infer<typeof optionContractIdentitySchema>
export type OptionQuoteSnapshot = z.infer<typeof optionQuoteSnapshotSchema>
export type OptionsEntryPolicy = z.infer<typeof optionsEntryPolicySchema>
export type OptionsEntryDecision = z.infer<typeof optionsEntryDecisionSchema>
export type OptionsDebitReservation = z.infer<typeof optionsDebitReservationSchema>
export type OptionsProviderPreview = z.infer<typeof optionsProviderPreviewSchema>
export type OptionsOrderIntent = z.infer<typeof optionsOrderIntentSchema>
export type OptionsExecutionReceipt = z.infer<typeof optionsExecutionReceiptSchema>
export type OptionsReservationReleaseProof = z.infer<typeof optionsReservationReleaseProofSchema>
export type OptionsExecutionCommand = z.infer<typeof optionsExecutionCommandSchema>
export type OptionsExecutionRecord = z.infer<typeof optionsExecutionRecordSchema>
export type OptionsProvider = z.infer<typeof optionsProviderSchema>
export type OptionsConnection = z.infer<typeof optionsConnectionSchema>
export type OptionsProviderReadProof = z.infer<typeof optionsProviderReadProofSchema>
export type OptionsCertificationScenario = z.infer<typeof optionsCertificationScenarioSchema>
export type OptionsCertificationEvidence = z.infer<typeof optionsCertificationEvidenceSchema>
export type OptionsCertificationApplication = z.infer<typeof optionsCertificationApplicationSchema>
export type OptionsManualPaperAuthority = z.infer<typeof optionsManualPaperAuthoritySchema>
export type OptionsAuthorityRevocation = z.infer<typeof optionsAuthorityRevocationSchema>
export type OptionsDiscordFollowupResolutionStrategy = z.infer<typeof optionsDiscordFollowupResolutionStrategySchema>
export type OptionsDiscordFollowupLogicalAction = z.infer<typeof optionsDiscordFollowupLogicalActionSchema>
export type OptionsDiscordFollowupActionReceipt = z.infer<typeof optionsDiscordFollowupActionReceiptSchema>
export type OptionsDiscordFollowupReceipt = z.infer<typeof optionsDiscordFollowupReceiptSchema>
export type OptionsManualOrderSource = z.infer<typeof optionsManualOrderSourceSchema>
export type OptionsManualOrderReview = z.infer<typeof optionsManualOrderReviewSchema>
export type OptionsAutomationRoute = z.infer<typeof optionsAutomationRouteSchema>
export type OptionsAutopilotAuthority = z.infer<typeof optionsAutopilotAuthoritySchema>
export type OptionsAutopilotRevocation = z.infer<typeof optionsAutopilotRevocationSchema>
export type OptionsAutopilotCertificationScenario = z.infer<typeof optionsAutopilotCertificationScenarioSchema>
export type OptionsAutopilotCertificationEvidence = z.infer<typeof optionsAutopilotCertificationEvidenceSchema>
export type OptionsAutomationReceipt = z.infer<typeof optionsAutomationReceiptSchema>
export type OptionsAutomationPlan = z.infer<typeof optionsAutomationPlanSchema>
export type OptionsManagementCommand = z.infer<typeof optionsManagementCommandSchema>
export type OptionsManagementRecord = z.infer<typeof optionsManagementRecordSchema>
export type OptionsExpirationSchedule = z.infer<typeof optionsExpirationScheduleSchema>
export type OptionsExpirationAssessment = z.infer<typeof optionsExpirationAssessmentSchema>
