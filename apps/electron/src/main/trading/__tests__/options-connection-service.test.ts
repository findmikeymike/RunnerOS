import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  OPTIONS_PROVIDER_READ_PROOF_SCHEMA_VERSION,
  optionsProviderReadProofSchema,
  type OptionsConnection,
  type OptionsProviderReadProof,
} from '@trade-god/contracts'
import { sha256 } from '@trade-god/execution'

import {
  OptionsConnectionService,
  ReadOnlyOptionsProviderVerifier,
  createWebullSignature,
  type OptionsProviderReadVerifier,
} from '../options-connection-service.ts'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const seal = <T extends { content_checksum: string }>(value: T): T => {
  const { content_checksum: _checksum, ...unsigned } = value
  return { ...value, content_checksum: sha256(unsigned) }
}

const createVault = () => {
  const values = new Map<string, string>()
  return {
    values,
    vault: {
      getSecret: async (name: string) => values.get(name) ?? null,
      setSecret: async (name: string, value: string) => { values.set(name, value) },
      compareAndSetSecret: async () => false,
      deleteSecret: async (name: string) => values.delete(name),
    },
  }
}

const proofFor = (connection: OptionsConnection): OptionsProviderReadProof => seal(optionsProviderReadProofSchema.parse({
  proof_schema_version: OPTIONS_PROVIDER_READ_PROOF_SCHEMA_VERSION,
  proof_id: 'proof-options-one',
  connection_id: connection.connection_id,
  connection_checksum: connection.content_checksum,
  credential_generation: connection.credential_generation,
  adapter_id: connection.adapter_id,
  adapter_version: connection.adapter_version,
  provider_contract_version: connection.provider_contract_version,
  provider: connection.provider,
  environment: connection.environment,
  account_ref: connection.account_ref,
  account_label: connection.account_label,
  authenticated: true,
  account_matched: true,
  balances_readable: true,
  positions_readable: true,
  open_orders_readable: true,
  option_contracts_readable: true,
  option_quotes_readable: false,
  option_quotes_realtime: false,
  position_count: 0,
  open_order_count: 0,
  currency: 'USD',
  verified_at: '2026-08-26T12:00:00.000Z',
  expires_at: '2026-08-26T12:10:00.000Z',
  safe_evidence: ['Exact paper account matched'],
  content_checksum: '0'.repeat(64),
}))

describe('OptionsConnectionService', () => {
  it('stores credentials in the vault and exposes only read-only metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-connections-'))
    roots.push(root)
    const { vault, values } = createVault()
    const verifier: OptionsProviderReadVerifier = { verify: async (connection) => proofFor(connection) }
    const service = new OptionsConnectionService(root, vault, verifier, () => '2026-08-26T12:00:00.000Z')

    const saved = await service.save({
      provider: 'ibkr',
      account_ref: 'DU1234567',
      account_label: 'IBKR Paper',
      credential: JSON.stringify({ access_token: 'secret-access-token-value' }),
    })

    expect(saved.connection.read_only).toBe(true)
    expect(saved.connection.execution_enabled).toBe(false)
    expect(saved.provider_read_verified).toBe(false)
    expect(JSON.stringify(saved)).not.toContain('secret-access-token-value')
    expect([...values.values()][0]).toContain('secret-access-token-value')

    const verified = await service.verify(saved.connection.connection_id)
    expect(verified.provider_read_verified).toBe(true)
    expect(verified.provider_read_fresh).toBe(true)
    expect(verified.connection.state).toBe('read-only-verified')
    expect(verified.provider_read_proof?.connection_checksum).toBe(verified.connection.content_checksum)
  })

  it('invalidates retained proof when credentials are replaced and removes secrets', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-connections-'))
    roots.push(root)
    const { vault, values } = createVault()
    const service = new OptionsConnectionService(root, vault, { verify: async (connection) => proofFor(connection) }, () => '2026-08-26T12:00:00.000Z')
    const first = await service.save({
      provider: 'webull',
      account_ref: 'sandbox-1',
      account_label: 'Webull Sandbox',
      credential: JSON.stringify({ app_key: 'app-key-123', app_secret: 'app-secret-value-123456' }),
    })
    await service.verify(first.connection.connection_id)
    const replaced = await service.save({
      connection_id: first.connection.connection_id,
      provider: 'webull',
      account_ref: 'sandbox-1',
      account_label: 'Webull Sandbox',
      credential: JSON.stringify({ app_key: 'app-key-123', app_secret: 'replacement-secret-123456' }),
    })
    expect(replaced.provider_read_verified).toBe(false)
    const retainedProofFiles = await readdir(path.join(root, 'read-proofs', first.connection.connection_id))
    expect(retainedProofFiles.some((name) => name.startsWith('proof-options-one'))).toBe(true)
    expect(retainedProofFiles).not.toContain('active.json')
    expect(await service.remove(first.connection.connection_id)).toBe(true)
    expect(values.size).toBe(0)
  })
})

