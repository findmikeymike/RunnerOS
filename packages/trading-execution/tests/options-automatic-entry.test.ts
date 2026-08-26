import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION,
  OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION,
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  type OptionContractIdentity,
  type OptionsAutomationRoute,
  type OptionsAutopilotAuthority,
  type OptionsConnection,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'
import {
  FakeOptionsProvider,
  FileOptionsAutomationPlanStore,
  FileOptionsAutomationReceiptStore,
  FileOptionsDebitReservationStore,
  FileOptionsExecutionStore,
  OptionsAutomaticEntryCoordinator,
  OptionsExecutionGateway,
  sha256,
} from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const now = '2026-08-26T15:00:01.000Z'; const a = 'a'.repeat(64); const b = 'b'.repeat(64)
const sum = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })

async function fixture(root: string, active = true) {
  const provider = FakeOptionsProvider.paperFixture()
  const original = provider.contracts[0]!; const { content_checksum: _old, ...body } = original
  provider.contracts[0] = sum({ ...body, provider: 'ibkr' }) as OptionContractIdentity
  const connection = sum({
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION, connection_id: 'options-connection-one', provider: 'ibkr' as const,
    environment: 'paper' as const, auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: provider.descriptor.adapter_id,
    adapter_version: provider.descriptor.adapter_version, provider_contract_version: provider.descriptor.provider_contract_version,
    account_ref: 'account-options-paper', account_label: 'Paper Options', endpoint: 'https://api.ibkr.com/v1/api',
    credential_ref: 'credential-options-one', credential_generation: provider.descriptor.credential_generation,
    state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
    created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsConnection
  const policy = sum({
    policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION, policy_id: 'options-policy-one', revision: 1,
    max_signal_age_ms: 30_000, max_ingest_delay_ms: 5_000, regular_session_only: true as const,
    entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' as const }, allowed_weekdays: [1, 2, 3, 4, 5],
    min_days_to_expiration: 1, max_days_to_expiration: 60, max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1,
    max_spread_abs: '0.10', max_spread_pct: '10', spread_gate_mode: 'both' as const, max_chase_abs: '0.10', max_chase_pct: '8',
    max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const, wide_spread_action: 'skip' as const,
    passive_limit_offset_abs: '0.01', working_order_ttl_ms: 10_000, max_reprice_attempts: 0, reprice_interval_ms: 1_000,
    cancel_at_signal_expiry: true, sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 }, max_contracts_per_order: 1,
    max_debit_per_trade: '150', max_aggregate_open_debit: '150', max_daily_debit_initiated: '150', max_open_positions: 1 as const,
    max_active_positions_per_source: 1 as const, source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
    expiration_custody: { provider_calendar_checksum: a, account_exercise_setting_checksum: b,
      no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45, operator_escalation_minutes_before_close: 30,
      do_not_exercise_mode: 'provider-supported' as const, custody_certification_checksum: a },
    environment: 'paper' as const, provider_slug: 'ibkr', adapter_id: provider.descriptor.adapter_id,
    required_certification: 'options-paper-autopilot-certified', certification_checksum: a,
    connection_id: connection.connection_id, account_id: connection.account_ref, source_route_id: 'options-route-one',
    global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
    mandate_expires_at: '2026-08-26T17:00:00.000Z', created_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsEntryPolicy
  const route = sum({
    route_schema_version: OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION, route_id: policy.source_route_id, revision: 1,
    display_name: 'SPY Options Trader', guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null, author_id: 'author-one',
    connection_id: connection.connection_id, connection_checksum: connection.content_checksum, account_id: connection.account_ref,
    provider: connection.provider, environment: connection.environment, policy_id: policy.policy_id, policy_revision: policy.revision,
    policy_checksum: policy.content_checksum, required_certification: 'options-paper-autopilot-certified' as const, state: 'paused' as const,
    created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsAutomationRoute
  const authority = sum({
    authority_schema_version: OPTIONS_AUTOPILOT_AUTHORITY_SCHEMA_VERSION, authority_id: 'options-autopilot-one',
    route_id: route.route_id, route_revision: route.revision, route_checksum: route.content_checksum,
    policy_id: policy.policy_id, policy_revision: policy.revision, policy_checksum: policy.content_checksum,
    connection_id: connection.connection_id, connection_checksum: connection.content_checksum,
    credential_generation: connection.credential_generation, provider: connection.provider, environment: connection.environment,
    account_id: connection.account_ref, adapter_id: connection.adapter_id, adapter_version: connection.adapter_version,
    provider_contract_version: connection.provider_contract_version, certification_id: 'autopilot-cert-one', certification_checksum: a,
    certification_level: 'options-paper-autopilot-certified' as const, certification_expires_at: '2026-08-26T17:00:00.000Z',
    certification_application_id: 'autopilot-app-one', certification_application_checksum: b, mode: 'automatic-paper' as const,
    valid_from: '2026-08-26T14:00:00.000Z', valid_until: '2026-08-26T17:00:00.000Z',
    operator_confirmed_at: '2026-08-26T14:00:00.000Z', created_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsAutopilotAuthority
  const reservations = new FileOptionsDebitReservationStore(path.join(root, 'risk'), () => now, 'automatic-entry-test')
  const originalQuote = await provider.quote(provider.contracts[0]!.canonical_id)
  const { content_checksum: _quoteChecksum, ...quoteBody } = originalQuote
  provider.setQuote(sum({ ...quoteBody, connection_id: connection.connection_id }) as typeof originalQuote)
  const executions = new FileOptionsExecutionStore(path.join(root, 'execution'))
  const receipts = new FileOptionsAutomationReceiptStore(root)
  const plans = new FileOptionsAutomationPlanStore(root)
  const gateway = new OptionsExecutionGateway(executions, reservations, provider, () => now)
  const coordinator = new OptionsAutomaticEntryCoordinator({
    automation: { resolve: async (identity) => identity.guild_id === route.guild_id && identity.channel_id === route.channel_id
      && identity.thread_id === route.thread_id && identity.author_id === route.author_id ? route : undefined,
      getPolicy: async () => policy },
    authorities: { getActive: async () => active ? authority : undefined }, receipts, plans, reservations, gateway, adapter: provider,
    resolveConnection: async () => connection, estimatedFeePerContract: async () => '0.65', now: () => now,
  })
  return { provider, coordinator, receipts, plans, gateway, reservations, route, policy, authority, connection }
}

const message = (rawText = 'BUY SPY 2026-09-18 650C @ 1.25') => ({
  guild_id: 'guild-one', channel_id: 'channel-one', message_id: 'message-one', author_id: 'author-one',
  thread_id: null, reply_to_message_id: null, posted_at: '2026-08-26T14:59:50.000Z',
  received_at: '2026-08-26T14:59:51.000Z', raw_text: rawText,
})

describe('options automatic entry coordinator', () => {
  test('persists an exact eligible receipt before one idempotent paper gateway order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automatic-entry-')); roots.push(root)
    const setup = await fixture(root)
    const receipt = await setup.coordinator.ingest(message())
    expect(receipt).toMatchObject({ state: 'working', route_id: 'options-route-one', connection_id: 'options-connection-one' })
    expect(setup.provider.mutationCount).toBe(1)
    expect((await setup.coordinator.ingest(message())).content_checksum).toBe(receipt.content_checksum)
    expect(setup.provider.mutationCount).toBe(1)
  })

  test('returns one exact result for concurrent duplicate delivery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automatic-entry-')); roots.push(root)
    const setup = await fixture(root)
    const [first, second] = await Promise.all([setup.coordinator.ingest(message()), setup.coordinator.ingest(message())])
    expect(second.content_checksum).toBe(first.content_checksum)
    expect(setup.provider.mutationCount).toBe(1)
    expect(await setup.receipts.list()).toHaveLength(1)
    expect(await setup.plans.list()).toHaveLength(1)
  })

  test('blocks an exact signal with zero provider mutation when autopilot authority is absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automatic-entry-')); roots.push(root)
    const setup = await fixture(root, false)
    expect(await setup.coordinator.ingest(message())).toMatchObject({ state: 'blocked', reason_codes: ['OPTIONS_AUTOPILOT_LOCKED'] })
    expect(setup.provider.mutationCount).toBe(0)
  })

  test('stores parse refusal and rejects edited message replay without provider I/O', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automatic-entry-')); roots.push(root)
    const setup = await fixture(root)
    expect(await setup.coordinator.ingest(message('maybe buy SPY calls?'))).toMatchObject({ state: 'blocked' })
    await expect(setup.coordinator.ingest(message('BUY SPY 2026-09-18 650C @ 1.25'))).rejects.toThrow('different immutable evidence')
    expect(setup.provider.mutationCount).toBe(0)
  })

  test('resumes the frozen plan after a crash before gateway delivery without recalculating or duplicating', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automatic-entry-')); roots.push(root)
    const setup = await fixture(root)
    const interrupted = new OptionsAutomaticEntryCoordinator({
      automation: { resolve: async () => setup.route, getPolicy: async () => setup.policy },
      authorities: { getActive: async () => setup.authority }, receipts: setup.receipts, plans: setup.plans,
      reservations: setup.reservations, gateway: { execute: async () => { throw new Error('simulated process interruption') } },
      adapter: setup.provider, resolveConnection: async () => setup.connection,
      estimatedFeePerContract: async () => '0.65', now: () => now,
    })
    await expect(interrupted.ingest(message())).rejects.toThrow('simulated process interruption')
    expect(await setup.receipts.getByMessage(message())).toMatchObject({ state: 'prepared' })
    expect(setup.provider.mutationCount).toBe(0)
    const recovered = await setup.coordinator.ingest(message())
    expect(recovered.state).toBe('working')
    expect(setup.provider.mutationCount).toBe(1)
    expect((await setup.coordinator.recoverPending()).length).toBe(0)
  })

  test('proves no send and releases prepared debit when authority is revoked before delivery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automatic-entry-')); roots.push(root)
    const setup = await fixture(root)
    const interrupted = new OptionsAutomaticEntryCoordinator({
      automation: { resolve: async () => setup.route, getPolicy: async () => setup.policy },
      authorities: { getActive: async () => setup.authority }, receipts: setup.receipts, plans: setup.plans,
      reservations: setup.reservations, gateway: { execute: async () => { throw new Error('simulated process interruption') } },
      adapter: setup.provider, resolveConnection: async () => setup.connection,
      estimatedFeePerContract: async () => '0.65', now: () => now,
    })
    await expect(interrupted.ingest(message())).rejects.toThrow('simulated process interruption')
    const revoked = new OptionsAutomaticEntryCoordinator({
      automation: { resolve: async () => setup.route, getPolicy: async () => setup.policy },
      authorities: { getActive: async () => undefined }, receipts: setup.receipts, plans: setup.plans,
      reservations: setup.reservations, gateway: setup.gateway, adapter: setup.provider,
      resolveConnection: async () => setup.connection, estimatedFeePerContract: async () => '0.65', now: () => now,
    })
    expect(await revoked.ingest(message())).toMatchObject({ state: 'halted', reason_codes: ['OPTIONS_AUTOPILOT_LOCKED'] })
    expect((await setup.reservations.list())[0]).toMatchObject({ state: 'released', open_quantity: 0 })
    expect(setup.provider.mutationCount).toBe(0)
  })
})
