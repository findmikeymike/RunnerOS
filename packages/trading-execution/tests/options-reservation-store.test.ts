import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION } from '@trade-god/contracts'

import {
  FileOptionsDebitReservationStore,
  sha256,
} from '../src/index.ts'

const checksum = 'a'.repeat(64)
const checksumB = 'b'.repeat(64)
const now = '2026-08-26T15:00:00.000Z'

const draft = (id: string, contract = 'USOPT:SPY:2026-09-18:C:650') => ({
  reservation_id: id,
  intent_id: `intent-${id}`,
  connection_id: 'connection-options-paper',
  account_id: 'account-options-paper',
  source_id: `source-${id}`,
  policy_id: 'options-policy-paper-v1',
  policy_checksum: checksum,
  mandate_id: 'mandate-options-paper',
  mandate_checksum: checksumB,
  canonical_contract_id: contract,
  contract_checksum: checksum,
  reserved_contracts: 1,
  limit_price: '1.30',
  multiplier: 100 as const,
  estimated_fees: '0.65',
  worst_case_debit: '130.65',
  account_capacity_snapshot_checksum: checksumB,
  expires_at: '2026-08-26T15:00:30.000Z',
})

const limits = {
  max_aggregate_open_debit: '200',
  max_daily_debit_initiated: '300',
  max_open_positions: 1,
}

const releaseProof = (reservation: Awaited<ReturnType<FileOptionsDebitReservationStore['get']>>, input: {
  delivery_state: 'not-sent' | 'terminal-flat'
  account_id?: string
}) => {
  const unsigned = {
    proof_schema_version: OPTIONS_RESERVATION_RELEASE_PROOF_SCHEMA_VERSION,
    proof_id: `release-proof-${reservation.reservation_id}`,
    reservation_id: reservation.reservation_id,
    reservation_checksum: reservation.content_checksum,
    connection_id: reservation.connection_id,
    account_id: input.account_id ?? reservation.account_id,
    canonical_contract_id: reservation.canonical_contract_id,
    provider_snapshot_checksum: checksum,
    provider_order_ids: input.delivery_state === 'terminal-flat' ? ['provider-order-1'] : [],
    open_position_quantity: 0 as const,
    working_order_count: 0 as const,
    delivery_state: input.delivery_state,
    proven_at: now,
  }
  return { ...unsigned, content_checksum: sha256(unsigned) }
}

