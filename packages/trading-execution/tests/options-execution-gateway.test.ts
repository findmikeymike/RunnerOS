import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
  OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  type DiscordOptionsSignal,
  type OptionContractIdentity,
  type OptionsAutopilotAuthority,
  type OptionsAutomationRoute,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'

import {
  FakeOptionsProvider,
  FileOptionsDebitReservationStore,
  FileOptionsExecutionStore,
  OptionsExecutionGateway,
  decideOptionsEntry,
  sha256,
} from '../src/index.ts'

const now = '2026-08-26T15:00:01.000Z'
const checksum = 'a'.repeat(64)
const checksumB = 'b'.repeat(64)

function checksummed<T extends Record<string, unknown>>(body: T): T & { content_checksum: string } {
  return { ...body, content_checksum: sha256(body) }
}

async function fixture(root: string, provider = FakeOptionsProvider.paperFixture()) {
  const original = provider.contracts[0]!
  const { content_checksum: _contractChecksum, ...contractBody } = original
  provider.contracts[0] = checksummed({ ...contractBody, provider: 'ibkr' }) as OptionContractIdentity
  const contract = provider.contracts[0]!
  const quote = await provider.quote(contract.canonical_id)
  const signal = checksummed({
    signal_schema_version: DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
    signal_id: 'signal-options-gateway-1',
    provenance: {
      guild_id: 'guild-options', channel_id: 'channel-options', message_id: 'message-options-gateway-1',
      author_id: 'trader-options', thread_id: null, reply_to_message_id: null,
      posted_at: '2026-08-26T14:59:50.000Z', received_at: '2026-08-26T14:59:51.000Z',
      content_sha256: checksum,
    },
    raw_text: 'BUY SPY 2026-09-18 650C @ 1.25',
    action: 'buy_to_open' as const, strategy: 'single-leg' as const, underlying: 'SPY',
    expiration: '2026-09-18', strike: '650', right: 'call' as const,
    reference_entry: '1.25', reference_kind: 'single_price' as const,
  }) as DiscordOptionsSignal
  const policy = checksummed({
    policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
    policy_id: 'options-policy-paper-v1', revision: 1, max_signal_age_ms: 30_000,
    max_ingest_delay_ms: 10_000, regular_session_only: true as const,
    entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' as const },
    allowed_weekdays: [1, 2, 3, 4, 5], min_days_to_expiration: 1, max_days_to_expiration: 60,
    max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1, max_spread_abs: '0.10',
    max_spread_pct: '10', spread_gate_mode: 'both' as const, max_chase_abs: '0.10', max_chase_pct: '8',
    max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const,
    wide_spread_action: 'passive_limit' as const, passive_limit_offset_abs: '0.03', working_order_ttl_ms: 15_000,
    max_reprice_attempts: 0, reprice_interval_ms: 1_000, cancel_at_signal_expiry: true,
    sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 }, max_contracts_per_order: 1,
    max_debit_per_trade: '150', max_aggregate_open_debit: '500', max_daily_debit_initiated: '500',
    max_open_positions: 1 as const, max_active_positions_per_source: 1 as const,
    source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
    expiration_custody: {
      provider_calendar_checksum: checksum, account_exercise_setting_checksum: checksumB,
      no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45,
      operator_escalation_minutes_before_close: 30, do_not_exercise_mode: 'provider-supported' as const,
      custody_certification_checksum: checksum,
    },
    environment: 'paper' as const, provider_slug: 'ibkr', adapter_id: 'fake-options',
    required_certification: 'options-paper-autopilot-certified', certification_checksum: checksum,
    connection_id: 'connection-options-paper', account_id: 'account-options-paper',
    source_route_id: 'route-options-paper', global_halt_required: true as const,
    account_halt_required: true as const, source_halt_required: true as const,
    mandate_expires_at: '2026-08-26T17:00:00.000Z', created_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsEntryPolicy
  const route = checksummed({
    route_schema_version: OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION, route_id: policy.source_route_id, revision: 1,
    display_name: 'Options gateway route', guild_id: signal.provenance.guild_id,
    channel_id: signal.provenance.channel_id, thread_id: signal.provenance.thread_id, author_id: signal.provenance.author_id,
    connection_id: policy.connection_id, connection_checksum: checksumB, account_id: policy.account_id,
    provider: 'ibkr' as const, environment: 'paper' as const, policy_id: policy.policy_id,
    policy_revision: policy.revision, policy_checksum: policy.content_checksum,
    required_certification: 'options-paper-autopilot-certified' as const, state: 'paused' as const,
    created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsAutomationRoute
  const authority = checksummed({
    authority_schema_version: OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION, authority_id: 'mandate-options-paper',
    route_id: policy.source_route_id, route_revision: 1, route_checksum: route.content_checksum,
    policy_id: policy.policy_id, policy_revision: policy.revision, policy_checksum: policy.content_checksum,
    connection_id: policy.connection_id, connection_checksum: checksumB,
    credential_generation: provider.descriptor.credential_generation, provider: 'ibkr' as const,
    environment: 'paper' as const, account_id: policy.account_id, adapter_id: provider.descriptor.adapter_id,
    adapter_version: provider.descriptor.adapter_version, provider_contract_version: provider.descriptor.provider_contract_version,
    certification_id: 'autopilot-cert-one', certification_checksum: checksum,
    certification_level: 'options-paper-autopilot-certified' as const, certification_expires_at: '2026-08-26T17:00:00.000Z',
    certification_application_id: 'autopilot-app-one', certification_application_checksum: checksumB,
    mode: 'automatic-paper' as const, valid_from: '2026-08-26T14:00:00.000Z', valid_until: '2026-08-26T17:00:00.000Z',
    operator_confirmed_at: '2026-08-26T14:00:00.000Z', created_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsAutopilotAuthority
  const decision = decideOptionsEntry({
    signal, contract, quote, policy, route_checksum: route.content_checksum, account_checksum: checksumB,
    decision_at: quote.decision_at, estimated_fee_per_contract: '0.65',
  })
  const reservations = new FileOptionsDebitReservationStore(path.join(root, 'reservations'), () => now, 'app-instance-options')
  const reservation = await reservations.admit({
    reservation_id: 'reservation-options-gateway-1', intent_id: decision.decision_id,
    connection_id: policy.connection_id, account_id: policy.account_id, source_id: signal.signal_id,
    policy_id: policy.policy_id, policy_checksum: policy.content_checksum,
    mandate_id: authority.authority_id, mandate_checksum: authority.content_checksum,
    canonical_contract_id: contract.canonical_id, contract_checksum: contract.content_checksum,
    reserved_contracts: decision.planned_quantity, limit_price: decision.limit_price!, multiplier: 100,
    estimated_fees: '0.65', worst_case_debit: decision.maximum_debit,
    account_capacity_snapshot_checksum: sha256(await provider.snapshotAccount(policy.account_id)),
    expires_at: decision.valid_until,
  }, {
    max_aggregate_open_debit: policy.max_aggregate_open_debit,
    max_daily_debit_initiated: policy.max_daily_debit_initiated,
    max_open_positions: policy.max_open_positions,
  })
  const executions = new FileOptionsExecutionStore(path.join(root, 'executions'))
  const gateway = new OptionsExecutionGateway(executions, reservations, provider, () => now)
  const input = {
    signal, contract, quote, decision, policy, reservation_id: reservation.reservation_id,
    mandate_id: reservation.mandate_id, mandate_checksum: reservation.mandate_checksum,
    route_checksum: route.content_checksum, account_checksum: checksumB, autopilot_authority: authority, automation_route: route,
  }
  return { provider, reservations, executions, gateway, input, reservation }
}

describe('options execution gateway', () => {
  test('persists preview and command before one idempotent paper submit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-gateway-'))
    try {
      const setup = await fixture(root)
      const record = await setup.gateway.execute(setup.input)
      expect(record).toMatchObject({ state: 'working', provider_order_id: 'fake-options-order-1' })
      expect(setup.provider.previewCount).toBe(1)
      expect(setup.provider.mutationCount).toBe(1)
      expect((await setup.gateway.execute(setup.input)).provider_order_id).toBe(record.provider_order_id)
      expect(setup.provider.mutationCount).toBe(1)
      expect((await setup.reservations.get(setup.reservation.reservation_id)).state).toBe('working')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('never resubmits an unknown accepted order and adopts it on recovery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-gateway-'))
    try {
      const setup = await fixture(root)
      setup.provider.failNextSubmit('after-accept')
      expect(await setup.gateway.execute(setup.input)).toMatchObject({ state: 'submit-unknown' })
      expect(setup.provider.mutationCount).toBe(1)
      expect(await setup.gateway.recoverNonTerminal()).toBe(1)
      expect((await setup.executions.getRecord(setup.input.decision.decision_id)).state).toBe('working')
      expect(setup.provider.mutationCount).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('releases capacity only after exact client-ID and flat-account proof of no send', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-gateway-'))
    try {
      const setup = await fixture(root)
      setup.provider.failNextSubmit('before-send')
      expect(await setup.gateway.execute(setup.input)).toMatchObject({ state: 'submit-unknown' })
      expect(setup.provider.mutationCount).toBe(0)
      expect(await setup.gateway.recoverNonTerminal()).toBe(1)
      expect((await setup.executions.getRecord(setup.input.decision.decision_id)).state).toBe('not-sent')
      expect((await setup.reservations.get(setup.reservation.reservation_id)).state).toBe('released')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('blocks quote drift after preview with zero order mutation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-gateway-'))
    try {
      const setup = await fixture(root)
      const originalPreview = setup.provider.preview.bind(setup.provider)
      setup.provider.preview = async (request) => {
        const response = await originalPreview(request)
        const current = await setup.provider.quote(setup.input.contract.canonical_id)
        const body = { ...current, ask: '1.31', quote_id: 'quote-drift', content_checksum: undefined }
        delete (body as { content_checksum?: string }).content_checksum
        setup.provider.setQuote({ ...body, content_checksum: sha256(body) })
        return response
      }
      await expect(setup.gateway.execute(setup.input)).rejects.toMatchObject({
        code: 'OPTIONS_PREVIEW_STALE_OR_DRIFTED',
      })
      expect(setup.provider.mutationCount).toBe(0)
      expect((await setup.reservations.get(setup.reservation.reservation_id)).state).toBe('released')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refuses a same-intent replay carrying different immutable evidence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-gateway-'))
    try {
      const setup = await fixture(root)
      await setup.gateway.execute(setup.input)
      const alteredSignalBody = { ...setup.input.signal, raw_text: 'different signed evidence', content_checksum: undefined }
      delete (alteredSignalBody as { content_checksum?: string }).content_checksum
      const alteredSignal = { ...alteredSignalBody, content_checksum: sha256(alteredSignalBody) }
      const alteredDecisionBody = {
        ...setup.input.decision,
        signal_checksum: alteredSignal.content_checksum,
        content_checksum: undefined,
      }
      delete (alteredDecisionBody as { content_checksum?: string }).content_checksum
      const alteredDecision = { ...alteredDecisionBody, content_checksum: sha256(alteredDecisionBody) }
      await expect(setup.gateway.execute({
        ...setup.input,
        signal: alteredSignal,
        decision: alteredDecision,
      })).rejects.toMatchObject({ code: 'OPTIONS_EXECUTION_INTEGRITY' })
      expect(setup.provider.mutationCount).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('reconciles an owned open position during startup recovery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-gateway-'))
    try {
      const setup = await fixture(root)
      const working = await setup.gateway.execute(setup.input)
      await setup.provider.fill(working.provider_order_id!, 1, '1.29')
      expect(await setup.gateway.recoverNonTerminal()).toBe(1)
      expect(await setup.executions.getRecord(working.intent_id)).toMatchObject({
        state: 'open-position', filled_quantity: 1, open_quantity: 1,
      })
      expect((await setup.reservations.get(setup.reservation.reservation_id)).state).toBe('open-position')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
