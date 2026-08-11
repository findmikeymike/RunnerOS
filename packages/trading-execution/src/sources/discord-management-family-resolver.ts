import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  DISCORD_MANAGEMENT_FAMILY_RECEIPT_SCHEMA_VERSION,
  discoTraderPushPayloadSchema,
  discordManagementFamilyReceiptSchema,
  type DiscordManagementFamilyReceipt,
  type DiscordManagementFamilyTarget,
  type DiscordManagementMessage,
  type DiscordManagementReceipt,
  type DiscordManagementResolutionStrategy,
  type MirrorManagementReceipt,
} from '@trade-god/contracts'

import { computeDiscordManagementMessageChecksum, sha256 } from '../canonical.ts'
import { ExecutionGatewayError } from '../errors.ts'

export interface DiscordManagementFamilyProbe {
  family: 'single' | 'mirror'
  candidates: string[]
  resolved?: string
  strategy?: DiscordManagementResolutionStrategy
  retryable?: boolean
  error?: string
}

export interface DiscordManagementFamilyHandler<T> {
  probe(message: DiscordManagementMessage): Promise<DiscordManagementFamilyProbe>
  ingestMessage(message: DiscordManagementMessage): Promise<T>
  ingestResolvedMessage(
    message: DiscordManagementMessage,
    expectedTargetId: string,
    strategy: DiscordManagementResolutionStrategy,
  ): Promise<T>
}

export type DiscordManagementDispatchResult =
  | DiscordManagementReceipt
  | MirrorManagementReceipt
  | DiscordManagementFamilyReceipt

