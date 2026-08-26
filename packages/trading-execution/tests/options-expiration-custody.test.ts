import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_EXECUTION_RECORD_SCHEMA_VERSION,
  OPTIONS_EXPIRATION_SCHEDULE_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  type OptionsEntryPolicy,
  type OptionsExecutionRecord,
  type OptionsExpirationSchedule,
} from '@trade-god/contracts'
import { FileOptionsExpirationCustodyStore, OptionsExpirationCustodyPlanner, OptionsExpirationCustodySupervisor, sha256 } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const checksum = 'a'.repeat(64)
const checksumB = 'b'.repeat(64)
const checksummed = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })

const entry = (openQuantity = 1): OptionsExecutionRecord => checksummed({
  record_schema_version: OPTIONS_EXECUTION_RECORD_SCHEMA_VERSION,
  record_id: 'record-expiry-one', command_id: 'command-expiry-one', command_checksum: checksum,
  intent_id: 'intent-expiry-one', intent_checksum: checksumB, reservation_id: 'reservation-expiry-one',
  reservation_checksum: checksum, connection_id: 'connection-expiry-one', account_id: 'account-expiry-one',
  canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', provider_client_order_id: 'tgopt-expiry-one',
  state: openQuantity === 0 ? 'closed-flat' as const : 'open-position' as const,
  provider_order_id: 'provider-entry-one', requested_quantity: 1, filled_quantity: 1,
  open_quantity: openQuantity, average_fill_price: '1.25', created_at: '2026-09-18T13:00:00.000Z',
  updated_at: '2026-09-18T13:05:00.000Z', submitted_at: '2026-09-18T13:00:01.000Z',
  reconciled_at: '2026-09-18T13:05:00.000Z', failure_code: null, recovery_evidence: [],
}) as OptionsExecutionRecord

const policy = (): OptionsEntryPolicy => checksummed({
  policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION, policy_id: 'policy-expiry-one', revision: 1,
  max_signal_age_ms: 30_000, max_ingest_delay_ms: 5_000, regular_session_only: true as const,
  entry_window: { earliest: '09:35', latest: '15:00', timezone: 'America/New_York' as const }, allowed_weekdays: [1, 2, 3, 4, 5],
  min_days_to_expiration: 1, max_days_to_expiration: 60, max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1,
  max_spread_abs: '0.10', max_spread_pct: '10', spread_gate_mode: 'both' as const, max_chase_abs: '0.10', max_chase_pct: '8',
  max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const, wide_spread_action: 'skip' as const,
  passive_limit_offset_abs: '0.01', working_order_ttl_ms: 10_000, max_reprice_attempts: 0, reprice_interval_ms: 1_000,
  cancel_at_signal_expiry: true, sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 }, max_contracts_per_order: 1,
  max_debit_per_trade: '150', max_aggregate_open_debit: '150', max_daily_debit_initiated: '150', max_open_positions: 1 as const,
  max_active_positions_per_source: 1 as const, source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
  expiration_custody: { provider_calendar_checksum: checksum, account_exercise_setting_checksum: checksumB,
    no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45,
    operator_escalation_minutes_before_close: 30, do_not_exercise_mode: 'manual-required' as const,
    custody_certification_checksum: checksum },
  environment: 'paper' as const, provider_slug: 'ibkr', adapter_id: 'ibkr-options-api',
  required_certification: 'options-sandbox-entry-certified', certification_checksum: checksum,
  connection_id: 'connection-expiry-one', account_id: 'account-expiry-one', source_route_id: 'manual-expiry-one',
  global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
  mandate_expires_at: '2026-09-18T20:00:00.000Z', created_at: '2026-09-01T14:00:00.000Z',
}) as OptionsEntryPolicy

const schedule = (): OptionsExpirationSchedule => checksummed({
  schedule_schema_version: OPTIONS_EXPIRATION_SCHEDULE_SCHEMA_VERSION, schedule_id: 'schedule-expiry-one',
  provider: 'ibkr' as const, environment: 'paper' as const, connection_id: 'connection-expiry-one', account_id: 'account-expiry-one',
  canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', expiration: '2026-09-18',
  provider_calendar_checksum: checksum, account_exercise_setting_checksum: checksumB,
  automatic_close_start_at: '2026-09-18T19:15:00.000Z', operator_escalation_at: '2026-09-18T19:30:00.000Z',
  broker_order_cutoff_at: '2026-09-18T19:50:00.000Z', regular_close_at: '2026-09-18T20:00:00.000Z',
  exercise_instruction_cutoff_at: '2026-09-18T21:30:00.000Z', do_not_exercise_mode: 'manual-required' as const,
  source: 'retained IBKR account-specific paper custody fixture', captured_at: '2026-09-01T14:00:00.000Z',
}) as OptionsExpirationSchedule

