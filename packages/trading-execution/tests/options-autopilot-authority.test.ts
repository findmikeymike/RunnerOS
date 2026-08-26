import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION,
  OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION,
  OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION,
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  OPTIONS_ENTRY_POLICY_SCHEMA_VERSION,
  optionsAutopilotCertificationScenarioSchema,
  type OptionsAutomationRoute,
  type OptionsAutopilotCertificationEvidence,
  type OptionsCertificationApplication,
  type OptionsConnection,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'
import { FileOptionsAutopilotAuthorityStore, FileOptionsAutopilotCertificationStore, sha256 } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const sum = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })
const a = 'a'.repeat(64); const b = 'b'.repeat(64); const c = 'c'.repeat(64)

const connection = (): OptionsConnection => sum({
  connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION, connection_id: 'options-connection-one', provider: 'ibkr' as const,
  environment: 'paper' as const, auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
  provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26', account_ref: 'DU1234567', account_label: 'IBKR Paper',
  endpoint: 'https://api.ibkr.com/v1/api', credential_ref: 'options-credential-one', credential_generation: a,
  state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
  created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z',
}) as OptionsConnection

const application = (account: OptionsConnection): OptionsCertificationApplication => sum({
  application_schema_version: OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION, application_id: 'base-application-one',
  connection_id: account.connection_id, connection_checksum: account.content_checksum, credential_generation: account.credential_generation,
  certification_id: 'base-certification-one', certification_checksum: b, certification_expires_at: '2026-08-27T14:00:00.000Z',
  provider: account.provider, environment: account.environment, account_ref: account.account_ref, adapter_id: account.adapter_id,
  adapter_version: account.adapter_version, provider_contract_version: account.provider_contract_version,
  applied_at: '2026-08-26T14:01:00.000Z', operator_confirmed: true as const,
}) as OptionsCertificationApplication

const certification = (account: OptionsConnection, app: OptionsCertificationApplication, lifecycles = 50): OptionsAutopilotCertificationEvidence => {
  const eligible = lifecycles >= 50
  return sum({
    certification_schema_version: OPTIONS_AUTOPILOT_CERTIFICATION_SCHEMA_VERSION, certification_id: `autopilot-certification-${lifecycles}`,
    connection_id: account.connection_id, connection_checksum: account.content_checksum, credential_generation: account.credential_generation,
    provider: account.provider, environment: account.environment, account_id: account.account_ref, adapter_id: account.adapter_id,
    adapter_version: account.adapter_version, provider_contract_version: account.provider_contract_version,
    base_certification_id: app.certification_id, base_certification_checksum: app.certification_checksum,
    base_application_id: app.application_id, base_application_checksum: app.content_checksum,
    started_at: '2026-08-26T14:02:00.000Z', completed_at: '2026-08-26T14:20:00.000Z', expires_at: '2026-08-27T14:00:00.000Z',
    scenarios: optionsAutopilotCertificationScenarioSchema.options.map((scenario) => ({
      scenario, status: 'pass' as const, evidence_checksum: sha256({ scenario }), detail: `Proved ${scenario}.`, observed_at: '2026-08-26T14:20:00.000Z',
    })),
    completed_lifecycle_count: lifecycles, provider_automatic_close_certified: true, provider_do_not_exercise_certified: true,
    final_position_quantity: 0, final_working_order_count: 0,
    eligible_level: eligible ? 'options-paper-autopilot-certified' as const : null,
  }) as OptionsAutopilotCertificationEvidence
}

const policy = (certChecksum: string): OptionsEntryPolicy => sum({
  policy_schema_version: OPTIONS_ENTRY_POLICY_SCHEMA_VERSION, policy_id: 'options-policy-one', revision: 1,
  max_signal_age_ms: 30_000, max_ingest_delay_ms: 5_000, regular_session_only: true as const,
  entry_window: { earliest: '09:35', latest: '15:00', timezone: 'America/New_York' as const }, allowed_weekdays: [1, 2, 3, 4, 5],
  min_days_to_expiration: 1, max_days_to_expiration: 60, max_quote_age_ms: 1_000, min_bid_size: 1, min_ask_size: 1,
  max_spread_abs: '0.10', max_spread_pct: '10', spread_gate_mode: 'both' as const, max_chase_abs: '0.10', max_chase_pct: '8',
  max_favorable_retrace_pct: '20', tight_spread_action: 'marketable_limit' as const, wide_spread_action: 'skip' as const,
  passive_limit_offset_abs: '0.01', working_order_ttl_ms: 10_000, max_reprice_attempts: 0, reprice_interval_ms: 1_000,
  cancel_at_signal_expiry: true, sizing: { mode: 'fixed_contracts' as const, fixed_contracts: 1 }, max_contracts_per_order: 1,
  max_debit_per_trade: '150', max_aggregate_open_debit: '150', max_daily_debit_initiated: '150', max_open_positions: 1 as const,
  max_active_positions_per_source: 1 as const, source_quantity_behavior: 'ignore' as const, duplicate_contract_policy: 'block' as const,
  expiration_custody: { provider_calendar_checksum: a, account_exercise_setting_checksum: c,
    no_new_entry_minutes_before_close: 60, automatic_close_start_minutes_before_close: 45, operator_escalation_minutes_before_close: 30,
    do_not_exercise_mode: 'provider-supported' as const, custody_certification_checksum: certChecksum },
  environment: 'paper' as const, provider_slug: 'ibkr', adapter_id: 'ibkr-options-api',
  required_certification: 'options-paper-autopilot-certified', certification_checksum: certChecksum,
  connection_id: 'options-connection-one', account_id: 'DU1234567', source_route_id: 'options-route-one',
  global_halt_required: true as const, account_halt_required: true as const, source_halt_required: true as const,
  mandate_expires_at: '2026-08-26T16:00:00.000Z', created_at: '2026-08-26T14:20:00.000Z',
}) as OptionsEntryPolicy

