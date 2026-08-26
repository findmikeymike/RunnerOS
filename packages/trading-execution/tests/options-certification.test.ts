import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  optionsConnectionSchema,
  type OptionsCertificationScenario,
  type OptionsConnection,
} from '@trade-god/contracts'

import {
  FileOptionsCertificationStore,
  FileOptionsCertificationJournal,
  runRestrictedOptionsCertification,
  sha256,
  type RestrictedOptionsCertificationRunner,
} from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const connection = (): OptionsConnection => {
  const unsigned = {
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
    connection_id: 'ibkr-options-one',
    provider: 'ibkr' as const,
    environment: 'paper' as const,
    auth_profile: 'ibkr-oauth-access-token' as const,
    adapter_id: 'ibkr-options-api',
    adapter_version: '1.0.0',
    provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26',
    account_ref: 'DU1234567',
    account_label: 'IBKR Paper',
    endpoint: 'https://api.ibkr.com/v1/api',
    credential_ref: 'vault-options-ibkr-options-one',
    credential_generation: 'a'.repeat(64),
    state: 'read-only-verified' as const,
    read_only: true as const,
    execution_enabled: false as const,
    created_at: '2026-08-26T12:00:00.000Z',
    updated_at: '2026-08-26T12:00:00.000Z',
  }
  return optionsConnectionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}

const runner = (blocked?: OptionsCertificationScenario, journalHead = 'b'.repeat(64)): RestrictedOptionsCertificationRunner => ({
  certification_session_id: 'options-cert-session-test',
  connection_id: 'ibkr-options-one',
  account_ref: 'DU1234567',
  provider: 'ibkr',
  environment: 'paper',
  adapter_id: 'ibkr-options-api',
  adapter_version: '1.0.0',
  provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26',
  allowed_contract_id: 'USOPT:SPY:2026-09-18:C:650',
  allowed_provider_instrument_id: '123456789',
  client_order_prefix: 'tgcert-test',
  runScenario: async (scenario) => ({
    status: scenario === blocked ? 'blocked' : 'pass',
    detail: scenario === blocked ? 'Provider capability unavailable.' : `Proved ${scenario}.`,
    evidence: { scenario, exact: true },
  }),
  finalTruth: async () => ({ position_quantity: 0, working_order_count: 0, mutation_count: 4, evidence: { flat: true } }),
  journalHeadChecksum: async () => journalHead,
})

describe('restricted options certification', () => {
  it('ignores retired stored evidence but rejects malformed current evidence', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-certification-')); roots.push(root)
    const directory = path.join(root, 'options-certifications', 'options-connection-one'); await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'retired.json'), JSON.stringify({ certification_schema_version: 'options-certification-evidence@1' }))
    const store = new FileOptionsCertificationStore(root)
    expect(await store.list('options-connection-one')).toEqual([])
    await writeFile(path.join(directory, 'current.json'), JSON.stringify({ certification_schema_version: 'options-certification-evidence@2' }))
    await expect(store.list('options-connection-one')).rejects.toThrow()
  })

  it('grants manual paper eligibility only after every exact scenario and final flat truth', async () => {
    const evidence = await runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, runner(), () => '2026-08-26T12:00:00.000Z')

    expect(evidence.eligible_level).toBe('options-sandbox-entry-certified')
    expect(evidence.scenarios).toHaveLength(11)
    expect(evidence.final_position_quantity).toBe(0)
    expect(evidence.final_working_order_count).toBe(0)
  })

  it('stays ineligible when one scenario is blocked', async () => {
    const evidence = await runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, runner('unknown-submit-contained'), () => '2026-08-26T12:00:00.000Z')
    expect(evidence.eligible_level).toBeNull()
  })

  it('cannot certify a scenario-only run with no provider mutations', async () => {
    const inert = runner()
    inert.finalTruth = async () => ({ position_quantity: 0, working_order_count: 0, mutation_count: 0, evidence: { flat: true } })
    const evidence = await runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, inert, () => '2026-08-26T12:00:00.000Z')
    expect(evidence.eligible_level).toBeNull()
  })

  it('rejects an unbounded debit before the runner is called', async () => {
    let calls = 0
    const uncalled = runner()
    uncalled.runScenario = async (scenario) => {
      calls += 1
      return { status: 'pass', detail: scenario, evidence: { scenario } }
    }
    await expect(runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '1000.01',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, uncalled, () => '2026-08-26T12:00:00.000Z')).rejects.toThrow('$1,000')
    expect(calls).toBe(0)
  })

  it('retains immutable evidence and rejects tampering', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-certification-'))
    roots.push(root)
    const store = new FileOptionsCertificationStore(root)
    const journal = new FileOptionsCertificationJournal(root, 'options-cert-session-test', connection().connection_id)
    const finalFlat = await journal.append('final-flat-zero-orders', 'completed', { flat: true }, '2026-08-26T12:00:00.000Z')
    const evidence = await runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, runner(undefined, finalFlat.content_checksum), () => '2026-08-26T12:00:00.000Z')
    await journal.append('session', 'completed', {
      certification_id: evidence.certification_id,
      certification_checksum: evidence.content_checksum,
    }, '2026-08-26T12:00:01.000Z')
    await store.save(evidence)
    expect((await store.getEligible(connection(), '2026-08-26T12:01:00.000Z'))?.certification_id).toBe(evidence.certification_id)

    const file = path.join(root, 'options-certifications', evidence.connection_id, `${evidence.certification_id}.json`)
    const tampered = JSON.parse(await readFile(file, 'utf8'))
    tampered.max_test_debit = '9999'
    await writeFile(file, JSON.stringify(tampered))
    await expect(store.list(evidence.connection_id)).rejects.toThrow('checksum')
  })

  it('refuses to retain evidence without its exact completed provider journal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-certification-'))
    roots.push(root)
    const evidence = await runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, runner(), () => '2026-08-26T12:00:00.000Z')
    await expect(new FileOptionsCertificationStore(root).save(evidence)).rejects.toThrow('exact completed provider journal')
  })

  it('refuses a runner for a different account before any scenario runs', async () => {
    const wrong = runner()
    Object.defineProperty(wrong, 'account_ref', { value: 'DU7654321' })
    await expect(runRestrictedOptionsCertification({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-27T12:00:00.000Z',
    }, wrong, () => '2026-08-26T12:00:00.000Z')).rejects.toThrow('exact installed account')
  })
})