describe('options expiration custody', () => {
  test('progresses from monitoring to operator close and manual do-not-exercise escalation', () => {
    const planner = new OptionsExpirationCustodyPlanner()
    const assess = (at: string) => planner.assess({ entry: entry(), policy: policy(), schedule: schedule(), assessed_at: at,
      provider_automatic_close_certified: false, provider_do_not_exercise_certified: false })
    expect(assess('2026-09-18T19:00:00.000Z').state).toBe('monitoring')
    expect(assess('2026-09-18T19:20:00.000Z')).toMatchObject({ state: 'close-due', automatic_close_allowed: false, operator_action_required: true })
    expect(assess('2026-09-18T19:35:00.000Z').state).toBe('operator-escalation')
    expect(assess('2026-09-18T20:05:00.000Z').state).toBe('manual-do-not-exercise-required')
    expect(assess('2026-09-18T21:31:00.000Z').state).toBe('custody-halted')
  })

  test('resolves flat and refuses a schedule from another custody policy', () => {
    const planner = new OptionsExpirationCustodyPlanner()
    expect(planner.assess({ entry: entry(0), policy: policy(), schedule: schedule(), assessed_at: '2026-09-18T19:20:00.000Z', provider_automatic_close_certified: false, provider_do_not_exercise_certified: false }).state).toBe('resolved-flat')
    const wrong = schedule()
    const body = { ...wrong, provider_calendar_checksum: 'c'.repeat(64), content_checksum: undefined }
    delete (body as { content_checksum?: string }).content_checksum
    expect(() => planner.assess({ entry: entry(), policy: policy(), schedule: checksummed(body) as OptionsExpirationSchedule,
      assessed_at: '2026-09-18T19:20:00.000Z', provider_automatic_close_certified: false, provider_do_not_exercise_certified: false })).toThrow('does not bind')
  })

  test('retains exact schedules and warns without claiming automatic close authority', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-expiration-')); roots.push(root)
    const store = new FileOptionsExpirationCustodyStore(root)
    await store.saveSchedule(schedule())
    const closes: unknown[] = []
    const supervisor = new OptionsExpirationCustodySupervisor({
      store,
      plans: async () => [{ policy: policy(), connection: { connection_id: 'connection-expiry-one', account_ref: 'account-expiry-one' },
        contract: { canonical_id: 'USOPT:SPY:2026-09-18:C:650' }, decision: { decision_id: 'intent-expiry-one' } }],
      getRecord: async () => entry(),
      closePosition: async (_connectionId, input) => { closes.push(input); return { state: 'closed-flat' } },
      certification: async () => undefined,
      now: () => '2026-09-18T19:20:00.000Z',
    })
    expect(await supervisor.sweep()).toBe(1)
    expect(closes).toHaveLength(0)
    expect((await store.listAssessments())[0]).toMatchObject({
      state: 'close-due', automatic_close_allowed: false, operator_action_required: true,
    })
  })

  test('uses one deterministic full-close request only with exact custody certification', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-expiration-')); roots.push(root)
    const store = new FileOptionsExpirationCustodyStore(root)
    await store.saveSchedule(schedule())
    const requests: string[] = []
    const supervisor = new OptionsExpirationCustodySupervisor({
      store,
      plans: async () => [{ policy: policy(), connection: { connection_id: 'connection-expiry-one', account_ref: 'account-expiry-one' },
        contract: { canonical_id: 'USOPT:SPY:2026-09-18:C:650' }, decision: { decision_id: 'intent-expiry-one' } }],
      getRecord: async () => entry(),
      closePosition: async (_connectionId, input) => { requests.push(input.request_id); return { state: 'close-working' } },
      certification: async () => ({ provider_automatic_close_certified: true, provider_do_not_exercise_certified: true, content_checksum: checksum }),
      now: () => '2026-09-18T19:20:00.000Z',
    })
    expect(await supervisor.sweep()).toBe(1)
    expect(await supervisor.sweep()).toBe(1)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toBe(requests[0])
    expect((await store.listAssessments())).toHaveLength(1)
  })

  test('isolates a missing schedule without calling the provider', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-expiration-')); roots.push(root)
    const errors: string[] = []
    const supervisor = new OptionsExpirationCustodySupervisor({
      store: new FileOptionsExpirationCustodyStore(root),
      plans: async () => [{ policy: policy(), connection: { connection_id: 'connection-expiry-one', account_ref: 'account-expiry-one' },
        contract: { canonical_id: 'USOPT:SPY:2026-09-18:C:650' }, decision: { decision_id: 'intent-expiry-one' } }],
      getRecord: async () => entry(),
      closePosition: async () => { throw new Error('must not run') },
      certification: async () => undefined,
      onError: (_connection, _intent, error) => { errors.push((error as Error).message) },
      now: () => '2026-09-18T19:20:00.000Z',
    })
    expect(await supervisor.sweep()).toBe(0)
    expect(errors[0]).toContain('No retained broker expiration schedule')
  })

  test('returns retained assessments in explicit chronological order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-expiration-')); roots.push(root)
    const store = new FileOptionsExpirationCustodyStore(root)
    const planner = new OptionsExpirationCustodyPlanner()
    for (const assessedAt of ['2026-09-18T21:31:00.000Z', '2026-09-18T19:20:00.000Z', '2026-09-18T20:05:00.000Z']) {
      await store.saveAssessment(planner.assess({ entry: entry(), policy: policy(), schedule: schedule(), assessed_at: assessedAt,
        provider_automatic_close_certified: false, provider_do_not_exercise_certified: false }))
    }
    expect((await store.listAssessments()).map((item) => item.assessed_at)).toEqual([
      '2026-09-18T19:20:00.000Z', '2026-09-18T20:05:00.000Z', '2026-09-18T21:31:00.000Z',
    ])
  })
})
