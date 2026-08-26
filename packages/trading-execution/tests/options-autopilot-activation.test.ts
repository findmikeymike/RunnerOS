import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION, OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION,
  OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION, OPTIONS_CONNECTION_SCHEMA_VERSION, OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  optionsAutopilotCertificationScenarioSchema, type OptionsAutomationRoute, type OptionsAutopilotCertificationEvidence,
  type OptionsCertificationApplication, type OptionsConnection, type OptionsEntryPolicy,
} from '@trade-god/contracts'
import {
  FileOptionsAutomationStore, OptionsAutopilotActivationService, FileOptionsAutopilotAuthorityStore, FileOptionsAutopilotCertificationJournal,
  FileOptionsAutopilotCertificationStore, sha256,
} from '../src/index.ts'
import type { FileOptionsCertificationApplicationStore } from '../src/options/options-certification-application.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const sum = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })
const a = 'a'.repeat(64); const b = 'b'.repeat(64)

const account = (): OptionsConnection => sum({ connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION, connection_id: 'account-one', provider: 'ibkr' as const,
  environment: 'paper' as const, auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
  provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26', account_ref: 'DU1', account_label: 'Paper', endpoint: 'https://api.ibkr.com',
  credential_ref: 'credential-one', credential_generation: a, state: 'read-only-verified' as const, read_only: true as const,
  execution_enabled: false as const, created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z' }) as OptionsConnection
const application = (connection: OptionsConnection): OptionsCertificationApplication => sum({ application_schema_version: OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION,
  application_id: 'application-one', connection_id: connection.connection_id, connection_checksum: connection.content_checksum,
  credential_generation: connection.credential_generation, certification_id: 'base-cert-one', certification_checksum: b,
  certification_expires_at: '2026-08-27T14:00:00.000Z', provider: connection.provider, environment: connection.environment,
  account_ref: connection.account_ref, adapter_id: connection.adapter_id, adapter_version: connection.adapter_version,
  provider_contract_version: connection.provider_contract_version, applied_at: '2026-08-26T14:01:00.000Z', operator_confirmed: true as const }) as OptionsCertificationApplication
const certification = async (root: string, connection: OptionsConnection, app: OptionsCertificationApplication): Promise<OptionsAutopilotCertificationEvidence> => {
  const journal = new FileOptionsAutopilotCertificationJournal(root, 'auto-session-one', connection.connection_id)
  await journal.append('session', { connection_checksum: connection.content_checksum, application_checksum: app.content_checksum,
    expires_at: '2026-08-27T14:00:00.000Z' }, '2026-08-26T14:20:00.000Z')
  for (const scenario of optionsAutopilotCertificationScenarioSchema.options) await journal.append('scenario', {
    scenario, status: 'pass', detail: `Proved ${scenario}`, evidence: { scenario },
  }, '2026-08-26T14:20:00.000Z')
  for (let index = 0; index < 50; index += 1) await journal.append('lifecycle', {
    lifecycle_id: `lifecycle-${index + 1}`, completed_at: '2026-08-26T14:20:00.000Z', evidence: index + 1,
  }, '2026-08-26T14:20:00.000Z')
  await journal.append('custody', { provider_automatic_close_certified: true, provider_do_not_exercise_certified: true,
    provider_calendar_evidence: 'calendar', account_exercise_setting_evidence: 'settings', custody_certification_evidence: 'custody' }, '2026-08-26T14:20:00.000Z')
  await journal.append('final-truth', { position_quantity: 0, working_order_count: 0 }, '2026-08-26T14:20:00.000Z')
  return sum({
  certification_schema_version: OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION, certification_id: 'auto-cert-one', connection_id: connection.connection_id,
  certification_session_id: 'auto-session-one', journal_head_checksum: await journal.headChecksum(),
  connection_checksum: connection.content_checksum, credential_generation: connection.credential_generation, provider: connection.provider,
  environment: connection.environment, account_id: connection.account_ref, adapter_id: connection.adapter_id, adapter_version: connection.adapter_version,
  provider_contract_version: connection.provider_contract_version, base_certification_id: app.certification_id,
  base_certification_checksum: app.certification_checksum, base_application_id: app.application_id, base_application_checksum: app.content_checksum,
  started_at: '2026-08-26T14:02:00.000Z', completed_at: '2026-08-26T14:20:00.000Z', expires_at: '2026-08-27T14:00:00.000Z',
  scenarios: optionsAutopilotCertificationScenarioSchema.options.map((scenario) => ({ scenario, status: 'pass' as const,
    evidence_checksum: sha256({ scenario }), detail: `Proved ${scenario}`, observed_at: '2026-08-26T14:20:00.000Z' })),
  completed_lifecycle_count: 50, provider_automatic_close_certified: true, provider_do_not_exercise_certified: true,
  lifecycle_evidence: Array.from({ length: 50 }, (_, index) => ({ lifecycle_id: `lifecycle-${index + 1}`,
    evidence_checksum: sha256(index + 1), completed_at: '2026-08-26T14:20:00.000Z' })),
  provider_calendar_checksum: sha256('calendar'), account_exercise_setting_checksum: sha256('settings'), custody_certification_checksum: sha256('custody'),
  final_position_quantity: 0, final_working_order_count: 0, eligible_level: 'options-paper-autopilot-certified' as const }) as OptionsAutopilotCertificationEvidence
}
const policy = (): OptionsEntryPolicy => sum({ policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION, policy_id: 'policy-one', revision: 1,
  max_signal_age_ms: 30000, max_ingest_delay_ms: 5000, regular_session_only: true as const,
  entry_window: { earliest: '09:35', latest: '15:30', timezone: 'America/New_York' as const }, allowed_weekdays: [1,2,3,4,5],
  min_days_to_expiration: 1, max_days_to_expiration: 60, max_quote_age_ms: 1000, min_bid_size: 1, min_ask_size: 1,
  max_spread_abs: '0.10', max_spread_pct: '10', spread_gate_mode: 'both' as const, max_chase_abs: '0.10', max_chase_pct: '8',
  max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const, wide_spread_action: 'skip' as const,
  passive_limit_offset_abs: '0.01', working_order_ttl_ms: 15000, max_reprice_attempts: 0, reprice_interval_ms: 1000,
  cancel_at_signal_expiry: true, sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 }, max_contracts_per_order: 1,
  max_debit_per_trade: '150', max_aggregate_open_debit: '150', max_daily_debit_initiated: '150', max_open_positions: 1 as const,
  max_active_positions_per_source: 1 as const, source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
  expiration_custody: { provider_calendar_checksum: '0'.repeat(64), account_exercise_setting_checksum: '0'.repeat(64),
    no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45, operator_escalation_minutes_before_close: 30,
    do_not_exercise_mode: 'manual-required' as const, custody_certification_checksum: '0'.repeat(64) }, environment: 'paper' as const,
  provider_slug: 'ibkr', adapter_id: 'ibkr-options-api', required_certification: 'options-paper-autopilot-certified' as const,
  certification_checksum: '0'.repeat(64), connection_id: 'account-one', account_id: 'DU1', source_route_id: 'route-one',
  global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
  mandate_expires_at: '2026-08-27T14:00:00.000Z', created_at: '2026-08-26T14:00:00.000Z' }) as OptionsEntryPolicy
const route = (connection: OptionsConnection, rules: OptionsEntryPolicy): OptionsAutomationRoute => sum({ route_schema_version: OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION,
  route_id: 'route-one', revision: 1, display_name: 'SPY trader', guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null,
  author_id: 'author-one', connection_id: connection.connection_id, connection_checksum: connection.content_checksum, account_id: connection.account_ref,
  provider: connection.provider, environment: connection.environment, policy_id: rules.policy_id, policy_revision: rules.revision,
  policy_checksum: rules.content_checksum, required_certification: 'options-paper-autopilot-certified' as const, state: 'draft' as const,
  created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z' }) as OptionsAutomationRoute

describe('options autopilot activation review', () => {
  test('binds custody evidence, requires the exact review, and retries after route persistence', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-auto-activation-')); roots.push(root)
    const connection = account(); const app = application(connection); const cert = await certification(root, connection, app)
    const automation = new FileOptionsAutomationStore(root); const rules = policy(); const source = route(connection, rules)
    await automation.savePolicy(rules); await automation.saveRoute(source)
    const certifications = new FileOptionsAutopilotCertificationStore(root); await certifications.save(cert)
    const authorities = new FileOptionsAutopilotAuthorityStore(root, () => '2026-08-26T14:30:00.000Z')
    const applications = { getActive: async () => app } as unknown as FileOptionsCertificationApplicationStore
    const service = new OptionsAutopilotActivationService(root, automation, authorities, certifications, applications,
      async () => connection, () => '2026-08-26T14:30:00.000Z')
    const review = await service.prepare(source.route_id, '2026-08-26T16:00:00.000Z')
    expect(review.next_policy.expiration_custody).toMatchObject({ provider_calendar_checksum: cert.provider_calendar_checksum,
      account_exercise_setting_checksum: cert.account_exercise_setting_checksum, custody_certification_checksum: cert.custody_certification_checksum })
    await expect(service.commit(review.review_id, 'f'.repeat(64), true)).rejects.toThrow('review changed')
    const authority = await service.commit(review.review_id, review.content_checksum, true)
    expect(authority.route_revision).toBe(2)
    expect((await service.commit(review.review_id, review.content_checksum, true)).authority_id).toBe(authority.authority_id)
  })

  test('refuses expired reviews and changed account evidence without mutating the route', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-auto-activation-')); roots.push(root)
    const connection = account(); const app = application(connection); const cert = await certification(root, connection, app)
    const automation = new FileOptionsAutomationStore(root); const rules = policy(); const source = route(connection, rules)
    await automation.savePolicy(rules); await automation.saveRoute(source)
    const certifications = new FileOptionsAutopilotCertificationStore(root); await certifications.save(cert)
    let now = '2026-08-26T14:30:00.000Z'
    const service = new OptionsAutopilotActivationService(root, automation,
      new FileOptionsAutopilotAuthorityStore(root, () => now), certifications,
      { getActive: async () => app } as unknown as FileOptionsCertificationApplicationStore, async () => connection, () => now)
    const review = await service.prepare(source.route_id, '2026-08-26T16:00:00.000Z')
    now = '2026-08-26T14:33:00.000Z'
    await expect(service.commit(review.review_id, review.content_checksum, true)).rejects.toThrow('expired')
    expect((await automation.getRoute(source.route_id)).revision).toBe(1)
  })
})
