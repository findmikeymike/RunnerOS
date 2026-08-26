import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  optionsConnectionSchema,
  type OptionsConnection,
} from '@trade-god/contracts'

import {
  FakeOptionsProvider,
  FileOptionsCertificationJournal,
  FileProviderOptionsCertificationCoordinator,
  sha256,
  type OptionsProviderAdapter,
  type OptionsProviderOrderRequest,
} from '../src/index.ts'

const NOW = '2026-08-26T15:00:00.000Z'
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe('provider options certification runner', () => {
  test('retains an exact one-contract provider lifecycle and finishes flat', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-provider-cert-'))
    roots.push(root)
    const adapter = new CertifyingAdapter()
    const coordinator = new FileProviderOptionsCertificationCoordinator(root, () => NOW, async () => {})
    const evidence = await coordinator.run({
      connection: connection(),
      max_test_debit: '150',
      expires_at: '2026-08-26T15:10:00.000Z',
      contract: { underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' },
      operator_confirmed: true,
    }, adapter)

    expect(evidence.eligible_level).toBe('options-sandbox-entry-certified')
    expect(evidence.mutation_count).toBe(6)
    expect(evidence.final_position_quantity).toBe(0)
    expect(evidence.final_working_order_count).toBe(0)
    expect(adapter.provider.mutationCount).toBe(8)
    const sessionsRoot = path.join(root, 'options-certification-sessions')
    const [sessionId] = await readdir(sessionsRoot)
    expect(sessionId).toStartWith('options-cert-session-')
    const journal = new FileOptionsCertificationJournal(root, sessionId!, connection().connection_id)
    const events = await journal.list()
    expect(events[0]).toMatchObject({ phase: 'started', scenario: 'session', previous_event_checksum: null })
    expect(events.at(-1)).toMatchObject({ phase: 'completed', scenario: 'session' })
    expect(events.some((event) => event.phase === 'mutation-requested')).toBe(true)
  })

  test('rejects tampered journal chains and concurrent account sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-provider-cert-'))
    roots.push(root)
    const coordinator = new FileProviderOptionsCertificationCoordinator(root, () => NOW, async () => {})
    const input = {
      connection: connection(), max_test_debit: '150', expires_at: '2026-08-26T15:10:00.000Z',
      contract: { underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' as const }, operator_confirmed: true as const,
    }
    await coordinator.run(input, new CertifyingAdapter())
    const [sessionId] = await readdir(path.join(root, 'options-certification-sessions'))
    const directory = path.join(root, 'options-certification-sessions', sessionId!)
    const names = (await readdir(directory)).sort()
    const target = path.join(directory, names[1]!)
    const tampered = JSON.parse(await readFile(target, 'utf8'))
    tampered.safe_payload = { forged: true }
    await writeFile(target, JSON.stringify(tampered))
    await expect(new FileOptionsCertificationJournal(root, sessionId!, connection().connection_id).list()).rejects.toThrow('integrity')

    const locks = path.join(root, 'options-certification-locks')
    await writeFile(path.join(locks, `${connection().connection_id}.lock`), 'other-process\n')
    await expect(coordinator.run(input, new CertifyingAdapter())).rejects.toThrow('already active')
  })

  test('rejects unconfirmed, oversized, and mismatched provider sessions before mutation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-provider-cert-'))
    roots.push(root)
    const adapter = new CertifyingAdapter()
    const coordinator = new FileProviderOptionsCertificationCoordinator(root, () => NOW, async () => {})
    const base = {
      connection: connection(), max_test_debit: '150', expires_at: '2026-08-26T15:10:00.000Z',
      contract: { underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' as const }, operator_confirmed: true as const,
    }
    await expect(coordinator.run({ ...base, operator_confirmed: false as true }, adapter)).rejects.toThrow('explicit operator')
    await expect(coordinator.run({ ...base, expires_at: '2026-08-26T15:16:00.000Z' }, adapter)).rejects.toThrow('15 minutes')
    const wrong = new CertifyingAdapter()
    Object.defineProperty(wrong, 'descriptor', { value: { ...wrong.descriptor, credential_generation: 'b'.repeat(64) } })
    await expect(coordinator.run(base, wrong)).rejects.toThrow('exact verified')
    expect(adapter.provider.mutationCount).toBe(0)
  })

  test('rehydrates an interrupted accepted entry from disk and contains it flat', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'options-provider-cert-'))
    roots.push(root)
    const adapter = new CertifyingAdapter()
    const sessionId = 'options-cert-session-recovery'
    const prefix = 'tgcert-recovery'
    const journal = new FileOptionsCertificationJournal(root, sessionId, connection().connection_id)
    await journal.append('session', 'started', {
      connection_checksum: connection().content_checksum,
      client_order_prefix: prefix,
    }, NOW)
    const request: OptionsProviderOrderRequest = {
      account_id: 'DU1234567', canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', provider_instrument_id: '999001',
      action: 'BUY_TO_OPEN', order_type: 'limit', limit_price: '1.30', quantity: 1, time_in_force: 'day',
      regular_hours_only: true, client_order_id: `${prefix}-entry`,
    }
    await journal.append('full-close-no-short-proved', 'mutation-requested', { request }, NOW)
    await adapter.submit(request)
    const locks = path.join(root, 'options-certification-locks')
    await mkdir(locks, { recursive: true })
    await writeFile(path.join(locks, `${connection().connection_id}.lock`), 'crashed-process\n')

    const coordinator = new FileProviderOptionsCertificationCoordinator(root, () => NOW, async () => {})
    expect(await coordinator.recoverIncompleteSessions(connection(), adapter, true)).toBe(1)
    expect((await adapter.snapshotAccount('DU1234567')).positions).toEqual([])
    expect((await journal.list()).at(-1)).toMatchObject({
      scenario: 'session', phase: 'failed', safe_payload: { recovered_flat: true },
    })
  })
})