export class FileDiscordManagementFamilyResolver {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: {
    directory: string
    single: DiscordManagementFamilyHandler<DiscordManagementReceipt>
    mirror: DiscordManagementFamilyHandler<MirrorManagementReceipt>
    now?: () => string
  }) {}

  ingestPush(input: unknown): Promise<DiscordManagementDispatchResult> {
    const payload = discoTraderPushPayloadSchema.parse(input)
    if (payload.kind !== 'management' || !payload.management) {
      throw new ExecutionGatewayError('CAPABILITY_UNAVAILABLE', 'Only management pushes have a trade family.')
    }
    return this.ingestMessage(payload.management)
  }

  ingestMessage(message: DiscordManagementMessage): Promise<DiscordManagementDispatchResult> {
    return this.withLock(async () => {
      if (message.content_checksum !== computeDiscordManagementMessageChecksum(message)) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Management family message checksum failed.')
      }
      const existing = await this.readIfPresent(message.message_id)
      if (existing) {
        if (existing.source_message.content_checksum !== message.content_checksum) {
          throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Management family identity conflicts.')
        }
        if (existing.target) return this.dispatch(existing.target, message)
        return existing.status === 'deferred'
          ? this.resolveAndDispatch(message, existing)
          : existing
      }
      return this.resolveAndDispatch(message)
    })
  }

  recoverPending(): Promise<DiscordManagementDispatchResult[]> {
    return this.withLock(async () => {
      const recovered: DiscordManagementDispatchResult[] = []
      const pending = await this.list()
      const frozen = pending.filter((receipt) => receipt.target).reverse()
      const deferred = pending.filter((receipt) => !receipt.target && receipt.status === 'deferred').reverse()
      for (const receipt of [...frozen, ...deferred]) {
        if (receipt.target) recovered.push(await this.dispatch(receipt.target, receipt.source_message))
        else if (receipt.status === 'deferred') {
          recovered.push(await this.resolveAndDispatch(receipt.source_message, receipt))
        }
      }
      return recovered
    })
  }

  private async resolveAndDispatch(
    message: DiscordManagementMessage,
    existing?: DiscordManagementFamilyReceipt,
  ): Promise<DiscordManagementDispatchResult> {
      const [single, mirror] = await Promise.all([
        this.options.single.probe(message),
        this.options.mirror.probe(message),
      ])
      const candidates = [...targets(single), ...targets(mirror)]
      const familiesWithCandidates = [single, mirror].filter((probe) => probe.candidates.length > 0)
      if (familiesWithCandidates.length > 1) {
        return this.create({
          source_message: message,
          status: 'blocked', candidates,
          evidence: ['Single-account and Mirror candidates were evaluated together before mutation.'],
          error: 'Signal matches both a single trade and a Mirror family; use an exact entry or follow-up reply.',
        }, existing)
      }
      const selected = familiesWithCandidates[0]
      if (!selected?.resolved || !selected.strategy) {
        const retryable = selected?.retryable
          || (familiesWithCandidates.length === 0 && (single.retryable || mirror.retryable))
        return this.create({
          source_message: message,
          status: retryable ? 'deferred' : 'blocked', candidates,
          evidence: ['No gateway mutation was attempted.'],
          error: selected?.error ?? single.error ?? mirror.error ?? 'No trade family matches this message.',
        }, existing)
      }
      const target = targetFor(selected.family, selected.resolved)
      await this.create({
        source_message: message,
        status: 'resolved', candidates, target,
        resolution_strategy: selected.strategy,
        evidence: [`Frozen ${selected.family} trade family ${selected.resolved} before management dispatch.`],
      }, existing)
      return this.dispatch(target, message)
  }

  private async dispatch(
    target: DiscordManagementFamilyTarget,
    message: DiscordManagementMessage,
  ): Promise<DiscordManagementReceipt | MirrorManagementReceipt> {
    const receipt = await this.readIfPresent(message.message_id)
    if (
      !receipt?.resolution_strategy
      || !receipt.target
      || JSON.stringify(receipt.target) !== JSON.stringify(target)
    ) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Frozen family target or strategy is unavailable.')
    }
    return target.family === 'single'
      ? this.options.single.ingestResolvedMessage(
          message,
          target.intent_id,
          receipt.resolution_strategy,
        )
      : this.options.mirror.ingestResolvedMessage(
          message,
          target.mirror_execution_id,
          receipt.resolution_strategy,
        )
  }

  private async create(
    input: Omit<DiscordManagementFamilyReceipt, 'family_receipt_schema_version' | 'receipt_id' | 'created_at' | 'content_checksum'>,
    existing?: DiscordManagementFamilyReceipt,
  ): Promise<DiscordManagementFamilyReceipt> {
    const unsigned = {
      family_receipt_schema_version: DISCORD_MANAGEMENT_FAMILY_RECEIPT_SCHEMA_VERSION,
      receipt_id: `management-family-${sha256(input.source_message.message_id).slice(0, 32)}`,
      ...input,
      candidates: uniqueTargets(input.candidates),
      created_at: existing?.created_at ?? this.options.now?.() ?? new Date().toISOString(),
    } satisfies Omit<DiscordManagementFamilyReceipt, 'content_checksum'>
    const receipt = discordManagementFamilyReceiptSchema.parse({
      ...unsigned, content_checksum: sha256(unsigned),
    })
    await mkdir(this.options.directory, { recursive: true })
    const destination = this.path(input.source_message.message_id)
    if (existing) {
      const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, destination)
      return receipt
    }
    try {
      await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
      return receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      return (await this.readIfPresent(input.source_message.message_id))!
    }
  }

  private async list(): Promise<DiscordManagementFamilyReceipt[]> {
    let files: string[]
    try { files = await readdir(this.options.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const receipts = await Promise.all(files
      .filter((file) => file.endsWith('.management-family.json'))
      .map(async (file) => {
        const receipt = discordManagementFamilyReceiptSchema.parse(
          JSON.parse(await readFile(path.join(this.options.directory, file), 'utf8')),
        )
        const { content_checksum: _checksum, ...unsigned } = receipt
        if (sha256(unsigned) !== receipt.content_checksum) {
          throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Management family receipt checksum failed.')
        }
        return receipt
      }))
    return receipts.sort((left, right) => (
      Date.parse(left.source_message.posted_at) - Date.parse(right.source_message.posted_at)
      || left.source_message.message_id.localeCompare(right.source_message.message_id)
    ))
  }

  private async readIfPresent(messageId: string): Promise<DiscordManagementFamilyReceipt | null> {
    try {
      const receipt = discordManagementFamilyReceiptSchema.parse(
        JSON.parse(await readFile(this.path(messageId), 'utf8')),
      )
      const { content_checksum: _checksum, ...unsigned } = receipt
      if (sha256(unsigned) !== receipt.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Management family receipt checksum failed.')
      }
      return receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private path(messageId: string): string {
    return path.join(this.options.directory, `${sha256(messageId)}.management-family.json`)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
}

const targets = (probe: DiscordManagementFamilyProbe): DiscordManagementFamilyTarget[] => (
  probe.candidates.map((id) => targetFor(probe.family, id))
)

const targetFor = (family: DiscordManagementFamilyProbe['family'], id: string): DiscordManagementFamilyTarget => (
  family === 'single' ? { family, intent_id: id } : { family, mirror_execution_id: id }
)

const uniqueTargets = (targetsInput: DiscordManagementFamilyTarget[]): DiscordManagementFamilyTarget[] => {
  const unique = new Map(targetsInput.map((target) => [JSON.stringify(target), target]))
  return [...unique.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
}