describe('Webull signature', () => {
  it('matches the official HMAC-SHA1 worked example', () => {
    expect(createWebullSignature({
      pathname: '/trade/place_order',
      query: { a1: 'webull', a2: '123', a3: 'xxx', q1: 'yyy' },
      body: '{"k1":123,"k2":"this is the api request body","k3":true,"k4":{"foo":[1,2]}}',
      appKey: '776da210ab4a452795d74e726ebd74b6',
      appSecret: '0f50a2e853334a9aae1a783bee120c1f',
      host: 'api.webull.com',
      timestamp: '2022-01-04T03:55:31Z',
      nonce: '48ef5afed43d4d91ae514aaeafbc29ba',
    })).toBe('kvlS6opdZDhEBo5jq40nHYXaLvM=')
  })
})

describe('ReadOnlyOptionsProviderVerifier', () => {
  it('uses only the bounded IBKR paper read endpoints and exact account', async () => {
    const requests: Array<{ url: string; method: string }> = []
    const responses: Record<string, unknown> = {
      '/iserver/auth/status': { authenticated: true, connected: true, competing: false },
      '/portfolio/accounts': [{ accountId: 'DU1234567', currency: 'USD' }],
      '/portfolio/DU1234567/positions/0': [],
      '/iserver/account/orders': { orders: [] },
      '/portfolio/DU1234567/summary': { netliquidation: { amount: '100000' } },
    }
    const verifier = new ReadOnlyOptionsProviderVerifier(async (input, init) => {
      const url = new URL(input)
      requests.push({ url: input, method: init?.method ?? 'GET' })
      return { ok: true, status: 200, json: async () => responses[url.pathname.replace('/v1/api', '')] }
    }, () => '2026-08-26T12:00:00.000Z')
    const connection = connectionFor('ibkr', 'DU1234567')

    const proof = await verifier.verify(connection, JSON.stringify({ access_token: 'secret-access-token-value' }))

    expect(proof.account_matched).toBe(true)
    expect(proof.option_contracts_readable).toBe(false)
    expect(requests).toHaveLength(5)
    expect(requests.map(({ url }) => new URL(url).origin)).toEqual(Array(5).fill('https://api.ibkr.com'))
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual([
      '/v1/api/iserver/auth/status',
      '/v1/api/portfolio/accounts',
      '/v1/api/portfolio/DU1234567/positions/0',
      '/v1/api/iserver/account/orders',
      '/v1/api/portfolio/DU1234567/summary',
    ])
    expect(requests.filter(({ method }) => method !== 'GET')).toEqual([
      { url: 'https://api.ibkr.com/v1/api/iserver/auth/status', method: 'POST' },
    ])
  })

  it('uses only signed Webull sandbox reads and rejects a mismatched account', async () => {
    const requests: Array<{ url: string; method: string; headers: Headers }> = []
    const verifier = new ReadOnlyOptionsProviderVerifier(async (input, init) => {
      requests.push({ url: input, method: init?.method ?? 'GET', headers: new Headers(init?.headers) })
      const pathname = new URL(input).pathname
      const body = pathname.endsWith('/accounts/list')
        ? { data: [{ account_id: 'sandbox-other' }] }
        : { data: [] }
      return { ok: true, status: 200, json: async () => body }
    }, () => '2026-08-26T12:00:00.000Z')

    await expect(verifier.verify(
      connectionFor('webull', 'sandbox-1'),
      JSON.stringify({ app_key: 'app-key-123', app_secret: 'app-secret-value-123456' }),
    )).rejects.toThrow('exact configured sandbox account')
    expect(requests).toHaveLength(1)
    expect(new URL(requests[0]!.url).origin).toBe('https://api.sandbox.webull.com')
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.headers.get('x-signature')).toBeTruthy()
  })
})

const connectionFor = (provider: 'ibkr' | 'webull', accountRef: string): OptionsConnection => {
  const adapterId = provider === 'ibkr' ? 'ibkr-options-api' : 'webull-options-api'
  return seal({
    connection_schema_version: 'options-connection@1',
    connection_id: `${provider}-one`,
    provider,
    environment: provider === 'ibkr' ? 'paper' : 'sandbox',
    auth_profile: provider === 'ibkr' ? 'ibkr-oauth-access-token' : 'webull-individual-hmac',
    adapter_id: adapterId,
    adapter_version: '1.0.0',
    provider_contract_version: provider === 'ibkr' ? 'ibkr-web-api-options-paper-2026-08-26' : 'webull-trading-api-options-sandbox-2026-08-26',
    account_ref: accountRef,
    account_label: `${provider} test`,
    endpoint: provider === 'ibkr' ? 'https://api.ibkr.com/v1/api' : 'https://api.sandbox.webull.com',
    credential_ref: `vault-options-${provider}-one`,
    credential_generation: 'a'.repeat(64),
    state: 'credentials-saved',
    read_only: true,
    execution_enabled: false,
    created_at: '2026-08-26T12:00:00.000Z',
    updated_at: '2026-08-26T12:00:00.000Z',
    content_checksum: '0'.repeat(64),
  })
}
