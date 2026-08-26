import { describe, expect, test } from 'bun:test'

import {
  discoTraderPushPayloadSchema,
  DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  OPTIONS_DEBIT_RESERVATION_SCHEMA_VERSION,
  OPTIONS_ENTRY_DECISION_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  OPTIONS_EXECUTION_RECEIPT_SCHEMA_VERSION,
  OPTIONS_ORDER_INTENT_SCHEMA_VERSION,
  OPTIONS_PROVIDER_PREVIEW_SCHEMA_VERSION,
  discordOptionsSignalSchema,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  optionsDebitReservationSchema,
  optionsEntryDecisionSchema,
  optionsEntryPolicySchema,
  optionsExecutionReceiptSchema,
  optionsOrderIntentSchema,
  optionsProviderPreviewSchema,
} from '../src/index.ts'

const checksum = 'a'.repeat(64)
const checksumB = 'b'.repeat(64)
const now = '2026-08-26T15:00:00.000Z'

const signal = {
  signal_schema_version: DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  signal_id: 'discord-option-signal-1',
  provenance: {
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    message_id: 'message-1',
    author_id: 'trader-1',
    thread_id: null,
    reply_to_message_id: null,
    posted_at: now,
    received_at: '2026-08-26T15:00:01.000Z',
    content_sha256: checksum,
  },
  raw_text: 'BTO SPY 650C 9/18 at 1.25-1.30',
  action: 'buy_to_open',
  strategy: 'single-leg',
  underlying: 'SPY',
  expiration: '2026-09-18',
  strike: '650',
  right: 'call',
  reference_entry: '1.30',
  reference_kind: 'entry_range',
  reference_range: { low: '1.25', high: '1.30' },
  content_checksum: checksumB,
} as const

const contract = {
  contract_schema_version: OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  canonical_id: 'USOPT:SPY:2026-09-18:C:650',
  underlying: 'SPY',
  expiration: '2026-09-18',
  strike: '650',
  right: 'call',
  currency: 'USD',
  asset_class: 'US_ETF_OPTION',
  multiplier: 100,
  standard_deliverable: true,
  provider: 'fake-options',
  provider_instrument_id: 'fake-spy-20260918-c-650',
  provider_symbol: 'SPY260918C00650000',
  listing_eligible: true,
  smart_routing_eligible: true,
  minimum_tick: '0.01',
  increment_bands: [{ minimum_price: '0', increment: '0.01' }],
  resolved_at: now,
  content_checksum: checksum,
} as const

const quote = {
  quote_schema_version: OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  quote_id: 'quote-1',
  connection_id: 'connection-options-paper',
  account_id: 'account-options-paper',
  canonical_contract_id: contract.canonical_id,
  provider_instrument_id: contract.provider_instrument_id,
  environment: 'paper',
  market_data_mode: 'realtime',
  bid: '1.27',
  ask: '1.30',
  bid_size: 30,
  ask_size: 22,
  provider_timestamp: now,
  received_at: '2026-08-26T15:00:00.100Z',
  decision_at: '2026-08-26T15:00:00.150Z',
  quote_age_ms: 50,
  delayed: false,
  indicative: false,
  halted: false,
  minimum_tick: '0.01',
  provenance: 'fake-options:fixture-v1',
  content_checksum: checksumB,
} as const