class CertifyingAdapter implements OptionsProviderAdapter {
  readonly descriptor = {
    adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
    provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26', environment: 'paper' as const,
    credential_generation: 'a'.repeat(64), preview_supported: true as const,
  }
  readonly provider = new FakeOptionsProvider()

  constructor() {
    const contractBody = {
      contract_schema_version: OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
      canonical_id: 'USOPT:SPY:2026-09-18:C:650', underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call',
      currency: 'USD', asset_class: 'US_LISTED_OPTION', multiplier: 100, standard_deliverable: true,
      provider: 'ibkr', provider_instrument_id: '999001', provider_symbol: 'SPY260918C00650000', listing_eligible: true,
      smart_routing_eligible: true, minimum_tick: '0.01', increment_bands: [{ minimum_price: '0', increment: '0.01' }], resolved_at: NOW,
    }
    const contract = optionContractIdentitySchema.parse({ ...contractBody, content_checksum: sha256(contractBody) })
    this.provider.addContract(contract)
    const quoteBody = {
      quote_schema_version: OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
      quote_id: 'cert-quote', connection_id: 'ibkr-options-one', account_id: 'DU1234567',
      canonical_contract_id: contract.canonical_id, provider_instrument_id: contract.provider_instrument_id,
      environment: 'paper', market_data_mode: 'realtime', bid: '1.27', ask: '1.30', bid_size: 30, ask_size: 22,
      provider_timestamp: NOW, received_at: NOW, decision_at: NOW, quote_age_ms: 0, delayed: false, indicative: false,
      halted: false, minimum_tick: '0.01', provenance: 'certifying-adapter',
    }
    this.provider.setQuote(optionQuoteSnapshotSchema.parse({ ...quoteBody, content_checksum: sha256(quoteBody) }))
  }

  resolveContract(query: Parameters<OptionsProviderAdapter['resolveContract']>[0]) { return this.provider.resolveContract(query) }
  quote(contractId: string) { return this.provider.quote(contractId) }
  preview(request: OptionsProviderOrderRequest) { return this.provider.preview(request) }
  async submit(request: OptionsProviderOrderRequest) {
    const order = await this.provider.submit(request)
    if (request.client_order_id.endsWith('-entry') || request.client_order_id.endsWith('-close') || request.client_order_id.endsWith('-recovery')) {
      return this.provider.fill(order.provider_order_id, 1, request.limit_price)
    }
    return order
  }
  submitCertificationUnknown(request: OptionsProviderOrderRequest) { return this.provider.submitCertificationUnknown(request) }
  cancelOrder(accountId: string, providerOrderId: string, clientOrderId: string) {
    return this.provider.cancelOrder(accountId, providerOrderId, clientOrderId)
  }
  getOrderByClientId(accountId: string, clientOrderId: string) { return this.provider.getOrderByClientId(accountId, clientOrderId) }
  snapshotAccount(accountId: string) { return this.provider.snapshotAccount(accountId) }
}

const connection = (): OptionsConnection => {
  const unsigned = {
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
    connection_id: 'ibkr-options-one', provider: 'ibkr' as const, environment: 'paper' as const,
    auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
    provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26', account_ref: 'DU1234567', account_label: 'IBKR Paper',
    endpoint: 'https://api.ibkr.com/v1/api', credential_ref: 'vault-options-ibkr-options-one', credential_generation: 'a'.repeat(64),
    state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
    created_at: NOW, updated_at: NOW,
  }
  return optionsConnectionSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
}
