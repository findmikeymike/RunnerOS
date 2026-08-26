import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_DEBIT_RESERVATION_SCHEMA_VERSION,
  optionsReservationReleaseProofSchema,
  optionsDebitReservationSchema,
  type OptionsDebitReservation,
  type OptionsReservationReleaseProof,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'

export type OptionsReservationDraft = {
  reservation_id: string
  intent_id: string
  connection_id: string
  account_id: string
  source_id: string
  policy_id: string
  policy_checksum: string
  mandate_id: string
  mandate_checksum: string
  canonical_contract_id: string
  contract_checksum: string
  reserved_contracts: number
  limit_price: string
  multiplier: 100
  estimated_fees: string
  worst_case_debit: string
  account_capacity_snapshot_checksum: string
  expires_at: string
}

export type OptionsReservationLimits = {
  max_aggregate_open_debit: string
  max_daily_debit_initiated: string
  max_open_positions: number
}

export type OptionsReservationAccountTransaction = {
  get(reservationId: string): Promise<OptionsDebitReservation>
  activeSetChecksum(): Promise<string>
  markInitiated(input: {
    reservation_id: string
    expected_checksum: string
    execution_record_checksum: string
  }): Promise<OptionsDebitReservation>
  updateDeliveryState(input: {
    reservation_id: string
    expected_checksum: string
    state: 'working' | 'partially-filled' | 'submit-unknown' | 'open-position' | 'halted'
    execution_record_checksum: string
    filled_quantity: number
    open_quantity: number
  }): Promise<OptionsDebitReservation>
  release(proof: OptionsReservationReleaseProof): Promise<OptionsDebitReservation>
}

export class OptionsReservationStoreError extends Error {
  constructor(
    public readonly code:
      | 'OPTIONS_RISK_LIMIT'
      | 'OPTIONS_RISK_RESERVATION_CONFLICT'
      | 'OPTIONS_RISK_RESERVATION_INTEGRITY',
    message: string,
  ) {
    super(message)
    this.name = 'OptionsReservationStoreError'
  }
}

