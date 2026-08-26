import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  optionsManagementCommandSchema,
  optionsManagementRecordSchema,
  type OptionsManagementCommand,
  type OptionsManagementRecord,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'

export class FileOptionsManagementStore {
  private readonly commands: string
  private readonly records: string

  constructor(root: string) {
    this.commands = path.join(root, 'management-commands')
    this.records = path.join(root, 'management-records')
  }

  saveCommand(command: OptionsManagementCommand): Promise<OptionsManagementCommand> {
    return this.saveImmutable(this.commands, command.command_id, verifyCommand(command))
  }

  saveRecord(record: OptionsManagementRecord): Promise<OptionsManagementRecord> {
    return this.saveImmutable(this.records, record.management_id, verifyRecord(record))
  }

  getCommand(commandId: string): Promise<OptionsManagementCommand> {
    return this.read(this.commands, commandId, verifyCommand)
  }

  getRecord(managementId: string): Promise<OptionsManagementRecord> {
    return this.read(this.records, managementId, verifyRecord)
  }

  async getRecordOrNull(managementId: string): Promise<OptionsManagementRecord | null> {
    try { return await this.getRecord(managementId) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async updateRecord(managementId: string, expectedChecksum: string, changes: Partial<OptionsManagementRecord>): Promise<OptionsManagementRecord> {
    const current = await this.getRecord(managementId)
    if (current.content_checksum !== expectedChecksum) throw new Error('Options management record changed before transition.')
    const { content_checksum: _checksum, ...body } = current
    const unsigned = { ...body, ...changes }
    const next = verifyRecord({ ...unsigned, content_checksum: sha256(unsigned) })
    await this.atomicWrite(this.file(this.records, managementId), next)
    return next
  }

  async listRecords(): Promise<OptionsManagementRecord[]> {
    let files: string[]
    try { files = (await readdir(this.records)).filter((file) => file.endsWith('.json')).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const records: OptionsManagementRecord[] = []
    for (const file of files) {
      const parsed = verifyRecord(JSON.parse(await readFile(path.join(this.records, file), 'utf8')))
      if (file !== `${sha256(parsed.management_id)}.json`) throw new Error('Options management record is stored under the wrong identity.')
      records.push(parsed)
    }
    return records.sort((left, right) => left.created_at.localeCompare(right.created_at))
  }

  private async saveImmutable<T extends { content_checksum: string }>(directory: string, id: string, value: T): Promise<T> {
    await mkdir(directory, { recursive: true })
    const destination = this.file(directory, id)
    try {
      await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = JSON.parse(await readFile(destination, 'utf8')) as { content_checksum?: string }
      if (existing.content_checksum === value.content_checksum) return value
      throw new Error('Immutable options management evidence conflicts.')
    }
  }

  private async read<T>(directory: string, id: string, verify: (value: unknown) => T): Promise<T> {
    return verify(JSON.parse(await readFile(this.file(directory, id), 'utf8')))
  }

  private file(directory: string, id: string): string {
    if (!id.trim() || id.length > 1_000) throw new Error('Options management identity is invalid.')
    return path.join(directory, `${sha256(id)}.json`)
  }

  private async atomicWrite(destination: string, value: unknown): Promise<void> {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, destination)
  }
}

function verifyCommand(value: unknown): OptionsManagementCommand {
  return verify(value, optionsManagementCommandSchema.parse)
}

function verifyRecord(value: unknown): OptionsManagementRecord {
  return verify(value, optionsManagementRecordSchema.parse)
}

function verify<T extends { content_checksum: string }>(value: unknown, parse: (value: unknown) => T): T {
  const parsed = parse(value)
  const { content_checksum: _checksum, ...unsigned } = parsed
  if (sha256(unsigned) !== parsed.content_checksum) throw new Error('Options management evidence failed checksum validation.')
  return parsed
}