const policy = {
  policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  policy_id: 'options-policy-paper-v1',
  revision: 1,
  max_signal_age_ms: 30_000,
  max_ingest_delay_ms: 10_000,
  regular_session_only: true,
  entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' },
  allowed_weekdays: [1, 2, 3, 4, 5],
  min_days_to_expiration: 1,
  max_days_to_expiration: 60,
  max_quote_age_ms: 1_000,
  min_bid_size: 1,
  min_ask_size: 1,
  max_spread_abs: '0.10',
  max_spread_pct: '10',
  spread_gate_mode: 'both',
  max_chase_abs: '0.10',
  max_chase_pct: '8',
  max_favorable_retrace_pct: '20',
  tight_spread_action: 'marketable_limit',
  wide_spread_action: 'passive_limit',
  passive_limit_offset_abs: '0.03',
  working_order_ttl_ms: 15_000,
  max_reprice_attempts: 0,
  reprice_interval_ms: 1_000,
  cancel_at_signal_expiry: true,
  sizing: { mode: 'fixed_contracts', fixed_contracts: 1 },
  max_contracts_per_order: 1,
  max_debit_per_trade: '150',
  max_aggregate_open_debit: '500',
  max_daily_debit_initiated: '500',
  max_open_positions: 1,
  max_active_positions_per_source: 1,
  source_quantity_behavior: 'ignore',
  duplicate_contract_policy: 'block',
  expiration_custody: {
    provider_calendar_checksum: checksum,
    account_exercise_setting_checksum: checksumB,
    no_new_entry_minutes_before_close: 60,
    automatic_close_start_minutes_before_close: 45,
    operator_escalation_minutes_before_close: 30,
    do_not_exercise_mode: 'provider-supported',
    custody_certification_checksum: checksum,
  },
  environment: 'paper',
  provider_slug: 'fake-options',
  adapter_id: 'fake-options-adapter',
  required_certification: 'options-sandbox-entry-certified',
  certification_checksum: checksum,
  connection_id: 'connection-options-paper',
  account_id: 'account-options-paper',
  source_route_id: 'route-discord-options-paper',
  global_halt_required: true,
  account_halt_required: true,
  source_halt_required: true,
  mandate_expires_at: '2026-08-26T17:00:00.000Z',
  created_at: now,
  content_checksum: checksumB,
} as const