export class FileOptionsDebitReservationStore {
  private static readonly processQueues = new Map<string, Promise<void>>()
  private readonly reservationsDirectory: string
  private readonly locksDirectory: string
  private readonly releaseProofsDirectory: string

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly processInstanceId: string = randomUUID(),
  ) {
    this.reservationsDirectory = path.join(root, 'reservations')
    this.locksDirectory = path.join(root, 'locks')
    this.releaseProofsDirectory = path.join(root, 'release-proofs')
  }

  async admit(draft: OptionsReservationDraft, limits: OptionsReservationLimits): Promise<OptionsDebitReservation> {
    return this.withAccountLock(draft.account_id, `admit:${draft.reservation_id}`, async () => {
      const admissionRequestChecksum = sha256(draft)
      const existing = await this.getOrNull(draft.reservation_id)
      if (existing) {
        if (existing.admission_request_checksum !== admissionRequestChecksum) {
          throw new OptionsReservationStoreError(
            'OPTIONS_RISK_RESERVATION_INTEGRITY',
            `Reservation ${draft.reservation_id} was replayed with different economics.`,
          )
        }
        return existing
      }

      this.validateLimits(limits)
      const current = await this.list(draft.account_id)
      const active = current.filter((reservation) => reservation.state !== 'released')
      if (active.some((reservation) => reservation.canonical_contract_id === draft.canonical_contract_id)) {
        throw new OptionsReservationStoreError(
          'OPTIONS_RISK_RESERVATION_CONFLICT',
          'The exact option contract already has active reserved capacity.',
        )
      }
      if (active.length >= limits.max_open_positions) {
        throw new OptionsReservationStoreError('OPTIONS_RISK_LIMIT', 'The account open-position reservation limit is full.')
      }

      const aggregate = active.reduce(
        (sum, reservation) => sum.add(reservation.worst_case_debit),
        FixedDecimal.from('0'),
      ).add(draft.worst_case_debit)
      if (aggregate.compare(limits.max_aggregate_open_debit) > 0) {
        throw new OptionsReservationStoreError('OPTIONS_RISK_LIMIT', 'Aggregate option debit capacity is unavailable.')
      }

      const today = this.now().slice(0, 10)
      const dailyCommitted = current.reduce((sum, reservation) => {
        const initiatedToday = reservation.initiated_at?.slice(0, 10) === today
        const pendingCommitment = reservation.initiated_at === null && reservation.state !== 'released'
        return initiatedToday || pendingCommitment ? sum.add(reservation.worst_case_debit) : sum
      }, FixedDecimal.from('0')).add(draft.worst_case_debit)
      if (dailyCommitted.compare(limits.max_daily_debit_initiated) > 0) {
        throw new OptionsReservationStoreError('OPTIONS_RISK_LIMIT', 'Daily option debit capacity is unavailable.')
      }

      const timestamp = this.now()
      const activeSetChecksum = activeReservationSetChecksum([...active, {
        reservation_id: draft.reservation_id,
        admission_request_checksum: admissionRequestChecksum,
      }])
      const unsigned = {
        reservation_schema_version: OPTIONS_DEBIT_RESERVATION_SCHEMA_VERSION,
        ...draft,
        active_reservation_set_checksum: activeSetChecksum,
        admission_request_checksum: admissionRequestChecksum,
        state: 'prepared' as const,
        filled_quantity: 0,
        open_quantity: 0,
        created_at: timestamp,
        updated_at: timestamp,
        initiated_at: null,
        execution_record_checksum: null,
        terminal_proof_at: null,
        terminal_proof_checksum: null,
      }
      const reservation = optionsDebitReservationSchema.parse({
        ...unsigned,
        content_checksum: sha256(unsigned),
      })
      await this.writeNew(this.reservationFile(draft.reservation_id), reservation)
      return reservation
    })
  }

  async get(reservationId: string): Promise<OptionsDebitReservation> {
    const result = await this.getOrNull(reservationId)
    if (!result) {
      throw new OptionsReservationStoreError(
        'OPTIONS_RISK_RESERVATION_INTEGRITY',
        `Reservation ${reservationId} does not exist.`,
      )
    }
    return result
  }

  async list(accountId?: string): Promise<OptionsDebitReservation[]> {
    let files: string[]
    try {
      files = (await readdir(this.reservationsDirectory)).filter((file) => file.endsWith('.json')).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const reservations: OptionsDebitReservation[] = []
    const reservationIds = new Set<string>()
    for (const file of files) {
      const reservation = this.verify(JSON.parse(await readFile(path.join(this.reservationsDirectory, file), 'utf8')))
      if (file !== `${sha256(reservation.reservation_id)}.json` || reservationIds.has(reservation.reservation_id)) {
        throw new OptionsReservationStoreError(
          'OPTIONS_RISK_RESERVATION_INTEGRITY',
          'Reservation filename or identity is inconsistent with its durable content.',
        )
      }
      reservationIds.add(reservation.reservation_id)
      if (!accountId || reservation.account_id === accountId) reservations.push(reservation)
    }
    return reservations.sort((left, right) => left.created_at.localeCompare(right.created_at))
  }

  async activeSetChecksum(accountId: string): Promise<string> {
    return activeReservationSetChecksum(
      (await this.list(accountId)).filter((reservation) => reservation.state !== 'released'),
    )
  }

  async markInitiated(input: {
    reservation_id: string
    expected_checksum: string
    execution_record_checksum: string
  }): Promise<OptionsDebitReservation> {
    const current = await this.get(input.reservation_id)
    return this.withAccountTransaction(current.account_id, `initiate:${input.reservation_id}`, (transaction) => (
      transaction.markInitiated(input)
    ))
  }

  async updateDeliveryState(input: {
    reservation_id: string
    expected_checksum: string
    state: 'working' | 'partially-filled' | 'submit-unknown' | 'open-position' | 'halted'
    execution_record_checksum: string
    filled_quantity: number
    open_quantity: number
  }): Promise<OptionsDebitReservation> {
    const current = await this.get(input.reservation_id)
    return this.withAccountTransaction(current.account_id, `delivery-state:${input.reservation_id}`, (transaction) => (
      transaction.updateDeliveryState(input)
    ))
  }

  async withAccountTransaction<T>(
    accountId: string,
    operationId: string,
    operation: (transaction: OptionsReservationAccountTransaction) => Promise<T>,
  ): Promise<T> {
    return this.withAccountLock(accountId, operationId, async () => {
      let active = true
      const assertActive = () => {
        if (!active) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Account transaction authority already ended.')
        }
      }
      const transaction: OptionsReservationAccountTransaction = {
        get: async (reservationId) => {
          assertActive()
          const reservation = await this.get(reservationId)
          if (reservation.account_id !== accountId) {
            throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation belongs to another account.')
          }
          return reservation
        },
        activeSetChecksum: async () => {
          assertActive()
          return this.activeSetChecksum(accountId)
        },
        markInitiated: async (input) => {
          assertActive()
          return this.markInitiatedUnlocked(accountId, input)
        },
        updateDeliveryState: async (input) => {
          assertActive()
          return this.updateDeliveryStateUnlocked(accountId, input)
        },
        release: async (proof) => {
          assertActive()
          return this.releaseUnlocked(accountId, proof)
        },
      }
      try {
        return await operation(transaction)
      } finally {
        active = false
      }
    })
  }

  async release(proof: OptionsReservationReleaseProof): Promise<OptionsDebitReservation> {
    await this.prepareRelease(proof)
    return this.finalizeRelease(proof.reservation_id)
  }

  async prepareRelease(input: OptionsReservationReleaseProof): Promise<OptionsReservationReleaseProof> {
    const proof = this.verifyReleaseProof(input)
    const current = await this.get(proof.reservation_id)
    return this.withAccountLock(current.account_id, `prepare-release:${proof.reservation_id}`, async () => {
      const reloaded = await this.get(proof.reservation_id)
      if (reloaded.state === 'released') {
        if (reloaded.terminal_proof_checksum !== proof.content_checksum) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Released reservation proof is immutable.')
        }
        return proof
      }
      this.assertReleaseProofMatches(reloaded, proof)
      const existing = await this.getReleaseProofOrNull(proof.reservation_id)
      if (existing) {
        if (existing.content_checksum !== proof.content_checksum) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation release proof is immutable.')
        }
        return existing
      }
      await this.writeNew(this.releaseProofFile(proof.reservation_id), proof)
      return proof
    })
  }

  async finalizeRelease(reservationId: string): Promise<OptionsDebitReservation> {
    const current = await this.get(reservationId)
    return this.withAccountLock(current.account_id, `finalize-release:${reservationId}`, async () => {
      const reloaded = await this.get(reservationId)
      const proof = await this.getReleaseProofOrNull(reservationId)
      if (!proof) {
        throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation release proof is missing.')
      }
      if (reloaded.state === 'released') {
        if (reloaded.terminal_proof_checksum !== proof.content_checksum) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Released reservation proof is immutable.')
        }
        return reloaded
      }
      this.assertReleaseProofMatches(reloaded, proof)
      return this.replace(reloaded, {
        state: 'released',
        open_quantity: 0,
        terminal_proof_at: proof.proven_at,
        terminal_proof_checksum: proof.content_checksum,
        updated_at: this.now(),
      })
    })
  }

  async recoverPreparedReleases(): Promise<number> {
    let files: string[]
    try {
      files = (await readdir(this.releaseProofsDirectory)).filter((file) => file.endsWith('.json'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    let recovered = 0
    for (const file of files) {
      const proof = this.verifyReleaseProof(JSON.parse(await readFile(path.join(this.releaseProofsDirectory, file), 'utf8')))
      if (file !== `${sha256(proof.reservation_id)}.json`) {
        throw new OptionsReservationStoreError(
          'OPTIONS_RISK_RESERVATION_INTEGRITY',
          'Release-proof filename is inconsistent with its durable identity.',
        )
      }
      const current = await this.get(proof.reservation_id)
      if (current.state === 'released') continue
      await this.finalizeRelease(proof.reservation_id)
      recovered += 1
    }
    return recovered
  }

  /** Startup-only. Caller must own the app's OS-level single-instance authority. */
  async recoverStaleLocks(): Promise<number> {
    return this.withProcessQueue('startup-recovery', async () => {
      let files: string[]
      try {
        files = (await readdir(this.locksDirectory)).filter((file) => file.endsWith('.lock.json'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
        throw error
      }
      let recovered = 0
      for (const file of files) {
        const location = path.join(this.locksDirectory, file)
        const marker = JSON.parse(await readFile(location, 'utf8')) as {
          lock_schema_version?: string
          account_id?: string
          claim_id?: string
          operation_id?: string
          process_id?: number
          process_instance_id?: string
          acquired_at?: string
        }
        if (marker.lock_schema_version !== 'options-account-admission-lock@1'
          || !marker.account_id
          || file !== `${sha256(marker.account_id)}.lock.json`
          || !marker.claim_id
          || !marker.operation_id
          || !marker.acquired_at
          || !Number.isFinite(Date.parse(marker.acquired_at))
          || !Number.isSafeInteger(marker.process_id)
          || (marker.process_id ?? 0) <= 0) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Account lock owner is invalid.')
        }
        if (marker.process_instance_id === this.processInstanceId) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_CONFLICT', 'Account lock belongs to this active app instance.')
        }
        if (!marker.process_instance_id && processIsAlive(marker.process_id!)) {
          throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_CONFLICT', 'Legacy account lock appears live.')
        }
        await unlink(location)
        recovered += 1
      }
      return recovered
    })
  }

  async withAccountLock<T>(accountId: string, operationId: string, operation: () => Promise<T>): Promise<T> {
    return this.withProcessQueue(`account:${accountId}`, async () => {
      await mkdir(this.locksDirectory, { recursive: true })
      const location = this.lockFile(accountId)
      const claimId = randomUUID()
      const marker = {
        lock_schema_version: 'options-account-admission-lock@1',
        account_id: accountId,
        claim_id: claimId,
        operation_id: operationId,
        process_id: process.pid,
        process_instance_id: this.processInstanceId,
        acquired_at: this.now(),
      }
      try {
        await writeFile(location, `${JSON.stringify(marker, null, 2)}\n`, {
          encoding: 'utf8', flag: 'wx', mode: 0o600,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_CONFLICT', 'Account capacity is already being admitted.')
      }
      try {
        return await operation()
      } finally {
        try {
          const current = JSON.parse(await readFile(location, 'utf8')) as { claim_id?: string }
          if (current.claim_id === claimId) await unlink(location)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    })
  }

  private async getOrNull(reservationId: string): Promise<OptionsDebitReservation | null> {
    try {
      return this.verify(JSON.parse(await readFile(this.reservationFile(reservationId), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      if (error instanceof OptionsReservationStoreError) throw error
      throw new OptionsReservationStoreError(
        'OPTIONS_RISK_RESERVATION_INTEGRITY',
        `Reservation ${reservationId} failed validation.`,
      )
    }
  }

  private verify(value: unknown): OptionsDebitReservation {
    try {
      const reservation = optionsDebitReservationSchema.parse(value)
      const { content_checksum: _checksum, ...unsigned } = reservation
      if (sha256(unsigned) !== reservation.content_checksum) throw new Error('checksum mismatch')
      return reservation
    } catch {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation evidence failed integrity validation.')
    }
  }

  private verifyReleaseProof(value: unknown): OptionsReservationReleaseProof {
    try {
      const proof = optionsReservationReleaseProofSchema.parse(value)
      const { content_checksum: _checksum, ...unsigned } = proof
      if (sha256(unsigned) !== proof.content_checksum) throw new Error('checksum mismatch')
      return proof
    } catch {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation release proof failed integrity validation.')
    }
  }

  private async getReleaseProofOrNull(reservationId: string): Promise<OptionsReservationReleaseProof | null> {
    try {
      return this.verifyReleaseProof(JSON.parse(await readFile(this.releaseProofFile(reservationId), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private assertReleaseProofMatches(
    reservation: OptionsDebitReservation,
    proof: OptionsReservationReleaseProof,
  ): void {
    if (reservation.reservation_id !== proof.reservation_id
      || reservation.content_checksum !== proof.reservation_checksum
      || reservation.connection_id !== proof.connection_id
      || reservation.account_id !== proof.account_id
      || reservation.canonical_contract_id !== proof.canonical_contract_id) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Release proof does not bind the exact reservation identity.')
    }
    if (reservation.initiated_at !== null && proof.delivery_state !== 'terminal-flat') {
      throw new OptionsReservationStoreError(
        'OPTIONS_RISK_RESERVATION_INTEGRITY',
        'Provider delivery requires exact provider-terminal flat proof before release.',
      )
    }
    if (Date.parse(proof.proven_at) < Date.parse(reservation.updated_at)) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Terminal proof predates the reservation state it proves.')
    }
  }

  private async replace(
    current: OptionsDebitReservation,
    changes: Partial<OptionsDebitReservation>,
  ): Promise<OptionsDebitReservation> {
    const { content_checksum: _checksum, ...body } = current
    const unsigned = { ...body, ...changes }
    const next = optionsDebitReservationSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
    await this.atomicWrite(this.reservationFile(current.reservation_id), next)
    return next
  }

  private assertExpected(current: OptionsDebitReservation, checksum: string): void {
    if (current.content_checksum !== checksum) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_CONFLICT', 'Reservation changed before the requested transition.')
    }
  }

  private async markInitiatedUnlocked(
    accountId: string,
    input: { reservation_id: string; expected_checksum: string; execution_record_checksum: string },
  ): Promise<OptionsDebitReservation> {
    const reloaded = await this.get(input.reservation_id)
    if (reloaded.account_id !== accountId) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation belongs to another account.')
    }
    if (reloaded.state === 'submitting'
      && reloaded.execution_record_checksum === input.execution_record_checksum) return reloaded
    this.assertExpected(reloaded, input.expected_checksum)
    if (reloaded.state !== 'prepared') {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation cannot enter provider-delivery state.')
    }
    const timestamp = this.now()
    return this.replace(reloaded, {
      state: 'submitting',
      initiated_at: timestamp,
      execution_record_checksum: input.execution_record_checksum,
      updated_at: timestamp,
    })
  }

  private async updateDeliveryStateUnlocked(
    accountId: string,
    input: {
      reservation_id: string
      expected_checksum: string
      state: 'working' | 'partially-filled' | 'submit-unknown' | 'open-position' | 'halted'
      execution_record_checksum: string
      filled_quantity: number
      open_quantity: number
    },
  ): Promise<OptionsDebitReservation> {
    const reloaded = await this.get(input.reservation_id)
    if (reloaded.account_id !== accountId) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation belongs to another account.')
    }
    if (reloaded.state === input.state
      && reloaded.execution_record_checksum === input.execution_record_checksum
      && reloaded.filled_quantity === input.filled_quantity
      && reloaded.open_quantity === input.open_quantity) return reloaded
    this.assertExpected(reloaded, input.expected_checksum)
    const allowed: Record<string, string[]> = {
      submitting: ['working', 'partially-filled', 'submit-unknown', 'open-position', 'halted'],
      working: ['working', 'partially-filled', 'submit-unknown', 'open-position', 'halted'],
      'partially-filled': ['partially-filled', 'submit-unknown', 'open-position', 'halted'],
      'submit-unknown': ['working', 'partially-filled', 'submit-unknown', 'open-position', 'halted'],
      'open-position': ['open-position', 'halted'],
      halted: ['halted'],
    }
    if (reloaded.initiated_at === null || !allowed[reloaded.state]?.includes(input.state)) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation has not entered provider delivery.')
    }
    return this.replace(reloaded, {
      state: input.state,
      execution_record_checksum: input.execution_record_checksum,
      filled_quantity: input.filled_quantity,
      open_quantity: input.open_quantity,
      updated_at: this.now(),
    })
  }

  private async releaseUnlocked(
    accountId: string,
    input: OptionsReservationReleaseProof,
  ): Promise<OptionsDebitReservation> {
    const proof = this.verifyReleaseProof(input)
    const current = await this.get(proof.reservation_id)
    if (current.account_id !== accountId) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation belongs to another account.')
    }
    if (current.state === 'released') {
      if (current.terminal_proof_checksum !== proof.content_checksum) {
        throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Released reservation proof is immutable.')
      }
      return current
    }
    this.assertReleaseProofMatches(current, proof)
    const existing = await this.getReleaseProofOrNull(proof.reservation_id)
    if (existing && existing.content_checksum !== proof.content_checksum) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Reservation release proof is immutable.')
    }
    if (!existing) await this.writeNew(this.releaseProofFile(proof.reservation_id), proof)
    return this.replace(current, {
      state: 'released',
      open_quantity: 0,
      terminal_proof_at: proof.proven_at,
      terminal_proof_checksum: proof.content_checksum,
      updated_at: this.now(),
    })
  }

  private validateLimits(limits: OptionsReservationLimits): void {
    if (!Number.isSafeInteger(limits.max_open_positions) || limits.max_open_positions <= 0) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Open-position limit is invalid.')
    }
    if (FixedDecimal.from(limits.max_aggregate_open_debit).compare('0') <= 0
      || FixedDecimal.from(limits.max_daily_debit_initiated).compare('0') <= 0) {
      throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_INTEGRITY', 'Debit limits must be positive.')
    }
  }

  private async writeNew(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    try {
      await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new OptionsReservationStoreError('OPTIONS_RISK_RESERVATION_CONFLICT', 'Reservation was created concurrently.')
      }
      throw error
    }
  }

  private async atomicWrite(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }

  private reservationFile(reservationId: string): string {
    if (!reservationId.trim() || reservationId.length > 1_000) throw new Error('Reservation ID is invalid.')
    return path.join(this.reservationsDirectory, `${sha256(reservationId)}.json`)
  }

  private lockFile(accountId: string): string {
    if (!accountId.trim() || accountId.length > 1_000) throw new Error('Account ID is invalid.')
    return path.join(this.locksDirectory, `${sha256(accountId)}.lock.json`)
  }

  private releaseProofFile(reservationId: string): string {
    if (!reservationId.trim() || reservationId.length > 1_000) throw new Error('Reservation ID is invalid.')
    return path.join(this.releaseProofsDirectory, `${sha256(reservationId)}.json`)
  }

  private async withProcessQueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const scoped = `${this.root}:${key}`
    const previous = FileOptionsDebitReservationStore.processQueues.get(scoped) ?? Promise.resolve()
    let release!: () => void
    const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    FileOptionsDebitReservationStore.processQueues.set(scoped, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (FileOptionsDebitReservationStore.processQueues.get(scoped) === current) {
        FileOptionsDebitReservationStore.processQueues.delete(scoped)
      }
    }
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function activeReservationSetChecksum(
  reservations: Array<{ reservation_id: string; admission_request_checksum: string }>,
): string {
  return sha256(reservations.map((reservation) => ({
    reservation_id: reservation.reservation_id,
    admission_request_checksum: reservation.admission_request_checksum,
  })).sort((left, right) => left.reservation_id.localeCompare(right.reservation_id)))
}
