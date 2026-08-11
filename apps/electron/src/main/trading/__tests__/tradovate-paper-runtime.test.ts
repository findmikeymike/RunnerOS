import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  TRADING_CONNECTION_SCHEMA_VERSION,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  FileTradingConnectionStore,
  parseTradovateCredential,
  serializeTradovateCredential,
} from '@trade-god/execution'

import { credentialRef, secretName, type TradingCredentialVault } from '../trading-connection-service.ts'
import { createTradovatePaperRuntime } from '../tradovate-paper-runtime.ts'

const NOW = '2026-08-11T15:05:00.000Z'
const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

class Vault implements TradingCredentialVault {
  values = new Map<string, string>()
  casCount = 0
  async getSecret(name: string) { return this.values.get(name) ?? null }
  async setSecret(name: string, value: string) { this.values.set(name, value) }
  async compareAndSetSecret(name: string, expected: string, value: string) {
    const current = this.values.get(name)
    if (!current || createHash('sha256').update(current).digest('hex') !== expected) return false
    this.values.set(name, value)
    this.casCount += 1
    return true
  }
  async deleteSecret(name: string) { return this.values.delete(name) }
}

const connection = (): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: 'connection-tradovate-paper-runtime',
  display_name: 'Tradovate paper',
  firm: { slug: 'tradovate', name: 'Tradovate' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'api',
  account_ref: '123',
  account_display: { label: 'DEMO-123' },
  credential_ref: credentialRef('connection-tradovate-paper-runtime'),
  risk_policy_ref: 'risk-paper',
  authorization_basis_ref: 'operator',
  approval_policy_ref: 'standing-mandate',
  state: 'auth-required',
  capabilities: {
    read_accounts: false, read_orders: false, read_positions: false, read_executions: false,
    submit_market: false, submit_limit: false, submit_stop: false, submit_stop_limit: false,
    native_bracket: false, native_oco: false, modify_order: false, cancel_order: false,
    partial_close: false, flatten: false, streaming_events: false,
  },
  certifications: [],
  enabled: false,
  created_at: NOW,
  updated_at: NOW,
})

describe('Tradovate paper runtime', () => {
  test('shares one renewable vault session with the exact installed adapter descriptor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'trade-god-tradovate-runtime-'))
    roots.push(root)
    const store = new FileTradingConnectionStore(root, () => NOW)
    const target = connection()
    await store.save(target)
    const vault = new Vault()
    await vault.setSecret(secretName(target.connection_id), serializeTradovateCredential({
      access_token: 'near-expiry-access-token',
      account_id: 123,
      account_spec: 'DEMO-123',
      expires_at: '2026-08-11T15:10:00.000Z',
    }))
    const runtime = createTradovatePaperRuntime({
      connectionStore: store,
      vault,
      now: () => NOW,
      fetch: async (input) => {
        const url = String(input)
        if (url.endsWith('/auth/renewaccesstoken')) return Response.json({
          accessToken: 'renewed-paper-access-token',
          expirationTime: '2026-08-11T16:00:00.000Z',
        })
        if (url.endsWith('/account/list')) return Response.json([{
          id: 123, name: 'DEMO-123', active: true, readonly: false,
        }])
        if (url.endsWith('/cashBalance/getcashbalancesnapshot')) return Response.json({
          netLiq: 50_000, realizedPnL: 0, openPnL: 0,
        })
        if (url.endsWith('/order/list')) return Response.json([])
        if (url.endsWith('/orderVersion/list')) return Response.json([])
        if (url.endsWith('/command/list')) return Response.json([])
        if (url.endsWith('/executionReport/list')) return Response.json([])
        if (url.endsWith('/position/list')) return Response.json([])
        if (url.endsWith('/contract/list')) return Response.json([])
        return new Response('not found', { status: 404 })
      },
    })

    expect(runtime.certificationRegistry.resolve(target)).toEqual({
      adapter_id: 'tradovate-api',
      adapter_version: '1.0.0',
      provider_contract_version: 'tradovate-demo-rest-2026-07',
      capabilities: runtime.adapter.descriptor.capabilities,
    })
    await runtime.adapter.connect(target)
    expect(vault.casCount).toBe(1)
    expect(parseTradovateCredential(vault.values.get(secretName(target.connection_id))!).access_token)
      .toBe('renewed-paper-access-token')
    const verification = await runtime.verifyReadOnly(target)
    expect(verification).toMatchObject({
      connection_id: target.connection_id,
      account_ref: target.account_ref,
      provider_slug: 'tradovate',
      can_trade: true,
      position_count: 0,
      working_order_count: 0,
    })
    expect(JSON.stringify(verification)).not.toContain('renewed-paper-access-token')
    runtime.stop()
    await expect(runtime.adapter.connect(target)).rejects.toMatchObject({ code: 'CONNECTION_UNAVAILABLE' })
  })
})