describe('options contracts', () => {
  test('accepts one signed options entry envelope and rejects missing message evidence', () => {
    const optionsEntry = {
      guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null, message_id: 'message-one', author_id: 'trader-one',
      reply_to_message_id: null, posted_at: '2026-08-26T14:59:50.000Z', received_at: '2026-08-26T14:59:51.000Z',
      raw_text: 'BUY SPY 2026-09-18 650C @ 1.25',
    }
    expect(discoTraderPushPayloadSchema.parse({ kind: 'options_entry', severity: 'info', summary: 'Options entry',
      options_entry: optionsEntry, at: optionsEntry.received_at }).options_entry).toEqual(optionsEntry)
    expect(() => discoTraderPushPayloadSchema.parse({ kind: 'options_entry', severity: 'info', summary: 'Missing',
      at: optionsEntry.received_at })).toThrow()
  })
  test('accepts exact single-leg Discord evidence and rejects impossible chronology', () => {
    expect(discordOptionsSignalSchema.parse(signal).underlying).toBe('SPY')
    expect(discordOptionsSignalSchema.safeParse({
      ...signal,
      provenance: { ...signal.provenance, received_at: '2026-08-26T14:59:59.000Z' },
    }).success).toBe(false)
    expect(discordOptionsSignalSchema.safeParse({ ...signal, expiration: '2026-02-30' }).success).toBe(false)
  })

  test('rejects premium ranges whose high is below the low', () => {
    expect(discordOptionsSignalSchema.safeParse({
      ...signal,
      reference_range: { low: '1.30', high: '1.25' },
    }).success).toBe(false)
  })

  test('accepts one standard contract and rejects adjusted or nonstandard identity', () => {
    expect(optionContractIdentitySchema.parse(contract).multiplier).toBe(100)
    expect(optionContractIdentitySchema.safeParse({ ...contract, multiplier: 10 }).success).toBe(false)
    expect(optionContractIdentitySchema.safeParse({ ...contract, standard_deliverable: false }).success).toBe(false)
    expect(optionContractIdentitySchema.safeParse({ ...contract, canonical_id: 'USOPT:SPY:2026-09-18:P:650' }).success).toBe(false)
    expect(optionContractIdentitySchema.safeParse({ ...contract, minimum_tick: '0.05' }).success).toBe(false)
  })

  test('accepts a fresh realtime quote and rejects crossed or delayed evidence', () => {
    expect(optionQuoteSnapshotSchema.parse(quote).ask_size).toBe(22)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, environment: 'sandbox' }).success).toBe(true)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, environment: 'live' }).success).toBe(false)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, bid: '1.31' }).success).toBe(false)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, bid: '0' }).success).toBe(false)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, market_data_mode: 'delayed', delayed: true }).success).toBe(true)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, quote_age_ms: 49 }).success).toBe(false)
    expect(optionQuoteSnapshotSchema.safeParse({ ...quote, market_data_mode: 'delayed', delayed: false }).success).toBe(false)
  })

  test('requires the initial release to keep one open position per account', () => {
    expect(optionsEntryPolicySchema.parse(policy).max_open_positions).toBe(1)
    expect(optionsEntryPolicySchema.safeParse({ ...policy, max_open_positions: 2 }).success).toBe(false)
    expect(optionsEntryPolicySchema.safeParse({
      ...policy,
      sizing: { mode: 'max_debit_budget', max_debit_budget: '125' },
    }).success).toBe(true)
    expect(optionsEntryPolicySchema.safeParse({
      ...policy,
      sizing: { mode: 'fixed_contracts', fixed_contracts: 2 },
    }).success).toBe(false)
    expect(optionsEntryPolicySchema.safeParse({ ...policy, min_days_to_expiration: 0 }).success).toBe(false)
    expect(optionsEntryPolicySchema.safeParse({ ...policy, spread_gate_mode: 'either' }).success).toBe(false)
  })

  test('binds decision, reservation, preview, intent, and receipt evidence', () => {
    const decision = {
      decision_schema_version: OPTIONS_ENTRY_DECISION_SCHEMA_VERSION,
      decision_id: 'decision-1',
      signal_checksum: signal.content_checksum,
      route_checksum: checksum,
      account_checksum: checksumB,
      contract_checksum: contract.content_checksum,
      quote_checksum: quote.content_checksum,
      policy_checksum: policy.content_checksum,
      source_reference_price: '1.30',
      bid: quote.bid,
      ask: quote.ask,
      midpoint: '1.285',
      spread_abs: '0.03',
      spread_pct: '2.334630',
      unfavorable_drift_abs: '0',
      unfavorable_drift_pct: '0',
      favorable_retrace_pct: '0',
      absolute_chase_cap: '1.40',
      percentage_chase_cap: '1.404',
      effective_chase_cap: '1.40',
      action: 'marketable_limit',
      limit_price: '1.30',
      planned_quantity: 1,
      maximum_debit: '130.65',
      reason_codes: ['ELIGIBLE'],
      decided_at: now,
      valid_until: '2026-08-26T15:00:30.000Z',
      content_checksum: checksum,
    }
    expect(optionsEntryDecisionSchema.parse(decision).action).toBe('marketable_limit')

    const reservation = {
      reservation_schema_version: OPTIONS_DEBIT_RESERVATION_SCHEMA_VERSION,
      reservation_id: 'reservation-1',
      intent_id: 'options-intent-1',
      connection_id: policy.connection_id,
      account_id: policy.account_id,
      source_id: signal.signal_id,
      policy_id: policy.policy_id,
      policy_checksum: policy.content_checksum,
      mandate_id: 'mandate-1',
      mandate_checksum: checksum,
      canonical_contract_id: contract.canonical_id,
      contract_checksum: contract.content_checksum,
      reserved_contracts: 1,
      limit_price: '1.30',
      multiplier: 100,
      estimated_fees: '0.65',
      worst_case_debit: '130.65',
      account_capacity_snapshot_checksum: checksumB,
      active_reservation_set_checksum: checksum,
      admission_request_checksum: checksumB,
      state: 'prepared',
      filled_quantity: 0,
      open_quantity: 0,
      created_at: now,
      updated_at: now,
      expires_at: '2026-08-26T15:00:30.000Z',
      initiated_at: null,
      execution_record_checksum: null,
      terminal_proof_at: null,
      terminal_proof_checksum: null,
      content_checksum: checksumB,
    }
    expect(optionsDebitReservationSchema.parse(reservation).state).toBe('prepared')
    expect(optionsDebitReservationSchema.safeParse({ ...reservation, worst_case_debit: '1' }).success).toBe(false)
    expect(optionsDebitReservationSchema.safeParse({
      ...reservation,
      state: 'released',
      filled_quantity: 1,
      open_quantity: 1,
      terminal_proof_at: now,
      terminal_proof_checksum: checksum,
    }).success).toBe(false)

    const preview = {
      preview_schema_version: OPTIONS_PROVIDER_PREVIEW_SCHEMA_VERSION,
      preview_id: 'preview-1',
      provider_request_id: 'provider-preview-1',
      provider_response_id: 'provider-response-1',
      adapter_id: 'fake-options',
      adapter_version: '1.0.0',
      provider_contract_version: 'fake-options@1',
      environment: 'paper',
      credential_generation: 'f'.repeat(64),
      connection_id: policy.connection_id,
      account_id: policy.account_id,
      canonical_contract_id: contract.canonical_id,
      route_checksum: checksum,
      decision_checksum: decision.content_checksum,
      reservation_checksum: reservation.content_checksum,
      mandate_checksum: checksum,
      side: 'buy',
      position_intent: 'BUY_TO_OPEN',
      order_type: 'limit',
      limit_price: '1.30',
      quantity: 1,
      time_in_force: 'day',
      provider_request_checksum: checksumB,
      estimated_debit: '130',
      estimated_fees: '0.65',
      buying_power_impact: '130.65',
      warnings: [],
      rejects: [],
      option_permission: 'approved',
      provider_timestamp: now,
      received_at: now,
      max_age_ms: 5_000,
      result: 'approved',
      content_checksum: checksum,
    }
    expect(optionsProviderPreviewSchema.parse(preview).result).toBe('approved')
    expect(optionsProviderPreviewSchema.safeParse({ ...preview, buying_power_impact: '1' }).success).toBe(false)

    const intent = {
      intent_schema_version: OPTIONS_ORDER_INTENT_SCHEMA_VERSION,
      intent_id: reservation.intent_id,
      source_id: signal.signal_id,
      source_checksum: signal.content_checksum,
      decision_checksum: decision.content_checksum,
      connection_id: policy.connection_id,
      account_id: policy.account_id,
      canonical_contract_id: contract.canonical_id,
      contract_checksum: contract.content_checksum,
      provider_instrument_id: contract.provider_instrument_id,
      action: 'BUY_TO_OPEN',
      order_type: 'limit',
      limit_price: '1.30',
      quantity: 1,
      time_in_force: 'day',
      regular_hours_only: true,
      planned_maximum_debit: '130.65',
      estimated_fees: '0.65',
      policy_checksum: policy.content_checksum,
      mandate_checksum: checksum,
      reservation_id: reservation.reservation_id,
      reservation_checksum: reservation.content_checksum,
      preview_checksum: preview.content_checksum,
      valid_until: '2026-08-26T15:00:30.000Z',
      provider_client_order_id: 'tg-options-1',
      idempotency_checksum: checksumB,
      created_at: now,
      content_checksum: checksum,
    }
    expect(optionsOrderIntentSchema.parse(intent).action).toBe('BUY_TO_OPEN')
    expect(optionsOrderIntentSchema.safeParse({ ...intent, planned_maximum_debit: '1' }).success).toBe(false)

    const receipt = {
      receipt_schema_version: OPTIONS_EXECUTION_RECEIPT_SCHEMA_VERSION,
      receipt_id: 'options-receipt-1',
      intent_id: intent.intent_id,
      source_checksum: signal.content_checksum,
      contract_checksum: contract.content_checksum,
      quote_checksum: quote.content_checksum,
      decision_checksum: decision.content_checksum,
      intent_checksum: intent.content_checksum,
      command_checksum: checksum,
      adapter_checksum: checksumB,
      preview_checksum: preview.content_checksum,
      reservation_id: reservation.reservation_id,
      reservation_checksum: reservation.content_checksum,
      reservation_state: 'open-position',
      provider_order_id: 'fake-order-1',
      provider_client_order_id: intent.provider_client_order_id,
      submitted_at: now,
      acknowledged_at: now,
      filled_at: now,
      canceled_at: null,
      reconciled_at: now,
      requested_quantity: 1,
      cumulative_fill_quantity: 1,
      remaining_quantity: 0,
      fills: [{ fill_id: 'fill-1', quantity: 1, price: '1.30', fee: '0.65', filled_at: now }],
      average_fill_price: '1.30',
      actual_debit: '130.65',
      final_order_status: 'filled',
      owned_position_quantity: 1,
      recovery_evidence: [],
      preview_unavailable_reason: null,
      failure_code: null,
      result: 'active',
      created_at: now,
      updated_at: now,
      content_checksum: checksumB,
    }
    expect(optionsExecutionReceiptSchema.parse(receipt).result).toBe('active')
    expect(optionsExecutionReceiptSchema.safeParse({
      ...receipt,
      preview_checksum: null,
      preview_unavailable_reason: 'adapter-does-not-support-preview',
    }).success).toBe(true)
    expect(optionsExecutionReceiptSchema.safeParse({
      ...receipt,
      preview_checksum: null,
      preview_unavailable_reason: null,
    }).success).toBe(false)
    expect(optionsExecutionReceiptSchema.safeParse({ ...receipt, actual_debit: '1' }).success).toBe(false)
    expect(optionsExecutionReceiptSchema.safeParse({
      ...receipt,
      filled_at: '2026-08-26T14:59:59.000Z',
    }).success).toBe(false)
  })
})
