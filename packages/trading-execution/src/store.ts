import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
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
  computeOrderIntentChecksum,
} from './canonical.ts'

export interface ExecutionControlState {
  control_schema_version: 'execution-control@1'
  global_kill: boolean
  connection_kills: string[]
  source_kills: string[]
  updated_at: string
}

const defaultControl = (now: string): ExecutionControlState => ({
  control_schema_version: 'execution-control@1',
  global_kill: false,
  connection_kills: [],
  source_kills: [],
  updated_at: now,
})

export class FileExecutionStore {
  private readonly recordsDirectory: string
  private readonly controlFile: string
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly root: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.recordsDirectory = path.join(root, 'records')
    this.controlFile = path.join(root, 'control.json')
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
          throw new ExecutionGatewayError(
            'EXECUTION_BUSY',
            `Intent ${intentId} already has a durable execution claim.`,
          )
        }
        throw error
      }
      await this.atomicWrite(this.recordFile(intentId), next)
      return next
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

  private assertPathSafeIntentId(intentId: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/.test(intentId)) {
      throw new Error('Execution intent ID is not path-safe.')
    }
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    this.queues.set(key, current)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.queues.get(key) === current) this.queues.delete(key)
    }
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
  return record
}
