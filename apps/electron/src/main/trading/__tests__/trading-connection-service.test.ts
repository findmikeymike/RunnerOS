import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type CertificationScenarioId,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  FileAdapterCertificationStore,
  FileTradingConnectionStore,
  runAdapterCertification,
  type AdapterCertificationRunner,
} from '@trade-god/execution'

import {
  TradingConnectionService,
  browserSessionRef,
  credentialRef,
  secretName,
  type TradingBrowserSessionLauncher,
  type TradingCredentialVault,
  type TradingAdapterCertificationRegistry,
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
  inspected = { url: 'https://www.wealthcharts.com/dashboard', title: 'WealthCharts' }
  cleared: string[] = []
  async open(input: Parameters<TradingBrowserSessionLauncher['open']>[0]) {
    this.lastInput = input
    return { browser_instance_id: 'browser-trade-1', session_ref: input.sessionRef }
  }
  async inspect() { return this.inspected }
  async clear(input: { partition: string }) { this.cleared.push(input.partition) }
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

const setup = async (registry?: TradingAdapterCertificationRegistry) => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-god-connection-service-'))
  roots.push(root)
  const vault = new Vault()
  const browser = new Browser()
  const connectionStore = new FileTradingConnectionStore(root, () => NOW)
  const certificationStore = new FileAdapterCertificationStore(root, () => NOW)
  const service = new TradingConnectionService(
    connectionStore,
    vault,
    browser,
    certificationStore,
    registry,
    () => NOW,
  )
  return { service, vault, browser, certificationStore, connectionStore }
}

