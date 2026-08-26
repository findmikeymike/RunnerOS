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
  FileOptionsManagementStore,
  FileOptionsManualOrderCoordinator,
  OptionsExecutionGateway,
  OptionsPositionManager,
  sha256,
} from '../src/index.ts'

const nowValue = '2026-08-26T15:00:00.200Z'
const checksummed = <T extends Record<string, unknown>>(body: T): T & { content_checksum: string } => ({ ...body, content_checksum: sha256(body) })

async function fixture(root: string) {
  const provider = FakeOptionsProvider.paperFixture()
  Object.assign(provider.descriptor, { adapter_id: 'ibkr-options-api', adapter_version: '1.0.0', provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26', credential_generation: 'c'.repeat(64) })
  const original = provider.contracts[0]!
  const { content_checksum: _checksum, ...contractBody } = original
  provider.contracts[0] = checksummed({ ...contractBody, provider: 'ibkr' }) as OptionContractIdentity
  const account = checksummed({
    connection_schema_version: OPTIONS_CONNECTION_SCHEMA_VERSION,
    connection_id: 'connection-options-paper', provider: 'ibkr' as const, environment: 'paper' as const,
    auth_profile: 'ibkr-oauth-access-token' as const, adapter_id: provider.descriptor.adapter_id,
    adapter_version: provider.descriptor.adapter_version, provider_contract_version: provider.descriptor.provider_contract_version,
    account_ref: 'account-options-paper', account_label: 'Paper Options', endpoint: 'https://api.ibkr.com/v1/api',
    credential_ref: 'options-credential-paper', credential_generation: provider.descriptor.credential_generation,
    state: 'read-only-verified' as const, read_only: true as const, execution_enabled: false as const,
    created_at: '2026-08-26T14:00:00.000Z', updated_at: '2026-08-26T14:00:00.000Z',
  }) as OptionsConnection
  const permission = checksummed({
    authority_schema_version: OPTIONS_MANUAL_PAPER_AUTHORITY_SCHEMA_VERSION,
    authority_id: 'options-authority-paper', connection_id: account.connection_id, connection_checksum: account.content_checksum,
    credential_generation: account.credential_generation, certification_id: 'options-cert-paper', certification_checksum: 'a'.repeat(64),
    certification_expires_at: '2026-08-26T16:00:00.000Z', certification_application_id: 'options-app-paper', certification_application_checksum: 'b'.repeat(64),
    provider: 'ibkr' as const, environment: 'paper' as const, account_ref: account.account_ref,
    adapter_id: provider.descriptor.adapter_id, adapter_version: provider.descriptor.adapter_version,
    provider_contract_version: provider.descriptor.provider_contract_version,
    allowed_contract_id: provider.contracts[0]!.canonical_id, allowed_provider_instrument_id: provider.contracts[0]!.provider_instrument_id,
    mode: 'manual-confirmed-paper' as const, max_contracts_per_order: 1 as const, max_debit_per_order: '150',
    valid_from: '2026-08-26T14:59:00.000Z', valid_until: '2026-08-26T15:30:00.000Z',
    operator_confirmed_at: '2026-08-26T14:59:00.000Z', created_at: '2026-08-26T14:59:00.000Z',
  }) as OptionsManualPaperAuthority
  const reservations = new FileOptionsDebitReservationStore(path.join(root, 'reservations'), () => nowValue, 'management-test')
  const executions = new FileOptionsExecutionStore(path.join(root, 'executions'))
  const gateway = new OptionsExecutionGateway(executions, reservations, provider, () => nowValue)
  const coordinator = new FileOptionsManualOrderCoordinator(root, reservations, gateway, provider, () => nowValue)
  const management = new FileOptionsManagementStore(path.join(root, 'management'))
  const manager = new OptionsPositionManager(executions, management, reservations, provider, () => nowValue)
  const review = await coordinator.prepare({ connection: account, authority: permission, operator_max_premium: '1.35', operator_confirmed: true })
  const entry = await coordinator.commit({ review_id: review.review_id, review_checksum: review.content_checksum, connection: account, authority: permission, operator_confirmed: true })
  return { provider, reservations, executions, gateway, manager, entry }
}

describe('options position manager', () => {
  test('cancels an unfilled entry before any exit and releases exact debit capacity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-management-'))
    try {
      const setup = await fixture(root)
      await expect(setup.manager.closePosition({ intent_id: setup.entry.intent_id, request_id: 'exit-before-fill', reason: 'signal-exit', quantity: 'all', minimum_credit: '1.00' })).rejects.toThrow('Cancel and prove')
      const canceled = await setup.manager.cancelWorkingEntry({ intent_id: setup.entry.intent_id, request_id: 'cancel-no-fill', reason: 'signal-no-fill' })
      expect(canceled).toMatchObject({ state: 'entry-canceled', remaining_open_quantity: 0 })
      expect((await setup.executions.getRecord(setup.entry.intent_id)).state).toBe('canceled-flat')
      expect((await setup.reservations.list())[0]!.state).toBe('released')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('closes only the exact owned long contract and releases after filled flat proof', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-management-'))
    try {
      const setup = await fixture(root)
      await setup.provider.fill(setup.entry.provider_order_id!, 1, '1.29')
      await setup.gateway.reconcile(setup.entry.intent_id)
      const workingClose = await setup.manager.closePosition({ intent_id: setup.entry.intent_id, request_id: 'close-all', reason: 'operator', quantity: 'all', minimum_credit: '1.00' })
      expect(workingClose).toMatchObject({ state: 'close-working', requested_close_quantity: 1, remaining_open_quantity: 1 })
      await setup.provider.fill(workingClose.provider_close_order_id!, 1, '1.27')
      const closed = await setup.manager.reconcile(workingClose.management_id)
      expect(closed).toMatchObject({ state: 'closed-flat', closed_quantity: 1, remaining_open_quantity: 0 })
      expect((await setup.executions.getRecord(setup.entry.intent_id)).state).toBe('closed-flat')
      expect((await setup.reservations.list())[0]!.state).toBe('released')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('never retries an absent close order after an unknown submit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-management-'))
    try {
      const setup = await fixture(root)
      await setup.provider.fill(setup.entry.provider_order_id!, 1, '1.29')
      await setup.gateway.reconcile(setup.entry.intent_id)
      setup.provider.failNextSubmit('before-send')
      const unknown = await setup.manager.closePosition({ intent_id: setup.entry.intent_id, request_id: 'unknown-close', reason: 'operator', quantity: 'all', minimum_credit: '1.00' })
      expect(unknown.state).toBe('close-unknown')
      const mutations = setup.provider.mutationCount
      expect((await setup.manager.reconcile(unknown.management_id)).state).toBe('close-unknown')
      expect(setup.provider.mutationCount).toBe(mutations)
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  test('records a canceled no-fill close as terminal, not working', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-management-'))
    try {
      const setup = await fixture(root)
      await setup.provider.fill(setup.entry.provider_order_id!, 1, '1.29')
      await setup.gateway.reconcile(setup.entry.intent_id)
      const working = await setup.manager.closePosition({ intent_id: setup.entry.intent_id, request_id: 'cancel-close', reason: 'operator', quantity: 'all', minimum_credit: '1.00' })
      await setup.provider.cancel(working.provider_close_order_id!)
      const canceled = await setup.manager.reconcile(working.management_id)
      expect(canceled).toMatchObject({ state: 'close-canceled', closed_quantity: 0, remaining_open_quantity: 1 })
      expect(await setup.manager.recoverNonTerminal()).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
