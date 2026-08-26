import { describe, expect, test } from 'bun:test'

import {
  DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  type DiscordOptionsSignal,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'

import { decideOptionsEntry, sha256 } from '../src/index.ts'

const checksum = 'a'.repeat(64)
const checksumB = 'b'.repeat(64)
const decisionAt = '2026-08-26T15:00:00.000Z'

const signal: DiscordOptionsSignal = {
  signal_schema_version: DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  signal_id: 'signal-policy-1',
  provenance: {
    guild_id: 'guild-options', channel_id: 'channel-options', message_id: 'message-policy-1',
    author_id: 'trader-options', thread_id: null, reply_to_message_id: null,
    posted_at: '2026-08-26T14:59:50.000Z', received_at: '2026-08-26T14:59:51.000Z',
    content_sha256: checksum,
  },
  raw_text: 'BUY SPY 2026-09-18 650C @ 1.25',
  action: 'buy_to_open', strategy: 'single-leg', underlying: 'SPY', expiration: '2026-09-18',
  strike: '650', right: 'call', reference_entry: '1.25', reference_kind: 'single_price',
  content_checksum: checksumB,
}

const contract: OptionContractIdentity = {
  contract_schema_version: OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  canonical_id: 'USOPT:SPY:2026-09-18:C:650', underlying: 'SPY', expiration: '2026-09-18',
  strike: '650', right: 'call', currency: 'USD', asset_class: 'US_ETF_OPTION', multiplier: 100,
  standard_deliverable: true, provider: 'fake-options', provider_instrument_id: 'fake-spy-c-650',
  provider_symbol: 'SPY260918C00650000', listing_eligible: true, smart_routing_eligible: true,
  minimum_tick: '0.01', increment_bands: [{ minimum_price: '0', increment: '0.01' }],
  resolved_at: '2026-08-26T14:59:59.000Z', content_checksum: checksum,
}

const quote = (overrides: Partial<OptionQuoteSnapshot> = {}): OptionQuoteSnapshot => ({
  quote_schema_version: OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  quote_id: 'quote-policy-1', connection_id: 'connection-options-paper', account_id: 'account-options-paper',
  canonical_contract_id: contract.canonical_id, provider_instrument_id: contract.provider_instrument_id,
  environment: 'paper', market_data_mode: 'realtime', bid: '1.27', ask: '1.30', bid_size: 30,
  ask_size: 22, provider_timestamp: '2026-08-26T14:59:59.900Z',
  received_at: '2026-08-26T14:59:59.950Z', decision_at: decisionAt, quote_age_ms: 50,
  delayed: false, indicative: false, halted: false, minimum_tick: '0.01',
  provenance: 'fake-options:policy-fixture', content_checksum: checksumB,
  ...overrides,
})

const policy: OptionsEntryPolicy = {
  policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  policy_id: 'options-policy-paper-v1', revision: 1, max_signal_age_ms: 30_000,
  max_ingest_delay_ms: 10_000, regular_session_only: true,
  entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' },
  allowed_weekdays: [1, 2, 3, 4, 5], min_days_to_expiration: 1, max_days_to_expiration: 60,
  max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1, max_spread_abs: '0.10',
  max_spread_pct: '10', spread_gate_mode: 'both', max_chase_abs: '0.10', max_chase_pct: '8',
  max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit',
  wide_spread_action: 'passive_limit', passive_limit_offset_abs: '0.03', working_order_ttl_ms: 15_000,
  max_reprice_attempts: 0, reprice_interval_ms: 1_000, cancel_at_signal_expiry: true,
  sizing: { mode: 'fixed_contracts', fixed_contracts: 1 }, max_contracts_per_order: 1,
  max_debit_per_trade: '150', max_aggregate_open_debit: '500', max_daily_debit_initiated: '500',
  max_open_positions: 1, max_active_positions_per_source: 1, source_quantity_behavior: 'ignore',
  duplicate_contract_policy: 'block',
  expiration_custody: {
    provider_calendar_checksum: checksum, account_exercise_setting_checksum: checksumB,
    no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45,
    operator_escalation_minutes_before_close: 30, do_not_exercise_mode: 'provider-supported',
    custody_certification_checksum: checksum,
  },
  environment: 'paper', provider_slug: 'fake-options', adapter_id: 'fake-options-adapter', required_certification: 'options-sandbox-entry-certified',
  certification_checksum: checksum, connection_id: 'connection-options-paper', account_id: 'account-options-paper',
  source_route_id: 'route-options-paper', global_halt_required: true, account_halt_required: true,
  source_halt_required: true, mandate_expires_at: '2026-08-26T17:00:00.000Z',
  created_at: '2026-08-26T14:00:00.000Z', content_checksum: checksumB,
}

const decide = (input: {
  signal?: DiscordOptionsSignal
  contract?: OptionContractIdentity
  quote?: OptionQuoteSnapshot
  policy?: OptionsEntryPolicy
  decision_at?: string
  estimated_fee_per_contract?: string
} = {}) => decideOptionsEntry({
  signal: input.signal ?? signal,
  contract: input.contract ?? contract,
  quote: input.quote ?? quote(),
  policy: input.policy ?? policy,
  route_checksum: checksum,
  account_checksum: checksumB,
  decision_at: input.decision_at ?? decisionAt,
  estimated_fee_per_contract: input.estimated_fee_per_contract ?? '0.65',
})

describe('deterministic options entry policy', () => {
  test('uses a marketable limit at ask when every spread and size gate passes', () => {
    const result = decide()
    expect(result).toMatchObject({
      action: 'marketable_limit', limit_price: '1.30', planned_quantity: 1,
      spread_abs: '0.03', spread_pct: '2.334630', effective_chase_cap: '1.35',
      maximum_debit: '130.65', reason_codes: ['ELIGIBLE'],
    })
    expect(result.content_checksum).toBe(sha256({ ...result, content_checksum: undefined }))
    expect(decide()).toEqual(result)
  })

  test('uses the frozen bounded passive formula when spread is too wide', () => {
    expect(decide({ quote: quote({ bid: '1.15', ask: '1.35' }) })).toMatchObject({
      action: 'passive_limit', limit_price: '1.25', reason_codes: ['ELIGIBLE_PASSIVE'],
    })
  })

  test('skips an ask beyond the lower chase cap with zero executable price', () => {
    expect(decide({ quote: quote({ bid: '1.36', ask: '1.45' }) })).toMatchObject({
      action: 'skip', reason_codes: ['OPTIONS_PRICE_MOVED_BEYOND_CAP'],
    })
  })

  test('blocks delayed, stale, halted, wrong-account, and wrong-contract quote evidence', () => {
    expect(decide({ quote: quote({ market_data_mode: 'delayed', delayed: true }) }).action).toBe('block')
    expect(decide({ quote: quote({
      quote_age_ms: 1_001,
      provider_timestamp: '2026-08-26T14:59:58.900Z',
      received_at: '2026-08-26T14:59:58.999Z',
    }) }).action).toBe('block')
    expect(decide({ quote: quote({ halted: true }) }).action).toBe('block')
    expect(decide({ quote: quote({ account_id: 'wrong-account' }) }).action).toBe('block')
    expect(decide({ quote: quote({ canonical_contract_id: 'USOPT:SPY:2026-09-18:P:650' }) }).action).toBe('block')
    expect(decide({ quote: quote({ bid: '1.27', ask: '1.305' }) }).action).toBe('block')
  })

  test('blocks stale signals, expired mandates, session violations, and 0DTE', () => {
    expect(decide({ decision_at: '2026-08-26T15:01:00.000Z' }).action).toBe('block')
    expect(decide({ decision_at: '2026-08-26T17:00:00.000Z' }).action).toBe('block')
    expect(decide({ decision_at: '2026-08-26T13:00:00.000Z' }).action).toBe('block')
    expect(decide({ signal: { ...signal, expiration: '2026-08-26' } }).action).toBe('block')
    expect(decide({ contract: { ...contract, resolved_at: '2026-08-26T15:00:01.000Z' } }).action).toBe('block')
  })

  test('uses the exact increment band at the proposed premium', () => {
    const bandedContract: OptionContractIdentity = {
      ...contract,
      minimum_tick: '0.01',
      increment_bands: [
        { minimum_price: '0', increment: '0.01' },
        { minimum_price: '3', increment: '0.05' },
      ],
    }
    const bandedPolicy: OptionsEntryPolicy = {
      ...policy,
      max_debit_per_trade: '400',
      max_spread_abs: '0.10',
    }
    const bandedSignal: DiscordOptionsSignal = { ...signal, reference_entry: '3.00' }
    expect(decide({
      contract: bandedContract,
      policy: bandedPolicy,
      signal: bandedSignal,
      quote: quote({ bid: '3.00', ask: '3.05', minimum_tick: '0.05' }),
    })).toMatchObject({ action: 'marketable_limit', limit_price: '3.05' })
    expect(decide({
      contract: bandedContract,
      policy: bandedPolicy,
      signal: bandedSignal,
      quote: quote({ bid: '3.00', ask: '3.04', minimum_tick: '0.05' }),
    }).action).toBe('block')
  })

  test('uses account policy sizing, caps source quantity, and refuses debit excess', () => {
    const sourceSized = { ...signal, source_quantity: 3 }
    expect(decide({ signal: sourceSized }).planned_quantity).toBe(1)
    expect(decide({
      signal: sourceSized,
      policy: { ...policy, source_quantity_behavior: 'use_with_cap', max_contracts_per_order: 1 },
    }).planned_quantity).toBe(1)
    expect(decide({ estimated_fee_per_contract: '25' })).toMatchObject({
      action: 'block', reason_codes: ['OPTIONS_RISK_LIMIT'],
    })
    expect(decide({
      policy: {
        ...policy,
        sizing: { mode: 'fixed_contracts', fixed_contracts: 2 },
        max_contracts_per_order: 2,
        max_debit_per_trade: '300',
      },
      quote: quote({ ask_size: 1 }),
    })).toMatchObject({ action: 'block', reason_codes: ['OPTIONS_QUOTE_UNAVAILABLE'] })
  })
})
