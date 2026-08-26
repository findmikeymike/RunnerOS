import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION, OPTIONS_CONNECTION_SCHEMA_VERSION,
  type OptionsCertificationApplication, type OptionsConnection,
} from '@trade-god/contracts'
import {
  FileOptionsAutopilotCertificationJournal, FileOptionsAutopilotCertificationStore,
  runRestrictedOptionsAutopilotCertification, sha256, type RestrictedOptionsAutopilotCertificationRunner,
} from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))
const sum = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })
const generation = 'a'.repeat(64)
const connection = (): OptionsConnection => sum({ connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
  connection_id: 'account-one', provider: 'ibkr' as const, environment: 'paper' as const,
  auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
  provider_contract_version: 'ibkr-options-paper-2026-08', account_ref: 'DU1', account_label: 'Paper',
  endpoint: 'https://api.ibkr.com', credential_ref: 'credential-one', credential_generation: generation,
  state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
  created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z' }) as OptionsConnection
const application = (account: OptionsConnection): OptionsCertificationApplication => sum({
  application_schema_version: OPTIONS_CERTIFICATION_APPLICATION_SCHEMA_VERSION, application_id: 'application-one',
  connection_id: account.connection_id, connection_checksum: account.content_checksum, credential_generation: account.credential_generation,
  certification_id: 'base-cert-one', certification_checksum: 'b'.repeat(64), certification_expires_at: '2026-08-27T14:00:00.000Z',
  provider: account.provider, environment: account.environment, account_ref: account.account_ref, adapter_id: account.adapter_id,
  adapter_version: account.adapter_version, provider_contract_version: account.provider_contract_version,
  applied_at: '2026-08-26T14:01:00.000Z', operator_confirmed: true as const }) as OptionsCertificationApplication

const runner = (lifecycles = 50): RestrictedOptionsAutopilotCertificationRunner => ({
  certification_session_id: `autopilot-session-${lifecycles}`, connection_id: 'account-one',
  runScenario: async (scenario) => ({ status: 'pass', detail: `Proved ${scenario}`, evidence: { scenario } }),
  cleanLifecycles: async () => Array.from({ length: lifecycles }, (_, index) => ({ lifecycle_id: `lifecycle-${index + 1}`,
    completed_at: '2026-08-26T14:20:00.000Z', evidence: { index } })),
  custodyTruth: async () => ({ provider_automatic_close_certified: true, provider_do_not_exercise_certified: true,
    provider_calendar_evidence: { calendar: 1 }, account_exercise_setting_evidence: { setting: 1 }, custody_certification_evidence: { custody: 1 } }),
  finalTruth: async () => ({ position_quantity: 0, working_order_count: 0, evidence: { flat: true } }),
})

describe('restricted options autopilot certification collector', () => {
  test('retains every scenario and 50 unique provider lifecycles before eligibility', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-auto-cert-')); roots.push(root)
    const account = connection(); const app = application(account); const exactRunner = runner()
    const journal = new FileOptionsAutopilotCertificationJournal(root, exactRunner.certification_session_id, account.connection_id)
    const evidence = await runRestrictedOptionsAutopilotCertification({ connection: account, base_application: app,
      expires_at: '2026-08-27T13:00:00.000Z' }, exactRunner, journal, () => '2026-08-26T14:20:00.000Z')
    expect(evidence).toMatchObject({ eligible_level: 'options-paper-autopilot-certified', completed_lifecycle_count: 50,
      final_position_quantity: 0, final_working_order_count: 0 })
    expect((await journal.list()).map((event) => event.kind)).toEqual([
      'session', ...Array.from({ length: 13 }, () => 'scenario'), ...Array.from({ length: 50 }, () => 'lifecycle'), 'custody', 'final-truth',
    ])
    expect((await new FileOptionsAutopilotCertificationStore(root).save(evidence)).content_checksum).toBe(evidence.content_checksum)
  })

  test('keeps incomplete evidence ineligible and refuses a journal-head substitution', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-auto-cert-')); roots.push(root)
    const account = connection(); const app = application(account); const incomplete = runner(49)
    const journal = new FileOptionsAutopilotCertificationJournal(root, incomplete.certification_session_id, account.connection_id)
    const evidence = await runRestrictedOptionsAutopilotCertification({ connection: account, base_application: app,
      expires_at: '2026-08-27T13:00:00.000Z' }, incomplete, journal, () => '2026-08-26T14:20:00.000Z')
    expect(evidence.eligible_level).toBeNull()
    const tampered = { ...evidence, journal_head_checksum: 'f'.repeat(64), content_checksum: '' }
    tampered.content_checksum = sha256(Object.fromEntries(Object.entries(tampered).filter(([key]) => key !== 'content_checksum')))
    await expect(new FileOptionsAutopilotCertificationStore(root).save(tampered)).rejects.toThrow('retained provider journal')
    const mismatched = { ...evidence, scenarios: evidence.scenarios.map((item, index) => index === 0
      ? { ...item, evidence_checksum: 'e'.repeat(64) } : item), content_checksum: '' }
    mismatched.content_checksum = sha256(Object.fromEntries(Object.entries(mismatched).filter(([key]) => key !== 'content_checksum')))
    await expect(new FileOptionsAutopilotCertificationStore(root).save(mismatched)).rejects.toThrow('retained provider journal')
  })
})