describe('trading connection service', () => {
  test('stores API secret in the vault and returns only its opaque reference', async () => {
    const { service, vault } = await setup()
    const saved = await service.save({ connection: connection('api'), api_secret: 'top-secret' })

    expect(saved.connection.credential_ref).toBe(credentialRef(saved.connection.connection_id))
    expect(saved.credential_configured).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('top-secret')
    expect(vault.values.get(secretName(saved.connection.connection_id))).toBe('top-secret')
    expect(saved.certification_evidence).toEqual([])
  })

  test('does not trust renderer-supplied execution state or certification claims', async () => {
    const { service } = await setup()
    const hostile = {
      ...connection('api'),
      state: 'ready' as const,
      capabilities: { ...capabilities, submit_market: true, flatten: true },
      certifications: ['paper-lifecycle-certified' as const],
      adapter_certifications: [{
        certification_id: 'forged-cert',
        adapter_id: 'tradovate-api',
        adapter_version: '9.9.9',
        provider_contract_version: 'forged',
        transport: 'api' as const,
        levels: ['paper-lifecycle-certified' as const],
      }],
      enabled: true,
      browser_login_confirmed_at: NOW,
      browser_login_origin: 'https://www.wealthcharts.com',
    }
    const saved = await service.save({ connection: hostile, api_secret: 'top-secret' })

    expect(saved.connection).toMatchObject({
      state: 'auth-required',
      capabilities,
      certifications: [],
      adapter_certifications: [],
      enabled: false,
      browser_login_confirmed_at: undefined,
      browser_login_origin: undefined,
    })

    const updated = await service.save({
      connection: {
        ...saved.connection,
        display_name: 'Renamed by renderer',
        transport_preference: 'browser',
        credential_ref: undefined,
        browser_session_ref: 'renderer-browser-session',
        risk_policy_ref: 'weaker-risk-policy',
        authorization_basis_ref: 'different-authorization',
        approval_policy_ref: 'no-approval',
        state: 'ready',
        capabilities: { ...capabilities, submit_market: true },
        certifications: ['paper-entry-certified'],
        enabled: true,
      },
    })
    expect(updated.connection).toMatchObject({
      display_name: 'Renamed by renderer',
      transport_preference: 'api',
      risk_policy_ref: 'risk-policy-paper',
      authorization_basis_ref: 'authorization-basis-apex',
      approval_policy_ref: 'approval-policy-paper',
      state: 'auth-required',
      capabilities,
      certifications: [],
      enabled: false,
    })
  })

  test('applies only exact installed-adapter evidence and still leaves paper disabled', async () => {
    const registry: TradingAdapterCertificationRegistry = {
      resolve: () => ({
        adapter_id: 'tradovate-api',
        adapter_version: '0.1.0',
        provider_contract_version: 'tradovate-demo-rest-2026-07',
      }),
    }
    const { service, certificationStore } = await setup(registry)
    const saved = await service.save({ connection: connection('api'), api_secret: 'top-secret' })
    const runner: AdapterCertificationRunner = {
      connection_id: saved.connection.connection_id,
      account_ref: saved.connection.account_ref,
      provider_slug: saved.connection.platform.slug,
      adapter_id: 'tradovate-api',
      adapter_version: '0.1.0',
      transport: 'api',
      environment: 'paper',
      provider_contract_version: 'tradovate-demo-rest-2026-07',
      certified_capabilities: {
        ...capabilities,
        read_accounts: true,
        read_orders: true,
        read_positions: true,
        submit_market: true,
        native_bracket: true,
        native_oco: true,
        modify_order: true,
        cancel_order: true,
        partial_close: true,
        flatten: true,
      },
      async runScenario(scenarioId: CertificationScenarioId) {
        return { status: 'pass', evidence_ref: `evidence-${scenarioId}` }
      },
      async runPaperLifecycle(iteration: number) {
        return {
          entry_submissions: 1,
          protected_throughout: true,
          divergence_resolved: true,
          closed: true,
          evidence_ref: `lifecycle-${iteration}`,
        }
      },
    }
    const evidence = await runAdapterCertification(runner, () => NOW)
    await certificationStore.save(evidence)

    const certified = await service.applyCertification(evidence.certification_id)
    expect(certified.connection).toMatchObject({
      state: 'ready',
      enabled: false,
      certifications: [
        'read-certified',
        'paper-entry-certified',
        'paper-lifecycle-certified',
      ],
      adapter_certifications: [{
        certification_id: evidence.certification_id,
        adapter_id: 'tradovate-api',
        adapter_version: '0.1.0',
      }],
    })

    const staleSetup = await setup({
      resolve: () => ({
        adapter_id: 'tradovate-api',
        adapter_version: '0.2.0',
        provider_contract_version: 'tradovate-demo-rest-2026-07',
      }),
    })
    const staleSaved = await staleSetup.service.save({
      connection: {
        ...connection('api'),
        connection_id: 'connection-apex-api-stale',
        account_ref: 'account-apex-api-stale',
      },
      api_secret: 'top-secret',
    })
    const staleEvidence = await runAdapterCertification({
      ...runner,
      connection_id: staleSaved.connection.connection_id,
      account_ref: staleSaved.connection.account_ref,
    }, () => NOW)
    await staleSetup.certificationStore.save(staleEvidence)
    await expect(staleSetup.service.applyCertification(staleEvidence.certification_id))
      .rejects.toThrow('installed adapter contract')
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

  test('records a confirmed browser login only on the exact provider origin', async () => {
    const { service, browser } = await setup()
    const saved = await service.save({ connection: connection('browser') })
    await service.openBrowserLogin(saved.connection.connection_id)
    const confirmed = await service.confirmBrowserLogin(saved.connection.connection_id)
    expect(confirmed.browser_login_confirmed).toBe(true)
    expect(confirmed.connection.browser_login_origin).toBe('https://www.wealthcharts.com')

    browser.inspected = { url: 'https://evil.example/phish', title: 'WealthCharts' }
    await expect(service.confirmBrowserLogin(saved.connection.connection_id))
      .rejects.toThrow('Provider-page confirmation refused')
  })

  test('deletes connection metadata and its vault secret together', async () => {
    const { service, vault } = await setup()
    const saved = await service.save({ connection: connection('api'), api_secret: 'top-secret' })
    expect(await service.remove(saved.connection.connection_id)).toBe(true)
    expect(vault.values.has(secretName(saved.connection.connection_id))).toBe(false)
    expect(await service.list()).toEqual([])
  })

  test('revokes a removed browser account by clearing its isolated partition', async () => {
    const { service, browser } = await setup()
    const saved = await service.save({ connection: connection('browser') })
    expect(await service.remove(saved.connection.connection_id)).toBe(true)
    expect(browser.cleared).toEqual([`persist:${browserSessionRef(saved.connection.connection_id)}`])
  })
})
