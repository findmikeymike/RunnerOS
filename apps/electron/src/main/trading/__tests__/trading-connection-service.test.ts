import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  TRADING_CONNECTION_SCHEMA_VERSION,
  type TradingConnection,
} from '@trade-god/contracts'
import { FileTradingConnectionStore } from '@trade-god/execution'

import {
  TradingConnectionService,
  browserSessionRef,
  credentialRef,
  secretName,
  type TradingBrowserSessionLauncher,
  type TradingCredentialVault,
} from '../trading-connection-service.ts'

const roots: string[] = []
const NOW = '2026-07-30T15:05:00.000Z'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

class Vault implements TradingCredentialVault {
  readonly values = new Map<string, string>()
  async getSecret(name: string) { return this.values.get(name) ?? null }
  async setSecret(name: string, value: string) { this.values.set(name, value) }
  async deleteSecret(name: string) { return this.values.delete(name) }
}

class Browser implements TradingBrowserSessionLauncher {
  lastInput: Parameters<TradingBrowserSessionLauncher['open']>[0] | null = null
  async open(input: Parameters<TradingBrowserSessionLauncher['open']>[0]) {
    this.lastInput = input
    return { browser_instance_id: 'browser-trade-1', session_ref: input.sessionRef }
  }
}

const capabilities = {
  read_accounts: false,
  read_orders: false,
  read_positions: false,
  read_executions: false,
  submit_market: false,
  submit_limit: false,
  submit_stop: false,
  submit_stop_limit: false,
  native_bracket: false,
  native_oco: false,
  modify_order: false,
  cancel_order: false,
  partial_close: false,
  flatten: false,
  streaming_events: false,
}

const connection = (
  transport: TradingConnection['transport_preference'],
): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: `connection-apex-${transport}`,
  display_name: `Apex ${transport}`,
  firm: { slug: 'apex', name: 'Apex Trader Funding' },
  platform: transport === 'browser'
    ? { slug: 'wealthcharts', name: 'WealthCharts' }
    : { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: transport,
  account_ref: `account-apex-${transport}`,
  account_display: { label: `APEX-${transport}` },
  ...(transport !== 'browser' ? { credential_ref: 'renderer-must-not-control-ref' } : {}),
  ...(transport !== 'api' ? { browser_session_ref: 'renderer-must-not-control-session' } : {}),
  risk_policy_ref: 'risk-policy-paper',
  authorization_basis_ref: 'authorization-basis-apex',
  approval_policy_ref: 'approval-policy-paper',
  state: 'auth-required',
  capabilities,
  certifications: [],
  enabled: false,
  created_at: NOW,
  updated_at: NOW,
})

const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-god-connection-service-'))
  roots.push(root)
  const vault = new Vault()
  const browser = new Browser()
  const service = new TradingConnectionService(
    new FileTradingConnectionStore(root, () => NOW),
    vault,
    browser,
  )
  return { service, vault, browser }
}

describe('trading connection service', () => {
  test('stores API secret in the vault and returns only its opaque reference', async () => {
    const { service, vault } = await setup()
    const saved = await service.save({ connection: connection('api'), api_secret: 'top-secret' })

    expect(saved.connection.credential_ref).toBe(credentialRef(saved.connection.connection_id))
    expect(saved.credential_configured).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('top-secret')
    expect(vault.values.get(secretName(saved.connection.connection_id))).toBe('top-secret')
  })

  test('refuses an API connection without an existing or newly supplied secret', async () => {
    const { service } = await setup()
    await expect(service.save({ connection: connection('api') }))
      .rejects.toThrow('requires credentials')
  })

  test('does not rotate a secret when metadata validation rejects an identity change', async () => {
    const { service, vault } = await setup()
    const original = connection('api')
    await service.save({ connection: original, api_secret: 'original-secret' })

    await expect(service.save({
      connection: {
        ...original,
        account_ref: 'different-account',
        account_display: { label: 'APEX-DIFFERENT' },
      },
      api_secret: 'replacement-secret',
    })).rejects.toThrow('identity are immutable')

    expect(vault.values.get(secretName(original.connection_id))).toBe('original-secret')
  })

  test('opens WealthCharts in a dedicated persistent trading partition', async () => {
    const { service, browser } = await setup()
    const saved = await service.save({ connection: connection('browser') })
    const opened = await service.openBrowserLogin(saved.connection.connection_id)

    expect(opened.session_ref).toBe(browserSessionRef(saved.connection.connection_id))
    expect(browser.lastInput).toMatchObject({
      partition: `persist:${browserSessionRef(saved.connection.connection_id)}`,
      url: 'https://www.wealthcharts.com/',
    })
    expect(browser.lastInput?.partition).not.toContain('social')
  })

  test('deletes connection metadata and its vault secret together', async () => {
    const { service, vault } = await setup()
    const saved = await service.save({ connection: connection('api'), api_secret: 'top-secret' })
    expect(await service.remove(saved.connection.connection_id)).toBe(true)
    expect(vault.values.has(secretName(saved.connection.connection_id))).toBe(false)
    expect(await service.list()).toEqual([])
  })
})
