import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { OPTIONS_CONNECTION_SCHEMA_VERSION, optionsConnectionSchema, type OptionsConnection } from '@trade-god/contracts'
import {
  FileOptionsCertificationApplicationStore,
  FileOptionsCertificationJournal,
  FileOptionsCertificationStore,
  runRestrictedOptionsCertification,
  sha256,
  type RestrictedOptionsCertificationRunner,
} from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('options certification application', () => {
  it('requires an explicit exact application before an eligible test is installed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-cert-application-'))
    roots.push(root)
    const current = connection()
    const certification = await retainEligible(root, current)
    const store = new FileOptionsCertificationApplicationStore(root, () => '2026-08-26T12:02:00.000Z')
    expect(await store.getActive(current)).toBeUndefined()
    const application = await store.apply({ connection: current, certification_id: certification.certification_id, operator_confirmed: true })
    expect(await store.getActive(current)).toMatchObject({ application_id: application.application_id, certification_id: certification.certification_id })
  })

  it('fails closed on connection drift and a certification that was not retained', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-cert-application-'))
    roots.push(root)
    const current = connection()
    const certification = await retainEligible(root, current)
    const store = new FileOptionsCertificationApplicationStore(root, () => '2026-08-26T12:02:00.000Z')
    const { content_checksum: _checksum, ...unsigned } = current
    const driftUnsigned = { ...unsigned, credential_generation: 'd'.repeat(64) }
    const drifted = optionsConnectionSchema.parse({ ...driftUnsigned, content_checksum: sha256(driftUnsigned) })
    await expect(store.apply({ connection: drifted, certification_id: certification.certification_id, operator_confirmed: true })).rejects.toThrow('not eligible')
    await expect(store.apply({ connection: current, certification_id: 'options-cert-missing', operator_confirmed: true })).rejects.toThrow('not eligible')
  })
})

const retainEligible = async (root: string, current: OptionsConnection) => {
  const sessionId = 'options-cert-session-application'
  const journal = new FileOptionsCertificationJournal(root, sessionId, current.connection_id)
  const finalFlat = await journal.append('final-flat-zero-orders', 'completed', { flat: true }, '2026-08-26T12:00:00.000Z')
  const runner: RestrictedOptionsCertificationRunner = {
    certification_session_id: sessionId,
    connection_id: current.connection_id,
    account_ref: current.account_ref,
    provider: current.provider,
    environment: current.environment,
    adapter_id: current.adapter_id,
    adapter_version: current.adapter_version,
    provider_contract_version: current.provider_contract_version,
    allowed_contract_id: 'USOPT:SPY:2026-09-18:C:650',
    allowed_provider_instrument_id: '123456789',
    client_order_prefix: 'tgcert-apply',
    runScenario: async (scenario) => ({ status: 'pass', detail: scenario, evidence: { scenario } }),
    finalTruth: async () => ({ position_quantity: 0, working_order_count: 0, mutation_count: 4, evidence: { flat: true } }),
    journalHeadChecksum: async () => finalFlat.content_checksum,
  }
  const evidence = await runRestrictedOptionsCertification({ connection: current, max_test_debit: '150', expires_at: '2026-08-26T12:30:00.000Z' }, runner, () => '2026-08-26T12:01:00.000Z')
  await journal.append('session', 'completed', { certification_id: evidence.certification_id, certification_checksum: evidence.content_checksum }, '2026-08-26T12:01:01.000Z')
  return new FileOptionsCertificationStore(root).save(evidence)
}

const connection = (): OptionsConnection => {
  const unsigned = {
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
    connection_id: 'ibkr-options-one', provider: 'ibkr' as const, environment: 'paper' as const,
    auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
    provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26', account_ref: 'DU1234567', account_label: 'IBKR Paper',
    endpoint: 'https://api.ibkr.com/v1/api', credential_ref: 'vault-options-ibkr-options-one', credential_generation: 'a'.repeat(64),
    state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
    created_at: '2026-08-26T12:00:00.000Z', updated_at: '2026-08-26T12:00:00.000Z',
  }
  return optionsConnectionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}
