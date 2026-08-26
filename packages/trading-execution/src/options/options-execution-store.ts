import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  optionsExecutionCommandSchema,
  optionsExecutionRecordSchema,
  optionsOrderIntentSchema,
  optionsProviderPreviewSchema,
  type OptionsExecutionCommand,
  type OptionsExecutionRecord,
  type OptionsOrderIntent,
  type OptionsProviderPreview,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'

export class OptionsExecutionStoreError extends Error {
  constructor(
    public readonly code: 'OPTIONS_EXECUTION_CONFLICT' | 'OPTIONS_EXECUTION_INTEGRITY',
    message: string,
  ) {
    super(message)
    this.name = 'OptionsExecutionStoreError'
  }
}

export class FileOptionsExecutionStore {
  private readonly previews: string
  private readonly intents: string
  private readonly commands: string
  private readonly records: string

  constructor(private readonly root: string) {
    this.previews = path.join(root, 'previews')
    this.intents = path.join(root, 'intents')
    this.commands = path.join(root, 'commands')
    this.records = path.join(root, 'records')
  }

  savePreview(preview: OptionsProviderPreview): Promise<OptionsProviderPreview> {
    return this.saveImmutable(this.previews, preview.preview_id, this.verifyPreview(preview))
  }

  saveIntent(intent: OptionsOrderIntent): Promise<OptionsOrderIntent> {
    return this.saveImmutable(this.intents, intent.intent_id, this.verifyIntent(intent))
  }

  saveCommand(command: OptionsExecutionCommand): Promise<OptionsExecutionCommand> {
    return this.saveImmutable(this.commands, command.command_id, this.verifyCommand(command))
  }

  async createRecord(record: OptionsExecutionRecord): Promise<OptionsExecutionRecord> {
    const verified = this.verifyRecord(record)
    return this.saveImmutable(this.records, record.intent_id, verified)
  }

  async getRecord(intentId: string): Promise<OptionsExecutionRecord> {
    return this.read(this.records, intentId, (value) => this.verifyRecord(value))
  }

  async getRecordOrNull(intentId: string): Promise<OptionsExecutionRecord | null> {
    try {
      return await this.getRecord(intentId)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async getCommand(commandId: string): Promise<OptionsExecutionCommand> {
    return this.read(this.commands, commandId, (value) => this.verifyCommand(value))
  }

  async updateRecord(
    intentId: string,
    expectedChecksum: string,
    changes: Partial<OptionsExecutionRecord>,
  ): Promise<OptionsExecutionRecord> {
    const current = await this.getRecord(intentId)
    if (current.content_checksum !== expectedChecksum) {
      throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_CONFLICT', 'Execution record changed before transition.')
    }
    const { content_checksum: _checksum, ...body } = current
    const unsigned = { ...body, ...changes }
    const next = this.verifyRecord({ ...unsigned, content_checksum: sha256(unsigned) })
    await this.atomicWrite(this.file(this.records, intentId), next)
    return next
  }

  async listRecords(): Promise<OptionsExecutionRecord[]> {
    let files: string[]
    try {
      files = (await readdir(this.records)).filter((file) => file.endsWith('.json')).sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records: OptionsExecutionRecord[] = []
    const ids = new Set<string>()
    for (const file of files) {
      const record = this.verifyRecord(JSON.parse(await readFile(path.join(this.records, file), 'utf8')))
      if (file !== `${sha256(record.intent_id)}.json` || ids.has(record.intent_id)) {
        throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_INTEGRITY', 'Execution record identity is duplicated or misplaced.')
      }
      ids.add(record.intent_id)
      records.push(record)
    }
    return records.sort((left, right) => left.created_at.localeCompare(right.created_at))
  }

  private async saveImmutable<T extends { content_checksum: string }>(
    directory: string,
    id: string,
    value: T,
  ): Promise<T> {
    const destination = this.file(directory, id)
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        const existing = JSON.parse(await readFile(destination, 'utf8')) as { content_checksum?: string }
        if (typeof existing.content_checksum !== 'string') throw new Error('missing checksum')
        const { content_checksum: existingChecksum, ...existingUnsigned } = existing
        if (sha256(existingUnsigned) !== existingChecksum) throw new Error('checksum mismatch')
        if (existingChecksum === value.content_checksum) return value
      } catch (readError) {
        if (readError instanceof OptionsExecutionStoreError) throw readError
        throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_INTEGRITY', 'Immutable options execution evidence was tampered.')
      }
      throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_INTEGRITY', 'Immutable options execution evidence conflicts.')
    }
  }

  private async read<T>(directory: string, id: string, verify: (value: unknown) => T): Promise<T> {
    try {
      return verify(JSON.parse(await readFile(this.file(directory, id), 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error
      if (error instanceof OptionsExecutionStoreError) throw error
      throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_INTEGRITY', 'Options execution evidence failed validation.')
    }
  }

  private verifyPreview(value: unknown): OptionsProviderPreview {
    return verifyChecksummed(value, (candidate) => optionsProviderPreviewSchema.parse(candidate), 'preview')
  }

  private verifyIntent(value: unknown): OptionsOrderIntent {
    return verifyChecksummed(value, (candidate) => optionsOrderIntentSchema.parse(candidate), 'intent')
  }

  private verifyCommand(value: unknown): OptionsExecutionCommand {
    return verifyChecksummed(value, (candidate) => optionsExecutionCommandSchema.parse(candidate), 'command')
  }

  private verifyRecord(value: unknown): OptionsExecutionRecord {
    return verifyChecksummed(value, (candidate) => optionsExecutionRecordSchema.parse(candidate), 'record')
  }

  private file(directory: string, id: string): string {
    if (!id.trim() || id.length > 1_000) throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_INTEGRITY', 'Evidence ID is invalid.')
    return path.join(directory, `${sha256(id)}.json`)
  }

  private async atomicWrite(destination: string, value: unknown): Promise<void> {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }
}

function verifyChecksummed<T extends { content_checksum: string }>(
  value: unknown,
  parse: (value: unknown) => T,
  label: string,
): T {
  try {
    const parsed = parse(value)
    const { content_checksum: _checksum, ...unsigned } = parsed
    if (sha256(unsigned) !== parsed.content_checksum) throw new Error('checksum mismatch')
    return parsed
  } catch {
    throw new OptionsExecutionStoreError('OPTIONS_EXECUTION_INTEGRITY', `Options execution ${label} failed integrity validation.`)
  }
}
