import { afterEach, describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  optionsConnectionSchema,
  type OptionsConnection,
} from '@trade-god/contracts'

import {
  FileOptionsManualAuthorityStore,
  FileOptionsCertificationStore,
  runRestrictedOptionsCertification,
  sha256,
  type RestrictedOptionsCertificationRunner,
} from '../src/index.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('manual options paper authority', () => {
  it('activates one exact short-lived certified account and revokes append-only', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-authority-'))
    roots.push(root)
    const store = new FileOptionsManualAuthorityStore(root, () => '2026-08-26T12:05:00.000Z')
    const current = connection()
    const certification = await certified(current)
    await new FileOptionsCertificationStore(root).save(certification)
    const authority = await store.activate({
      connection: current,
      certification_id: certification.certification_id,
      max_debit_per_order: '100',
      valid_until: '2026-08-26T13:00:00.000Z',
      operator_confirmed: true,
    })
    expect(await store.getActive(current)).toMatchObject({ authority_id: authority.authority_id, mode: 'manual-confirmed-paper', max_contracts_per_order: 1 })
    const revocation = await store.revoke(authority, 'operator')
    expect(revocation.authority_checksum).toBe(authority.content_checksum)
    expect(await store.getActive(current)).toBeUndefined()
    expect((await store.revoke(authority, 'operator')).revocation_id).toBe(revocation.revocation_id)
  })

  it('refuses certification drift, excess debit, expiry, and concurrent authority', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-authority-'))
    roots.push(root)
    const store = new FileOptionsManualAuthorityStore(root, () => '2026-08-26T12:05:00.000Z')
    const current = connection()
    const certification = await certified(current)
    await new FileOptionsCertificationStore(root).save(certification)
    const { content_checksum: _oldChecksum, ...oldUnsigned } = current
    const driftUnsigned = { ...oldUnsigned, credential_generation: 'b'.repeat(64) }
    const drifted = optionsConnectionSchema.parse({ ...driftUnsigned, content_checksum: sha256(driftUnsigned) })
    await expect(store.activate({ connection: drifted, certification_id: certification.certification_id, max_debit_per_order: '100', valid_until: '2026-08-26T13:00:00.000Z', operator_confirmed: true })).rejects.toThrow('exact current')
    await expect(store.activate({ connection: current, certification_id: certification.certification_id, max_debit_per_order: '151', valid_until: '2026-08-26T13:00:00.000Z', operator_confirmed: true })).rejects.toThrow('certified test debit')
    const input = { connection: current, certification_id: certification.certification_id, max_debit_per_order: '100', valid_until: '2026-08-26T13:00:00.000Z', operator_confirmed: true as const }
    await store.activate(input)
    await expect(store.activate(input)).rejects.toThrow('already has active')
  })

  it('repairs a crashed mutation lock only under explicit single-instance startup authority', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-authority-'))
    roots.push(root)
    const locks = path.join(root, 'options-authorities', 'locks')
    await mkdir(locks, { recursive: true })
    await writeFile(path.join(locks, 'ibkr-options-one.lock'), 'dead\n')
    const store = new FileOptionsManualAuthorityStore(root)
    await expect(store.recoverStaleLocks(false)).rejects.toThrow('single-instance')
    expect(await store.recoverStaleLocks(true)).toBe(1)
  })
})

const connection = (): OptionsConnection => {
  const unsigned = {
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
    connection_id: 'ibkr-options-one', provider: 'ibkr' as const, environment: 'paper' as const,
    auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-read', adapter_version: '0.1.0',
    provider_contract_version: 'ibkr-web-api-read-2026-08-26', account_ref: 'DU1234567', account_label: 'IBKR Paper',
    endpoint: 'https://api.ibkr.com/v1/api', credential_ref: 'vault-options-ibkr-options-one', credential_generation: 'a'.repeat(64),
    state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
    created_at: '2026-08-26T12:00:00.000Z', updated_at: '2026-08-26T12:00:00.000Z',
  }
  return optionsConnectionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}

const certified = (current: OptionsConnection) => runRestrictedOptionsCertification({
  connection: current,
  max_test_debit: '150',
  expires_at: '2026-08-27T12:00:00.000Z',
}, runner(), () => '2026-08-26T12:00:00.000Z')

const runner = (): RestrictedOptionsCertificationRunner => ({
  connection_id: 'ibkr-options-one', account_ref: 'DU1234567', provider: 'ibkr', environment: 'paper',
  adapter_id: 'ibkr-options-read', adapter_version: '0.1.0', provider_contract_version: 'ibkr-web-api-read-2026-08-26',
  allowed_contract_id: 'USOPT:SPY:2026-09-18:C:650', allowed_provider_instrument_id: '123456789', client_order_prefix: 'tgcert-test',
  runScenario: async (scenario) => ({ status: 'pass', detail: `Proved ${scenario}.`, evidence: { scenario } }),
  finalTruth: async () => ({ position_quantity: 0, working_order_count: 0, mutation_count: 4, evidence: { flat: true } }),
})