const route = (account: OptionsConnection, rules: OptionsEntryPolicy): OptionsAutomationRoute => sum({
  route_schema_version: OPTIONS_AUTOMATION_ROUTE_SCHEMA_VERSION, route_id: rules.source_route_id, revision: 1, display_name: 'SPY Options Trader',
  guild_id: 'guild-one', channel_id: 'channel-one', thread_id: null, author_id: 'author-one', connection_id: account.connection_id,
  connection_checksum: account.content_checksum, account_id: account.account_ref, provider: account.provider, environment: account.environment,
  policy_id: rules.policy_id, policy_revision: rules.revision, policy_checksum: rules.content_checksum,
  required_certification: 'options-paper-autopilot-certified' as const, state: 'paused' as const,
  created_at: '2026-08-26T14:20:00.000Z', updated_at: '2026-08-26T14:20:00.000Z',
}) as OptionsAutomationRoute

describe('options autopilot authority', () => {
  test('activates and revokes one exact route only with complete retained provider proof', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-autopilot-authority-')); roots.push(root)
    const account = connection(); const app = application(account); const cert = certification(account, app); const rules = policy(cert.content_checksum); const source = route(account, rules)
    await new FileOptionsAutopilotCertificationStore(root).save(cert)
    const store = new FileOptionsAutopilotAuthorityStore(root, () => '2026-08-26T14:30:00.000Z')
    const authority = await store.activate({ route: source, policy: rules, connection: account, base_application: app,
      valid_until: '2026-08-26T15:30:00.000Z', operator_confirmed: true })
    expect(await store.getActive(source, rules, account)).toMatchObject({ authority_id: authority.authority_id, mode: 'automatic-paper' })
    await store.revoke(authority, 'operator')
    expect(await store.getActive(source, rules, account)).toBeUndefined()
  })

  test('refuses incomplete lifecycle evidence and route or policy drift', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-autopilot-authority-')); roots.push(root)
    const account = connection(); const app = application(account); const incomplete = certification(account, app, 49)
    await new FileOptionsAutopilotCertificationStore(root).save(incomplete)
    const store = new FileOptionsAutopilotAuthorityStore(root, () => '2026-08-26T14:30:00.000Z')
    const rules = policy(incomplete.content_checksum); const source = route(account, rules)
    await expect(store.activate({ route: source, policy: rules, connection: account, base_application: app,
      valid_until: '2026-08-26T15:30:00.000Z', operator_confirmed: true })).rejects.toThrow('certification is unavailable')

    const cert = certification(account, app); await new FileOptionsAutopilotCertificationStore(root).save(cert)
    const validRules = policy(cert.content_checksum); const exactRoute = route(account, validRules)
    const routeBody = { ...exactRoute, connection_checksum: c, content_checksum: undefined }; delete (routeBody as { content_checksum?: string }).content_checksum
    await expect(store.activate({ route: sum(routeBody) as OptionsAutomationRoute, policy: validRules, connection: account, base_application: app,
      valid_until: '2026-08-26T15:30:00.000Z', operator_confirmed: true })).rejects.toThrow('does not bind')
  })

  test('serializes activation and blocks a new revision until the prior lineage is revoked', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-autopilot-authority-')); roots.push(root)
    const account = connection(); const app = application(account); const cert = certification(account, app); const rules = policy(cert.content_checksum); const source = route(account, rules)
    await new FileOptionsAutopilotCertificationStore(root).save(cert)
    const store = new FileOptionsAutopilotAuthorityStore(root, () => '2026-08-26T14:30:00.000Z')
    const input = { route: source, policy: rules, connection: account, base_application: app,
      valid_until: '2026-08-26T15:30:00.000Z', operator_confirmed: true as const }
    const outcomes = await Promise.allSettled([store.activate(input), store.activate(input)])
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const rulesBody = { ...rules, revision: 2, content_checksum: undefined }; delete (rulesBody as { content_checksum?: string }).content_checksum
    const rulesV2 = sum(rulesBody) as OptionsEntryPolicy
    const routeBody = { ...source, revision: 2, policy_revision: 2, policy_checksum: rulesV2.content_checksum,
      updated_at: '2026-08-26T14:31:00.000Z', content_checksum: undefined }; delete (routeBody as { content_checksum?: string }).content_checksum
    await expect(store.activate({ ...input, route: sum(routeBody) as OptionsAutomationRoute, policy: rulesV2 }))
      .rejects.toThrow('revoke it before changing revisions')
  })
})
