import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  EXECUTION_RECORD_SCHEMA_VERSION,
  executionRecordSchema,
  mirrorOwnershipReleaseJournalSchema,
  type ExecutionRecord,
  type ExecutionCapabilities,
  type ExecutionNoExposureProof,
  type MirrorOwnershipReleaseJournal,
  type OrderIntent,
} from '@trade-god/contracts'

import { ExecutionGatewayError } from './errors.ts'
import {
  computeExecutionReceiptChecksum,
  computeManagementAcknowledgmentChecksum,
  computeManagementCommandChecksum,
  computeOrderIntentChecksum,
  sha256,
} from './canonical.ts'

export interface ExecutionControlState {
  control_schema_version: 'execution-control@1'
  global_kill: boolean
  connection_kills: string[]
  source_kills: string[]
  activation_release?: {
    release_id: string
    release_event_id: string
    release_event_checksum: string
    state_checksum: string
    committed_at: string
  }
  updated_at: string
}

export interface ExecutionOwnershipLease {
  lease_schema_version: 'execution-ownership-lease@1'
  ownership_key: string
  intent_id: string
  connection_id: string
  provider_account_key: string
  instrument_id: string
  acquired_at: string
}

const defaultControl = (now: string): ExecutionControlState => ({
  control_schema_version: 'execution-control@1',
  global_kill: true,
  connection_kills: [],
  source_kills: [],
  updated_at: now,
})

