import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  OPTIONS_CONNECTION_SCHEMA_VERSION,
  OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION,
  type OptionContractIdentity,
  type OptionsConnection,
  type OptionsManualPaperAuthority,
} from '@trade-god/contracts'

import {
  FakeOptionsProvider,
  FileOptionsDebitReservationStore,
  FileOptionsExecutionStore,
  FileOptionsManualOrderCoordinator,
  OptionsExecutionGateway,
  sha256,
} from '../src/index.ts'

const nowValue = '2026-08-26T15:00:00.200Z'

function checksummed<T extends Record<string, unknown>>(body: T): T & { content_checksum: string } {
  return { ...body, content_checksum: sha256(body) }
}

function setupProvider(): FakeOptionsProvider {
  const provider = FakeOptionsProvider.paperFixture()
  Object.assign(provider.descriptor, {
    adapter_id: 'ibkr-options-api',
    adapter_version: '1.0.0',
    provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26',
    credential_generation: 'c'.repeat(64),
  })
  const original = provider.contracts[0]!
  const { content_checksum: _checksum, ...body } = original
  provider.contracts[0] = checksummed({ ...body, provider: 'ibkr' }) as OptionContractIdentity
  return provider
}

function connection(): OptionsConnection {
  return checksummed({
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
    connection_id: 'connection-options-paper', provider: 'ibkr' as const, environment: 'paper' as const,
    auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: 'ibkr-options-api', adapter_version: '1.0.0',
    provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26',
    account_ref: 'account-options-paper', account_label: 'Paper Options', endpoint: 'https://api.ibkr.com/v1/api',
    credential_ref: 'options-credential-paper', credential_generation: 'c'.repeat(64),
    state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
    created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsConnection
}

function authority(account: OptionsConnection, provider: FakeOptionsProvider): OptionsManualPaperAuthority {
  return checksummed({
    authority_schema_version: OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION,
    authority_id: 'options-authority-paper', connection_id: account.connection_id,
    connection_checksum: account.content_checksum, credential_generation: account.credential_generation,
    certification_id: 'options-cert-paper', certification_checksum: 'a'.repeat(64),
    certification_expires_at: '2026-08-26T16:00:00.000Z',
    certification_application_id: 'options-cert-application-paper',
    certification_application_checksum: 'b'.repeat(64),
    provider: 'ibkr' as const, environment: 'paper' as const, account_ref: account.account_ref,
    adapter_id: provider.descriptor.adapter_id, adapter_version: provider.descriptor.adapter_version,
    provider_contract_version: provider.descriptor.provider_contract_version,
    allowed_contract_id: provider.contracts[0]!.canonical_id,
    allowed_provider_instrument_id: provider.contracts[0]!.provider_instrument_id,
    mode: 'manual-confirmed-paper' as const, max_contracts_per_order: 1 as const, max_debit_per_order: '150',
    valid_from: '2026-08-26T14:59:00.000Z', valid_until: '2026-08-26T15:30:00.000Z',
    operator_confirmed_at: '2026-08-26T14:59:00.000Z', created_at: '2026-08-26T14:59:00.000Z',
  }) as OptionsManualPaperAuthority
}

async function fixture(root: string) {
  const provider = setupProvider()
  const reservations = new FileOptionsDebitReservationStore(path.join(root, 'reservations'), () => nowValue, 'manual-test')
  const executions = new FileOptionsExecutionStore(path.join(root, 'executions'))
  const gateway = new OptionsExecutionGateway(executions, reservations, provider, () => nowValue)
  const coordinator = new FileOptionsManualOrderCoordinator(root, reservations, gateway, provider, () => nowValue)
  const account = connection()
  const permission = authority(account, provider)
  return { provider, reservations, executions, gateway, coordinator, account, permission }
}

describe('manual-confirmed options paper order', () => {
  test('prepares a bounded review and submits exactly once after final confirmation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-manual-order-'))
    try {
      const setup = await fixture(root)
      const review = await setup.coordinator.prepare({
        connection: setup.account, authority: setup.permission,
        operator_max_premium: '1.35', operator_confirmed: true,
      })
      expect(review).toMatchObject({
        decision: { action: 'marketable_limit', limit_price: '1.30', planned_quantity: 1, maximum_debit: '130.65' },
        preview: { result: 'approved', buying_power_impact: '130.65' },
      })
      expect(setup.provider.mutationCount).toBe(0)
      const record = await setup.coordinator.commit({
        review_id: review.review_id, review_checksum: review.content_checksum,
        connection: setup.account, authority: setup.permission, operator_confirmed: true,
      })
      expect(record.state).toBe('working')
      expect(setup.provider.mutationCount).toBe(1)
      expect((await setup.coordinator.commit({
        review_id: review.review_id, review_checksum: review.content_checksum,
        connection: setup.account, authority: setup.permission, operator_confirmed: true,
      })).provider_order_id).toBe(record.provider_order_id)
      expect(setup.provider.mutationCount).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('refuses a price above the operator cap without reserving or mutating', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-manual-order-'))
    try {
      const setup = await fixture(root)
      await expect(setup.coordinator.prepare({
        connection: setup.account, authority: setup.permission,
        operator_max_premium: '1.25', operator_confirmed: true,
      })).rejects.toThrow('above your maximum premium')
      expect(await setup.reservations.list()).toEqual([])
      expect(setup.provider.mutationCount).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('cancel releases an unsubmitted review and unknown submit is never retried blindly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-manual-order-'))
    try {
      const canceled = await fixture(path.join(root, 'cancel'))
      const review = await canceled.coordinator.prepare({ connection: canceled.account, authority: canceled.permission, operator_max_premium: '1.35', operator_confirmed: true })
      await canceled.coordinator.cancel(review.review_id)
      expect((await canceled.reservations.get(review.reservation.reservation_id)).state).toBe('released')
      expect(canceled.provider.mutationCount).toBe(0)

      const uncertain = await fixture(path.join(root, 'unknown'))
      const unknownReview = await uncertain.coordinator.prepare({ connection: uncertain.account, authority: uncertain.permission, operator_max_premium: '1.35', operator_confirmed: true })
      uncertain.provider.failNextSubmit('after-accept')
      expect(await uncertain.coordinator.commit({ review_id: unknownReview.review_id, review_checksum: unknownReview.content_checksum, connection: uncertain.account, authority: uncertain.permission, operator_confirmed: true })).toMatchObject({ state: 'submit-unknown' })
      expect(uncertain.provider.mutationCount).toBe(1)
      await uncertain.gateway.recoverNonTerminal()
      expect(uncertain.provider.mutationCount).toBe(1)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('startup recovery can release an abandoned prepared review with zero provider mutation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-manual-order-'))
    try {
      const setup = await fixture(root)
      const review = await setup.coordinator.prepare({ connection: setup.account, authority: setup.permission, operator_max_premium: '1.35', operator_confirmed: true })
      const restartedReservations = new FileOptionsDebitReservationStore(path.join(root, 'reservations'), () => nowValue, 'manual-restart')
      const restartedGateway = new OptionsExecutionGateway(
        new FileOptionsExecutionStore(path.join(root, 'executions')),
        restartedReservations,
        setup.provider,
        () => nowValue,
      )
      await restartedGateway.releasePrepared(review.reservation.reservation_id)
      expect((await restartedReservations.get(review.reservation.reservation_id)).state).toBe('released')
      expect((await restartedReservations.list()).filter((reservation) => reservation.state !== 'released')).toEqual([])
      expect(setup.provider.mutationCount).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('startup recovery keeps an abandoned review blocked when account truth is no longer flat', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-manual-order-'))
    try {
      const setup = await fixture(root)
      const review = await setup.coordinator.prepare({ connection: setup.account, authority: setup.permission, operator_max_premium: '1.35', operator_confirmed: true })
      await setup.provider.submit({
        account_id: setup.account.account_ref,
        canonical_contract_id: review.contract.canonical_id,
        provider_instrument_id: review.contract.provider_instrument_id,
        action: 'BUY_TO_OPEN', order_type: 'limit', limit_price: '1.20', quantity: 1,
        time_in_force: 'day', regular_hours_only: true, client_order_id: 'external-paper-order',
      })
      await expect(setup.gateway.releasePrepared(review.reservation.reservation_id)).rejects.toMatchObject({
        code: 'OPTIONS_PROVIDER_DIVERGENCE',
      })
      expect((await setup.reservations.get(review.reservation.reservation_id)).state).toBe('prepared')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
