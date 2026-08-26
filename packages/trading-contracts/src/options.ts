import { z } from 'zod'

import {
  decimalStringSchema,
  identifierSchema,
  positiveDecimalStringSchema,
  sha256Schema,
  utcTimestampSchema,
} from './common.ts'

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
export const OPTIONS_CERTIFICATION_EVIDENCE_SCHEMA_VERSION = 'options-certification-evidence@1' as const

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
  environment: z.enum(['paper', 'live']),
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
  environment: z.literal('paper'),
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
  environment: z.literal('paper'),
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
  state: z.enum(['prepared', 'submitting', 'working', 'partially-filled', 'open-position', 'not-sent', 'canceled-flat', 'submit-unknown', 'halted']),
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
  if (value.state === 'canceled-flat' && value.open_quantity !== 0) {
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

export type DiscordOptionsSignal = z.infer<typeof discordOptionsSignalSchema>
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