export class FileExecutionStore {
  private static readonly processQueues = new Map<string, Promise<void>>()
  private readonly recordsDirectory: string
  private readonly controlFile: string
  private readonly ownershipDirectory: string
  private readonly providerMutationDirectory: string
  private readonly mirrorReleaseDirectory: string
  private readonly adapterAttachmentFile: string

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly processInstanceId: string = randomUUID(),
  ) {
    this.recordsDirectory = path.join(root, 'records')
    this.controlFile = path.join(root, 'control.json')
    this.ownershipDirectory = path.join(root, 'ownership')
    this.providerMutationDirectory = path.join(root, 'provider-mutations')
    this.mirrorReleaseDirectory = path.join(root, 'mirror-ownership-releases')
    this.adapterAttachmentFile = path.join(root, 'adapter-attachment.json')
  }

  /** Binds persisted activation to the exact installed adapter set. Any change re-latches halt. */
  async bindAdapterSet(adapters: Array<{
    adapter_id: string
    adapter_version: string
    provider_contract_version: string
    transport: string
    capabilities?: ExecutionCapabilities
  }>): Promise<{ changed: boolean; adapter_set_checksum: string }> {
    const installed = adapters.map((adapter) => ({
      adapter_id: adapter.adapter_id,
      adapter_version: adapter.adapter_version,
      provider_contract_version: adapter.provider_contract_version,
      transport: adapter.transport,
      capabilities: adapter.capabilities ?? null,
    })).sort((left, right) => (
      `${left.adapter_id}:${left.adapter_version}:${left.provider_contract_version}:${left.transport}`
        .localeCompare(`${right.adapter_id}:${right.adapter_version}:${right.provider_contract_version}:${right.transport}`)
    ))
    const adapterSetChecksum = sha256(installed)
    return this.withLock('adapter-attachment', async () => {
      let existing: { adapter_set_checksum?: string } | null = null
      try {
        existing = JSON.parse(await readFile(this.adapterAttachmentFile, 'utf8')) as {
          adapter_set_checksum?: string
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (existing?.adapter_set_checksum === adapterSetChecksum) {
        return { changed: false, adapter_set_checksum: adapterSetChecksum }
      }
      await this.setGlobalKill(true)
      const terminal = new Set(['risk-denied', 'closed', 'rejected', 'canceled', 'expired', 'error'])
      const nonterminal = (await this.list()).filter((record) => !terminal.has(record.state))
      if (nonterminal.length > 0) {
        throw new ExecutionGatewayError(
          'CONNECTION_UNAVAILABLE',
          `Adapter attachment changed with ${nonterminal.length} nonterminal execution record(s); operator recovery review is required.`,
        )
      }
      const timestamp = this.now()
      const unsigned = {
        adapter_attachment_schema_version: 'adapter-attachment@1',
        installed,
        adapter_set_checksum: adapterSetChecksum,
        halt_relatched_at: timestamp,
        updated_at: timestamp,
      }
      await this.atomicWrite(this.adapterAttachmentFile, {
        ...unsigned,
        content_checksum: sha256(unsigned),
      })
      return { changed: true, adapter_set_checksum: adapterSetChecksum }
    })
  }

  async create(intent: OrderIntent, traceId: string): Promise<ExecutionRecord> {
    await mkdir(this.recordsDirectory, { recursive: true })
    const timestamp = this.now()
    const record = executionRecordSchema.parse({
      record_schema_version: EXECUTION_RECORD_SCHEMA_VERSION,
      trace_id: traceId,
      intent,
      state: 'created',
      transitions: [{
        transition_id: `transition-${randomUUID()}`,
        from: null,
        to: 'created',
        occurred_at: timestamp,
        reason: 'Order intent registered.',
      }],
      created_at: timestamp,
      updated_at: timestamp,
    })
    const destination = this.recordFile(intent.intent_id)
    try {
      await writeFile(destination, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ExecutionGatewayError('INTENT_EXISTS', `Intent ${intent.intent_id} already exists.`)
      }
      throw error
    }
    return record
  }

  async get(intentId: string): Promise<ExecutionRecord> {
    try {
      const raw = await readFile(this.recordFile(intentId), 'utf8')
      return verifyRecordIntegrity(executionRecordSchema.parse(JSON.parse(raw)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ExecutionGatewayError('INTENT_NOT_FOUND', `Intent ${intentId} was not found.`)
      }
      throw error
    }
  }

  async update(
    intentId: string,
    mutate: (record: ExecutionRecord) => ExecutionRecord,
  ): Promise<ExecutionRecord> {
    return this.withLock(`intent:${intentId}`, async () => {
      const current = await this.get(intentId)
      const next = executionRecordSchema.parse(mutate(structuredClone(current)))
      await this.atomicWrite(this.recordFile(intentId), next)
      return next
    })
  }

  async claim(
    intentId: string,
    mutate: (record: ExecutionRecord) => ExecutionRecord,
  ): Promise<ExecutionRecord> {
    return this.withLock(`intent:${intentId}`, async () => {
      const current = await this.get(intentId)
      const next = executionRecordSchema.parse(mutate(structuredClone(current)))
      const marker = this.claimFile(intentId)
      try {
        await writeFile(marker, `${JSON.stringify({
          intent_id: intentId,
          claim_id: next.claim?.claim_id,
          claimed_at: next.claim?.claimed_at,
          process_id: process.pid,
          process_instance_id: this.processInstanceId,
        }, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Intent ${intentId} already has a durable execution claim.`,
          )
        }
        else throw error
      }
      await this.atomicWrite(this.recordFile(intentId), next)
      return next
    })
  }

  async claimManagement(
    intentId: string,
    actionDigest: string,
    mutate: (record: ExecutionRecord) => ExecutionRecord,
  ): Promise<{ record: ExecutionRecord; claimed: boolean }> {
    if (!/^[a-f0-9]{64}$/.test(actionDigest)) {
      throw new Error('Management action digest is invalid.')
    }
    return this.withLock(`intent:${intentId}`, async () => {
      const current = await this.get(intentId)
      if (
        current.management_actions.some(
          (action) => action.command.action_digest === actionDigest,
        )
      ) {
        return { record: current, claimed: false }
      }
      const marker = this.managementClaimFile(intentId, actionDigest)
      try {
        await writeFile(marker, `${JSON.stringify({
          intent_id: intentId,
          action_digest: actionDigest,
          claimed_at: this.now(),
          process_id: process.pid,
          process_instance_id: this.processInstanceId,
        }, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const latest = await this.get(intentId)
          if (latest.management_actions.some(
            (action) => action.command.action_digest === actionDigest,
          )) {
            return { record: latest, claimed: false }
          }
          return { record: latest, claimed: false }
        }
        else throw error
      }
      const next = executionRecordSchema.parse(mutate(structuredClone(current)))
      await this.atomicWrite(this.recordFile(intentId), next)
      return { record: next, claimed: true }
    })
  }

  async list(): Promise<ExecutionRecord[]> {
    await mkdir(this.recordsDirectory, { recursive: true })
    const names = await readdir(this.recordsDirectory)
    const records = await Promise.all(
      names
        .filter((name) => name.endsWith('.json') && !name.endsWith('.claim.json'))
        .sort()
        .map(async (name) => verifyRecordIntegrity(executionRecordSchema.parse(
          JSON.parse(await readFile(path.join(this.recordsDirectory, name), 'utf8')),
        ))),
    )
    return records
  }

  async readControl(): Promise<ExecutionControlState> {
    try {
      return this.parseControl(JSON.parse(await readFile(this.controlFile, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultControl(this.now())
      throw error
    }
  }

  async setGlobalKill(enabled: boolean): Promise<ExecutionControlState> {
    return this.updateControl((control) => ({ ...control, global_kill: enabled }))
  }

  async commitPaperActivationRelease(input: {
    release_id: string
    release_event_id: string
    release_event_checksum: string
    state_checksum: string
    expected_control_checksum: string
    connection_ids: string[]
  }): Promise<ExecutionControlState> {
    return this.updateControl((control) => {
      if (sha256(control) !== input.expected_control_checksum) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Execution control state changed after the activation review.',
        )
      }
      if (!control.global_kill) {
        throw new ExecutionGatewayError(
          'INVALID_STATE',
          'Paper activation release requires the persistent global halt to be active.',
        )
      }
      return {
        ...control,
        global_kill: false,
        connection_kills: control.connection_kills.filter((connectionId) => (
          !input.connection_ids.includes(connectionId)
        )),
        activation_release: {
          release_id: input.release_id,
          release_event_id: input.release_event_id,
          release_event_checksum: input.release_event_checksum,
          state_checksum: input.state_checksum,
          committed_at: this.now(),
        },
      }
    })
  }

  async setConnectionKill(connectionId: string, enabled: boolean): Promise<ExecutionControlState> {
    return this.updateControl((control) => ({
      ...control,
      connection_kills: toggle(control.connection_kills, connectionId, enabled),
    }))
  }

  async setSourceKill(sourceId: string, enabled: boolean): Promise<ExecutionControlState> {
    return this.updateControl((control) => ({
      ...control,
      source_kills: toggle(control.source_kills, sourceId, enabled),
    }))
  }

  async acquireOwnership(input: Omit<ExecutionOwnershipLease, 'lease_schema_version' | 'acquired_at'>): Promise<ExecutionOwnershipLease> {
    return (await this.acquireOwnershipSet([input]))[0]!
  }

  async acquireOwnershipSet(
    inputs: Array<Omit<ExecutionOwnershipLease, 'lease_schema_version' | 'acquired_at'>>,
  ): Promise<ExecutionOwnershipLease[]> {
    if (inputs.length === 0) return []
    const leases = inputs.map((input) => this.parseOwnershipLease({
      lease_schema_version: 'execution-ownership-lease@1',
      ...input,
      acquired_at: this.now(),
    }))
    if (new Set(leases.map((lease) => lease.ownership_key)).size !== leases.length) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Ownership set contains duplicate keys.')
    }
    return this.withLock('ownership-set', () => this.withOwnershipSetFileLock(leases, async () => {
      const existing = new Map<string, ExecutionOwnershipLease>()
      for (const lease of leases) {
        const current = await this.readOwnership(lease.ownership_key)
        if (current && current.intent_id !== lease.intent_id) {
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Provider account/instrument is already owned by intent ${current.intent_id}.`,
          )
        }
        if (current) existing.set(lease.ownership_key, current)
      }
      const created: ExecutionOwnershipLease[] = []
      try {
        for (const lease of leases) {
          if (existing.has(lease.ownership_key)) continue
          await writeFile(this.ownershipFile(lease.ownership_key), `${JSON.stringify(lease, null, 2)}\n`, {
            encoding: 'utf8', flag: 'wx', mode: 0o600,
          })
          created.push(lease)
        }
      } catch (error) {
        await Promise.all(created.map((lease) => unlink(this.ownershipFile(lease.ownership_key)).catch(() => undefined)))
        throw error
      }
      return leases.map((lease) => existing.get(lease.ownership_key) ?? lease)
    }))
  }

  async releaseOwnership(ownershipKey: string, intentId: string): Promise<boolean> {
    return (await this.releaseOwnershipSet([{ ownership_key: ownershipKey, intent_id: intentId }])) > 0
  }

  async releaseOwnershipSet(
    inputs: Array<{ ownership_key: string; intent_id: string }>,
  ): Promise<number> {
    if (inputs.length === 0) return 0
    return this.withLock('ownership-set', () => this.withOwnershipSetFileLock([], async () => {
      const existing: Array<{ input: typeof inputs[number]; lease: ExecutionOwnershipLease }> = []
      for (const input of inputs) {
        const current = await this.readOwnership(input.ownership_key)
        if (!current) continue
        if (current.intent_id !== input.intent_id) {
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Intent ${input.intent_id} cannot release ownership held by ${current.intent_id}.`,
          )
        }
        existing.push({ input, lease: current })
      }
      for (const { input } of existing) await unlink(this.ownershipFile(input.ownership_key))
      return existing.length
    }))
  }

  async readOwnership(ownershipKey: string): Promise<ExecutionOwnershipLease | null> {
    try {
      return this.parseOwnershipLease(JSON.parse(await readFile(this.ownershipFile(ownershipKey), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  /**
   * Startup-only repair. The caller must already own Electron's OS-level
   * single-instance authority and must call this before any execution work.
   * Normal lock acquisition never performs stale takeover.
   */
  async recoverStaleLocks(): Promise<number> {
    return this.withLock('startup-stale-lock-recovery', async () => {
      const markers: string[] = [path.join(this.ownershipDirectory, '_ownership-set.lock.json')]
      for (const [directory, suffix] of [
        [this.providerMutationDirectory, '.lock.json'],
        [this.recordsDirectory, '.claim.json'],
      ] as const) {
        try {
          markers.push(...(await readdir(directory))
            .filter((file) => file.endsWith(suffix))
            .map((file) => path.join(directory, file)))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      let recovered = 0
      for (const marker of markers) {
        let claim: { process_id?: number; process_instance_id?: string; operation_id?: string }
        try {
          claim = JSON.parse(await readFile(marker, 'utf8')) as typeof claim
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        if (
          typeof claim.process_id !== 'number'
          || !Number.isSafeInteger(claim.process_id)
          || claim.process_id <= 0
        ) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            `Execution lock ${path.basename(marker)} has invalid owner identity.`,
          )
        }
        if (claim.process_instance_id === this.processInstanceId) {
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Execution lock ${path.basename(marker)} is owned by this active app instance.`,
          )
        }
        // New markers are bound to an app-instance UUID, so a reused OS PID
        // cannot make a crashed marker look live. Legacy PID-only markers stay
        // fail-closed when that PID is alive and require operator review.
        if (!claim.process_instance_id && processIsAlive(claim.process_id)) {
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Legacy execution lock ${path.basename(marker)} appears live and requires operator review.`,
          )
        }
        await unlink(marker)
        recovered += 1
      }
      return recovered
    })
  }

  async getMirrorOwnershipRelease(
    mirrorExecutionId: string,
  ): Promise<MirrorOwnershipReleaseJournal | null> {
    try {
      const journal = mirrorOwnershipReleaseJournalSchema.parse(JSON.parse(
        await readFile(this.mirrorReleaseFile(mirrorExecutionId), 'utf8'),
      ))
      const { content_checksum: _checksum, ...unsigned } = journal
      if (sha256(unsigned) !== journal.content_checksum) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Mirror ownership release journal failed checksum validation.',
        )
      }
      return journal
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async prepareMirrorOwnershipRelease(input: {
    mirror_execution_id: string
    intent_ids: string[]
    proofs: ExecutionNoExposureProof[]
  }): Promise<MirrorOwnershipReleaseJournal> {
    return this.withLock(`mirror-release:${input.mirror_execution_id}`, async () => {
      const existing = await this.getMirrorOwnershipRelease(input.mirror_execution_id)
      if (existing) {
        if (existing.intent_ids.join('\n') !== input.intent_ids.join('\n')) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            'Mirror ownership release evidence conflicts with its durable journal.',
          )
        }
        if (existing.state === 'released') {
          if (sha256(existing.proofs) !== sha256(input.proofs)) {
            throw new ExecutionGatewayError(
              'RECORD_INTEGRITY_FAILURE',
              'Released Mirror ownership evidence is immutable.',
            )
          }
          return existing
        }
        const { content_checksum: _checksum, ...body } = existing
        const unsigned = { ...body, proofs: input.proofs, updated_at: this.now() }
        const refreshed = mirrorOwnershipReleaseJournalSchema.parse({
          ...unsigned, content_checksum: sha256(unsigned),
        })
        await this.atomicWrite(this.mirrorReleaseFile(input.mirror_execution_id), refreshed)
        return refreshed
      }
      const timestamp = this.now()
      const unsigned = {
        release_journal_schema_version: 'mirror-ownership-release-journal@1' as const,
        journal_id: `mirror-release-${sha256(input.mirror_execution_id).slice(0, 32)}`,
        ...input,
        state: 'prepared' as const,
        created_at: timestamp,
        updated_at: timestamp,
      }
      const journal = mirrorOwnershipReleaseJournalSchema.parse({
        ...unsigned, content_checksum: sha256(unsigned),
      })
      await this.atomicWrite(this.mirrorReleaseFile(input.mirror_execution_id), journal)
      return journal
    })
  }

  async markMirrorOwnershipReleased(
    mirrorExecutionId: string,
  ): Promise<MirrorOwnershipReleaseJournal> {
    return this.withLock(`mirror-release:${mirrorExecutionId}`, async () => {
      const current = await this.getMirrorOwnershipRelease(mirrorExecutionId)
      if (!current) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Mirror ownership cannot release without durable provider-flat evidence.',
        )
      }
      if (current.state === 'released') return current
      const { content_checksum: _checksum, ...body } = current
      const unsigned = { ...body, state: 'released' as const, updated_at: this.now() }
      const released = mirrorOwnershipReleaseJournalSchema.parse({
        ...unsigned, content_checksum: sha256(unsigned),
      })
      await this.atomicWrite(this.mirrorReleaseFile(mirrorExecutionId), released)
      return released
    })
  }

  async withProviderMutationLock<T>(
    providerAccountKey: string,
    operationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!providerAccountKey.trim() || providerAccountKey.length > 1_000) {
      throw new Error('Provider account mutation key is invalid.')
    }
    if (!operationId.trim() || operationId.length > 1_000) {
      throw new Error('Provider mutation operation ID is invalid.')
    }
    return this.withLock(`provider-mutation:${providerAccountKey}`, async () => {
      await mkdir(this.providerMutationDirectory, { recursive: true })
      const marker = this.providerMutationFile(providerAccountKey)
      const claim = {
        mutation_lock_schema_version: 'provider-mutation-lock@1',
        provider_account_key: providerAccountKey,
        operation_id: operationId,
        process_id: process.pid,
        process_instance_id: this.processInstanceId,
        acquired_at: this.now(),
      }
      try {
        await writeFile(marker, `${JSON.stringify(claim, null, 2)}\n`, {
          encoding: 'utf8', flag: 'wx', mode: 0o600,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const current = JSON.parse(await readFile(marker, 'utf8')) as {
          process_id?: number
          operation_id?: string
        }
        throw new ExecutionGatewayError(
          'EXECUTION_BUSY',
          `Provider account already has an active mutation (${current.operation_id ?? 'unknown'}).`,
        )
      }
      try {
        return await operation()
      } finally {
        try {
          const current = JSON.parse(await readFile(marker, 'utf8')) as {
            process_id?: number
            operation_id?: string
          }
          if (current.process_id === process.pid && current.operation_id === operationId) {
            await unlink(marker)
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    })
  }

  private async updateControl(
    mutate: (control: ExecutionControlState) => ExecutionControlState,
  ): Promise<ExecutionControlState> {
    return this.withLock('control', async () => {
      const next = this.parseControl({
        ...mutate(await this.readControl()),
        updated_at: this.now(),
      })
      await this.atomicWrite(this.controlFile, next)
      return next
    })
  }

  private parseControl(value: unknown): ExecutionControlState {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Execution control state is invalid.')
    }
    const control = value as Partial<ExecutionControlState>
    if (
      control.control_schema_version !== 'execution-control@1'
      || typeof control.global_kill !== 'boolean'
      || !Array.isArray(control.connection_kills)
      || !control.connection_kills.every((entry) => typeof entry === 'string')
      || !Array.isArray(control.source_kills)
      || !control.source_kills.every((entry) => typeof entry === 'string')
      || (control.activation_release !== undefined && (
        !control.activation_release
        || typeof control.activation_release.release_id !== 'string'
        || typeof control.activation_release.release_event_id !== 'string'
        || typeof control.activation_release.release_event_checksum !== 'string'
        || typeof control.activation_release.state_checksum !== 'string'
        || typeof control.activation_release.committed_at !== 'string'
        || !Number.isFinite(Date.parse(control.activation_release.committed_at))
      ))
      || typeof control.updated_at !== 'string'
      || !Number.isFinite(Date.parse(control.updated_at))
    ) {
      throw new Error('Execution control state is invalid.')
    }
    return control as ExecutionControlState
  }

  private parseOwnershipLease(value: unknown): ExecutionOwnershipLease {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Execution ownership lease is invalid.')
    }
    const lease = value as Partial<ExecutionOwnershipLease>
    if (
      lease.lease_schema_version !== 'execution-ownership-lease@1'
      || !lease.ownership_key?.trim()
      || !lease.intent_id?.trim()
      || !lease.connection_id?.trim()
      || !lease.provider_account_key?.trim()
      || !lease.instrument_id?.trim()
      || typeof lease.acquired_at !== 'string'
      || !Number.isFinite(Date.parse(lease.acquired_at))
    ) {
      throw new Error('Execution ownership lease is invalid.')
    }
    return lease as ExecutionOwnershipLease
  }

  private async atomicWrite(destination: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, destination)
  }

  private recordFile(intentId: string): string {
    this.assertPathSafeIntentId(intentId)
    return path.join(this.recordsDirectory, `${intentId}.json`)
  }

  private claimFile(intentId: string): string {
    this.assertPathSafeIntentId(intentId)
    return path.join(this.recordsDirectory, `${intentId}.claim.json`)
  }

  private managementClaimFile(intentId: string, actionDigest: string): string {
    this.assertPathSafeIntentId(intentId)
    return path.join(
      this.recordsDirectory,
      `${intentId}.management.${actionDigest}.claim.json`,
    )
  }

  private ownershipFile(ownershipKey: string): string {
    if (!ownershipKey.trim() || ownershipKey.length > 1_000) {
      throw new Error('Execution ownership key is invalid.')
    }
    const digest = createHash('sha256').update(ownershipKey, 'utf8').digest('hex')
    return path.join(this.ownershipDirectory, `${digest}.json`)
  }

  private providerMutationFile(providerAccountKey: string): string {
    const digest = createHash('sha256').update(providerAccountKey, 'utf8').digest('hex')
    return path.join(this.providerMutationDirectory, `${digest}.lock.json`)
  }

  private mirrorReleaseFile(mirrorExecutionId: string): string {
    if (!mirrorExecutionId.trim() || mirrorExecutionId.length > 1_000) {
      throw new Error('Mirror execution ID is invalid.')
    }
    const digest = createHash('sha256').update(mirrorExecutionId, 'utf8').digest('hex')
    return path.join(this.mirrorReleaseDirectory, `${digest}.json`)
  }

  private async withOwnershipSetFileLock<T>(
    leases: ExecutionOwnershipLease[],
    operation: () => Promise<T>,
  ): Promise<T> {
    await mkdir(this.ownershipDirectory, { recursive: true })
    const marker = path.join(this.ownershipDirectory, '_ownership-set.lock.json')
    const claim = {
      ownership_set_lock_schema_version: 'ownership-set-lock@1',
      process_id: process.pid,
      process_instance_id: this.processInstanceId,
      operation_id: `ownership-set-${randomUUID()}`,
      leases,
      acquired_at: this.now(),
    }
    try {
      await writeFile(marker, `${JSON.stringify(claim, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      throw new ExecutionGatewayError(
        'EXECUTION_BUSY',
        'Provider ownership admission is already locked.',
      )
    }
    try { return await operation() } finally {
      try {
        const current = JSON.parse(await readFile(marker, 'utf8')) as { operation_id?: string }
        if (current.operation_id === claim.operation_id) await unlink(marker)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }

  private assertPathSafeIntentId(intentId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(intentId)) {
      throw new Error('Execution intent ID is not path-safe.')
    }
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const scopedKey = `${this.root}:${key}`
    const previous = FileExecutionStore.processQueues.get(scopedKey) ?? Promise.resolve()
    let release!: () => void
    const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    FileExecutionStore.processQueues.set(scopedKey, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (FileExecutionStore.processQueues.get(scopedKey) === current) {
        FileExecutionStore.processQueues.delete(scopedKey)
      }
    }
  }
}

const processIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const toggle = (values: string[], value: string, enabled: boolean): string[] => (
  enabled
    ? [...new Set([...values, value])].sort()
    : values.filter((entry) => entry !== value)
)

const verifyRecordIntegrity = (record: ExecutionRecord): ExecutionRecord => {
  if (computeOrderIntentChecksum(record.intent) !== record.intent.content_checksum) {
    throw new ExecutionGatewayError(
      'RECORD_INTEGRITY_FAILURE',
      `Execution record ${record.intent.intent_id} has an invalid intent checksum.`,
    )
  }
  if (
    record.receipt
    && computeExecutionReceiptChecksum(record.receipt) !== record.receipt.content_checksum
  ) {
    throw new ExecutionGatewayError(
      'RECORD_INTEGRITY_FAILURE',
      `Execution record ${record.intent.intent_id} has an invalid receipt checksum.`,
    )
  }
  for (const action of record.management_actions) {
    if (computeManagementCommandChecksum(action.command) !== action.command.content_checksum) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        `Execution record ${record.intent.intent_id} has an invalid management-command checksum.`,
      )
    }
    if (
      action.acknowledgment
      && computeManagementAcknowledgmentChecksum(action.acknowledgment)
        !== action.acknowledgment.content_checksum
    ) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        `Execution record ${record.intent.intent_id} has an invalid management-acknowledgment checksum.`,
      )
    }
  }
  return record
}