describe('options debit reservation store', () => {
  test('atomically admits only one concurrent reservation into account capacity', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-reservations-'))
    try {
      const first = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-1')
      const second = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-1')
      const results = await Promise.allSettled([
        first.admit(draft('reservation-one'), limits),
        second.admit(draft('reservation-two', 'USOPT:QQQ:2026-09-18:P:590'), limits),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
      expect((await first.list('account-options-paper'))).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('is idempotent by reservation ID and refuses conflicting economics', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-reservations-'))
    try {
      const store = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-1')
      const first = await store.admit(draft('reservation-one'), limits)
      expect(await store.admit(draft('reservation-one'), limits)).toEqual(first)
      await expect(store.admit({ ...draft('reservation-one'), limit_price: '1.31', worst_case_debit: '131.65' }, limits))
        .rejects.toMatchObject({ code: 'OPTIONS_RISK_RESERVATION_INTEGRITY' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('retains unknown delivery and releases only from exact terminal proof', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-reservations-'))
    try {
      const store = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-1')
      const admitted = await store.admit(draft('reservation-one'), limits)
      const unknown = await store.markInitiated({
        reservation_id: admitted.reservation_id,
        expected_checksum: admitted.content_checksum,
        execution_record_checksum: checksum,
      })
      expect(unknown.state).toBe('submitting')
      expect(await store.markInitiated({
        reservation_id: admitted.reservation_id,
        expected_checksum: admitted.content_checksum,
        execution_record_checksum: checksum,
      })).toEqual(unknown)
      const uncertain = await store.updateDeliveryState({
        reservation_id: unknown.reservation_id,
        expected_checksum: unknown.content_checksum,
        state: 'submit-unknown',
        execution_record_checksum: checksum,
        filled_quantity: 0,
        open_quantity: 0,
      })
      const halted = await store.updateDeliveryState({
        reservation_id: uncertain.reservation_id,
        expected_checksum: uncertain.content_checksum,
        state: 'halted',
        execution_record_checksum: checksum,
        filled_quantity: 0,
        open_quantity: 0,
      })
      await expect(store.updateDeliveryState({
        reservation_id: halted.reservation_id,
        expected_checksum: halted.content_checksum,
        state: 'working',
        execution_record_checksum: checksum,
        filled_quantity: 0,
        open_quantity: 0,
      })).rejects.toMatchObject({ code: 'OPTIONS_RISK_RESERVATION_INTEGRITY' })
      await expect(store.release(releaseProof(halted, { delivery_state: 'not-sent' })))
        .rejects.toMatchObject({ code: 'OPTIONS_RISK_RESERVATION_INTEGRITY' })
      await expect(store.release(releaseProof(halted, {
        delivery_state: 'terminal-flat',
        account_id: 'wrong-account',
      }))).rejects.toMatchObject({ code: 'OPTIONS_RISK_RESERVATION_INTEGRITY' })
      const proof = releaseProof(halted, { delivery_state: 'terminal-flat' })
      const released = await store.release(proof)
      expect(released).toMatchObject({ state: 'released', terminal_proof_checksum: proof.content_checksum })
      expect(await store.release(proof)).toEqual(released)
      await expect(store.admit(draft('reservation-two'), limits)).resolves.toBeDefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('recovers a crash after durable proof but before capacity release', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-reservations-'))
    try {
      const store = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-1')
      const admitted = await store.admit(draft('reservation-one'), limits)
      await store.prepareRelease(releaseProof(admitted, { delivery_state: 'not-sent' }))
      const restarted = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-2')
      expect((await restarted.get(admitted.reservation_id)).state).toBe('prepared')
      expect(await restarted.recoverPreparedReleases()).toBe(1)
      expect((await restarted.get(admitted.reservation_id)).state).toBe('released')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('detects tampered or duplicated reservation evidence after restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-reservations-'))
    try {
      const store = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-1')
      await store.admit(draft('reservation-one'), limits)
      const [file] = await readdir(path.join(root, 'reservations'))
      const location = path.join(root, 'reservations', file!)
      const persisted = JSON.parse(await readFile(location, 'utf8')) as Record<string, unknown>
      await writeFile(location, `${JSON.stringify({ ...persisted, worst_case_debit: '1.00' }, null, 2)}\n`)
      const restarted = new FileOptionsDebitReservationStore(root, () => now, 'app-instance-2')
      await expect(restarted.get('reservation-one')).rejects.toMatchObject({
        code: 'OPTIONS_RISK_RESERVATION_INTEGRITY',
      })

      await writeFile(location, `${JSON.stringify(persisted, null, 2)}\n`)
      await writeFile(path.join(root, 'reservations', 'copied.json'), `${JSON.stringify(persisted, null, 2)}\n`)
      await expect(restarted.list()).rejects.toMatchObject({
        code: 'OPTIONS_RISK_RESERVATION_INTEGRITY',
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('repairs crashed account locks only through startup recovery', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'options-reservations-'))
    try {
      const locks = path.join(root, 'locks')
      await mkdir(locks, { recursive: true })
      await writeFile(path.join(locks, `${sha256('account-options-paper')}.lock.json`), JSON.stringify({
        lock_schema_version: 'options-account-admission-lock@1',
        account_id: 'account-options-paper',
        claim_id: 'crashed-claim',
        operation_id: 'crashed-operation',
        process_id: process.pid,
        process_instance_id: 'crashed-app-instance',
        acquired_at: now,
      }))
      const store = new FileOptionsDebitReservationStore(root, () => now, 'new-app-instance')
      await expect(store.admit(draft('reservation-one'), limits)).rejects.toMatchObject({
        code: 'OPTIONS_RISK_RESERVATION_CONFLICT',
      })
      expect(await store.recoverStaleLocks()).toBe(1)
      await expect(store.admit(draft('reservation-one'), limits)).resolves.toBeDefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
