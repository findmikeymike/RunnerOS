import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  type OptionsAutomationRoute,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'
import { FileOptionsAutomationStore, sha256 } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const checksummed = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })
const a = 'a'.repeat(64)
const b = 'b'.repeat(64)

const policy = (routeId = 'options-route-one', revision = 1): OptionsEntryPolicy => checksummed({
  policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION, policy_id: 'options-policy-one', revision,
  max_signal_age_ms: 30_000, max_ingest_delay_ms: 5_000, regular_session_only: true as const,
  entry_window: { earliest: '09:35', latest: '15:00', timezone: 'America/New_York' as const }, allowed_weekdays: [1, 2, 3, 4, 5],
  min_days_to_expiration: 1, max_days_to_expiration: 60, max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1,
  max_spread_abs: '0.10', max_spread_pct: '10', spread_gate_mode: 'both' as const, max_chase_abs: '0.10', max_chase_pct: '8',
  max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const, wide_spread_action: 'skip' as const,
  passive_limit_offset_abs: '0.01', working_order_ttl_ms: 10_000, max_reprice_attempts: 0, reprice_interval_ms: 1_000,
  cancel_at_signal_expiry: true, sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 }, max_contracts_per_order: 1,
  max_debit_per_trade: '150', max_aggregate_open_debit: '150', max_daily_debit_initiated: '150', max_open_positions: 1 as const,
  max_active_positions_per_source: 1 as const, source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
  expiration_custody: { provider_calendar_checksum: a, account_exercise_setting_checksum: b,
    no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45,
    operator_escalation_minutes_before_close: 30, do_not_exercise_mode: 'manual-required' as const,
    custody_certification_checksum: a },
  environment: 'paper' as const, provider_slug: 'ibkr', adapter_id: 'ibkr-options-api',
  required_certification: 'options-paper-autopilot-certified', certification_checksum: a,
  connection_id: 'options-connection-one', account_id: 'DU1234567', source_route_id: routeId,
  global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
  mandate_expires_at: '2026-08-26T16:00:00.000Z', created_at: '2026-08-26T14:00:00.000Z',
}) as OptionsEntryPolicy

const route = (boundPolicy: OptionsEntryPolicy, revision = 1, state: OptionsAutomationRoute['state'] = 'draft'): OptionsAutomationRoute => checksummed({
  route_schema_version: OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION, route_id: boundPolicy.source_route_id, revision,
  display_name: 'SPY Options Trader', guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null,
  author_id: 'author-one', connection_id: boundPolicy.connection_id, connection_checksum: b,
  account_id: boundPolicy.account_id, provider: 'ibkr' as const, environment: 'paper' as const,
  policy_id: boundPolicy.policy_id, policy_revision: boundPolicy.revision, policy_checksum: boundPolicy.content_checksum,
  required_certification: 'options-paper-autopilot-certified' as const, state,
  created_at: '2026-08-26T14:00:00.000Z', updated_at: revision === 1 ? '2026-08-26T14:00:00.000Z' : '2026-08-26T14:05:00.000Z',
}) as OptionsAutomationRoute

describe('options automation route store', () => {
  test('persists one exact policy and append-only Discord route revision', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automation-')); roots.push(root)
    const store = new FileOptionsAutomationStore(root)
    const firstPolicy = policy()
    await store.savePolicy(firstPolicy)
    const firstRoute = route(firstPolicy)
    await store.saveRoute(firstRoute)
    expect(await store.resolve({ guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null, author_id: 'author-one' })).toEqual(firstRoute)

    const secondPolicy = policy('options-route-one', 2)
    await store.savePolicy(secondPolicy)
    const paused = route(secondPolicy, 2, 'paused')
    await store.saveRoute(paused)
    expect((await store.getRoute(paused.route_id)).content_checksum).toBe(paused.content_checksum)
    expect(await store.listRoutes()).toEqual([paused])
  })

  test('rejects identity edits, skipped revisions, and policy/account drift', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automation-')); roots.push(root)
    const store = new FileOptionsAutomationStore(root)
    const firstPolicy = policy(); await store.savePolicy(firstPolicy); await store.saveRoute(route(firstPolicy))
    const secondPolicy = policy('options-route-one', 2); await store.savePolicy(secondPolicy)
    const editedIdentity = route(secondPolicy, 2)
    const editedBody = { ...editedIdentity, author_id: 'other-author', content_checksum: undefined }; delete (editedBody as { content_checksum?: string }).content_checksum
    await expect(store.saveRoute(checksummed(editedBody) as OptionsAutomationRoute)).rejects.toThrow('identity is immutable')
    const skipped = route(secondPolicy, 3)
    await expect(store.saveRoute(skipped)).rejects.toThrow('sequential')
    const driftPolicy = policy('other-route', 3); await store.savePolicy(driftPolicy)
    const drift = route(driftPolicy, 2)
    const driftBody = { ...drift, route_id: 'options-route-one', content_checksum: undefined }; delete (driftBody as { content_checksum?: string }).content_checksum
    await expect(store.saveRoute(checksummed(driftBody) as OptionsAutomationRoute)).rejects.toThrow('exact immutable policy')
  })

  test('never resolves archived routes and permits a replacement only after archival', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automation-')); roots.push(root)
    const store = new FileOptionsAutomationStore(root)
    const firstPolicy = policy(); await store.savePolicy(firstPolicy); await store.saveRoute(route(firstPolicy))
    const archivedPolicy = policy('options-route-one', 2); await store.savePolicy(archivedPolicy); await store.saveRoute(route(archivedPolicy, 2, 'archived'))
    expect(await store.resolve({ guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null, author_id: 'author-one' })).toBeUndefined()

    const otherPolicyBody = { ...policy('other-route'), policy_id: 'other-policy', content_checksum: undefined }; delete (otherPolicyBody as { content_checksum?: string }).content_checksum
    const otherPolicy = checksummed(otherPolicyBody) as OptionsEntryPolicy
    await store.savePolicy(otherPolicy)
    const duplicate = route(otherPolicy)
    await store.saveRoute(duplicate)
    expect((await store.listRoutes()).length).toBe(2)
    expect((await store.resolve({ guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null, author_id: 'author-one' }))?.route_id).toBe('other-route')
  })

  test('rejects a duplicate live source identity before it reaches disk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-automation-')); roots.push(root)
    const store = new FileOptionsAutomationStore(root)
    const firstPolicy = policy(); await store.savePolicy(firstPolicy); await store.saveRoute(route(firstPolicy))
    const otherPolicyBody = { ...policy('other-live-route'), policy_id: 'other-live-policy', content_checksum: undefined }; delete (otherPolicyBody as { content_checksum?: string }).content_checksum
    const otherPolicy = checksummed(otherPolicyBody) as OptionsEntryPolicy
    await store.savePolicy(otherPolicy)
    await expect(store.saveRoute(route(otherPolicy))).rejects.toThrow('already assigned')
    expect((await store.listRoutes()).length).toBe(1)
  })
})
