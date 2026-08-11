import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  EXECUTION_RECORD_SCHEMA_VERSION,
  executionRecordSchema,
  type ExecutionRecord,
  type OrderIntent,
} from '@trade-god/contracts'

import { ExecutionGatewayError } from './errors.ts'
import {
  computeExecutionReceiptChecksum,
  computeManagementAcknowledgmentChecksum,
  computeManagementCommandChecksum,
  computeOrderIntentChecksum,
} from './canonical.ts'

export interface ExecutionControlState {
  control_schema_version: 'execution-control@1'
  global_kill: boolean
  connection_kills: string[]
  source_kills: string[]
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

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.recordsDirectory = path.join(root, 'records')
    this.controlFile = path.join(root, 'control.json')
    this.ownershipDirectory = path.join(root, 'ownership')
    this.providerMutationDirectory = path.join(root, 'provider-mutations')
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
        }, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          const stale = await readFile(marker, 'utf8').then((value) => JSON.parse(value) as {
            process_id?: number
          })
          if (
            typeof stale.process_id !== 'number'
            || stale.process_id === process.pid
            || processIsAlive(stale.process_id)
          ) {
            throw new ExecutionGatewayError(
              'EXECUTION_BUSY',
              `Intent ${intentId} already has a durable execution claim.`,
            )
          }
          await unlink(marker)
          await writeFile(marker, `${JSON.stringify({
            intent_id: intentId,
            claim_id: next.claim?.claim_id,
            claimed_at: next.claim?.claimed_at,
            process_id: process.pid,
          }, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          })
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
          const stale = await readFile(marker, 'utf8').then((value) => JSON.parse(value) as {
            process_id?: number
          })
          if (
            typeof stale.process_id !== 'number'
            || stale.process_id === process.pid
            || processIsAlive(stale.process_id)
          ) {
            return { record: latest, claimed: false }
          }
          await unlink(marker)
          await writeFile(marker, `${JSON.stringify({
            intent_id: intentId,
            action_digest: actionDigest,
            claimed_at: this.now(),
            process_id: process.pid,
          }, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
          })
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
        acquired_at: this.now(),
      }
      try {
        await writeFile(marker, `${JSON.stringify(claim, null, 2)}\n`, {
          encoding: 'utf8', flag: 'wx', mode: 0o600,
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const stale = JSON.parse(await readFile(marker, 'utf8')) as {
          process_id?: number
          operation_id?: string
        }
        if (typeof stale.process_id !== 'number' || processIsAlive(stale.process_id)) {
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Provider account already has an active mutation (${stale.operation_id ?? 'unknown'}).`,
          )
        }
        await unlink(marker)
        await writeFile(marker, `${JSON.stringify(claim, null, 2)}\n`, {
          encoding: 'utf8', flag: 'wx', mode: 0o600,
        })
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

  private async withOwnershipSetFileLock<T>(
    leases: ExecutionOwnershipLease[],
    operation: () => Promise<T>,
  ): Promise<T> {
    await mkdir(this.ownershipDirectory, { recursive: true })
    const marker = path.join(this.ownershipDirectory, '_ownership-set.lock.json')
    const claim = {
      ownership_set_lock_schema_version: 'ownership-set-lock@1',
      process_id: process.pid,
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
        'Provider ownership admission is locked; stale locks require explicit startup recovery.',
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
