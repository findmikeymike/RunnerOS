import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  DISCORD_MANAGEMENT_MESSAGE_SCHEMA_VERSION,
  DISCORD_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
  discoTraderPushPayloadSchema,
  discordManagementMessageSchema,
  discordManagementReceiptSchema,
  type DiscordManagementActionReceipt,
  type DiscordManagementLogicalAction,
  type DiscordManagementMessage,
  type DiscordManagementReceipt,
  type DiscordManagementResolutionStrategy,
  type ExecutionManagementPayload,
  type ExecutionRecord,
} from '@trade-god/contracts'

import {
  computeDiscordManagementMessageChecksum,
  computeDiscordManagementReceiptChecksum,
  sha256,
} from '../canonical.ts'
import { ExecutionGatewayError } from '../errors.ts'
import type { DiscoTraderIntentSourceArtifact } from './discotrader-intent-source.ts'
import {
  parseDiscordManagementText,
  type ParsedDiscordManagementAction,
} from './discord-management-parser.ts'

export interface DiscordTradeManagementGateway {
  list(): Promise<ExecutionRecord[]>
  get(intentId: string): Promise<ExecutionRecord>
  reconcile(intentId: string): Promise<ExecutionRecord>
  closePosition(intentId: string, quantity: number): Promise<ExecutionRecord>
  flatten(intentId: string, reason: string): Promise<ExecutionRecord>
  modifyOrder(
    intentId: string,
    input: Omit<Extract<ExecutionManagementPayload, { operation: 'modify' }>, 'operation'>,
  ): Promise<ExecutionRecord>
  prepareStopMove(
    intentId: string,
    target: 'breakeven' | string,
  ): Promise<Omit<Extract<ExecutionManagementPayload, { operation: 'modify' }>, 'operation'>>
}

export interface DiscordIntentSourceReader {
  get(intentId: string): Promise<DiscoTraderIntentSourceArtifact>
}

export interface DiscordTradeManagerOptions {
  directory: string
  gateway: DiscordTradeManagementGateway
  source: DiscordIntentSourceReader
  now?: () => string
  maxMessageAgeMs?: number
  afterGatewayAction?: (
    receipt: DiscordManagementReceipt,
    action: DiscordManagementActionReceipt,
    record: ExecutionRecord,
  ) => Promise<void> | void
}

interface Candidate {
  record: ExecutionRecord
  source: DiscoTraderIntentSourceArtifact
  sourceChannelId: string
}

interface Resolution {
  candidates: Candidate[]
  resolved?: Candidate
  strategy?: DiscordManagementResolutionStrategy
  error?: string
}

export const buildDiscordManagementMessage = (
  input: Omit<
    DiscordManagementMessage,
    'management_message_schema_version' | 'content_checksum'
  >,
): DiscordManagementMessage => {
  const unsigned = {
    management_message_schema_version: DISCORD_MANAGEMENT_MESSAGE_SCHEMA_VERSION,
    ...input,
  } satisfies Omit<DiscordManagementMessage, 'content_checksum'>
  return discordManagementMessageSchema.parse({
    ...unsigned,
    content_checksum: computeDiscordManagementMessageChecksum(unsigned),
  })
}

export class FileDiscordTradeManager {
  private readonly now: () => string
  private readonly maxMessageAgeMs: number

  constructor(private readonly options: DiscordTradeManagerOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.maxMessageAgeMs = options.maxMessageAgeMs ?? 24 * 60 * 60_000
  }

  async ingestPush(input: unknown): Promise<DiscordManagementReceipt> {
    const payload = discoTraderPushPayloadSchema.parse(input)
    if (payload.kind !== 'management' || !payload.management) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Only a DiscoTrader management push can manage a gateway trade.',
      )
    }
    return this.ingestMessage(payload.management)
  }

  async ingestMessage(input: unknown): Promise<DiscordManagementReceipt> {
    const message = discordManagementMessageSchema.parse(input)
    this.verifyMessage(message)
    const existing = await this.readReceiptIfPresent(message.message_id)
    if (existing) {
      if (existing.source_message.content_checksum !== message.content_checksum) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Discord message ID conflicts with a different immutable payload.',
        )
      }
      return existing.status === 'prepared' || existing.status === 'executing'
        ? this.executeReceipt(existing)
        : existing
    }

    const parsed = parseDiscordManagementText(message.raw_text)
    const policyError = this.messagePolicyError(message) ?? parsed.error
    if (policyError) {
      return this.createReceipt(message, {
        status: 'blocked',
        candidates: [],
        actions: [],
        evidence: ['No gateway mutation was attempted.'],
        error: policyError,
      })
    }

    const resolution = await this.resolve(message, parsed.symbol)
    if (!resolution.resolved || !resolution.strategy) {
      return this.createReceipt(message, {
        status: 'blocked',
        candidates: resolution.candidates.map(({ record }) => record.intent.intent_id),
        actions: [],
        evidence: ['No gateway mutation was attempted.'],
        error: resolution.error ?? 'Discord management message did not resolve to one active trade.',
      })
    }

    let actions: DiscordManagementActionReceipt[]
    try {
      const needsPreflight = parsed.actions.some((action) => action.operation !== 'reconcile')
      const currentRecord = needsPreflight
        ? await this.options.gateway.reconcile(resolution.resolved.record.intent.intent_id)
        : resolution.resolved.record
      actions = this.prepareLogicalActions(currentRecord, parsed.actions)
    } catch (error) {
      return this.createReceipt(message, {
        status: 'blocked',
        candidates: resolution.candidates.map(({ record }) => record.intent.intent_id),
        resolvedIntentId: resolution.resolved.record.intent.intent_id,
        strategy: resolution.strategy,
        symbol: parsed.symbol,
        actions: [],
        evidence: ['Trade resolution succeeded, but deterministic action planning failed.'],
        error: error instanceof Error ? error.message : 'Discord management plan is invalid.',
      })
    }

    const receipt = await this.createReceipt(message, {
      status: 'prepared',
      candidates: resolution.candidates.map(({ record }) => record.intent.intent_id),
      resolvedIntentId: resolution.resolved.record.intent.intent_id,
      strategy: resolution.strategy,
      symbol: parsed.symbol,
      actions,
      evidence: [
        `Matched immutable Discord author ${message.author_id}.`,
        `Resolved by ${resolution.strategy}.`,
        'Exact ordered action plan persisted before gateway mutation.',
      ],
    })
    return this.executeReceipt(receipt)
  }

  async get(messageId: string): Promise<DiscordManagementReceipt> {
    const receipt = await this.readReceiptIfPresent(messageId)
    if (!receipt) {
      throw new ExecutionGatewayError(
        'INTENT_NOT_FOUND',
        `Discord management receipt for ${messageId} was not found.`,
      )
    }
    return receipt
  }

  async recoverPending(): Promise<DiscordManagementReceipt[]> {
    const receipts = await this.listReceipts()
    const recovered: DiscordManagementReceipt[] = []
    for (const receipt of receipts) {
      if (receipt.status === 'prepared' || receipt.status === 'executing') {
        recovered.push(await this.executeReceipt(receipt))
      }
    }
    return recovered
  }

  private verifyMessage(message: DiscordManagementMessage): void {
    if (message.content_checksum !== computeDiscordManagementMessageChecksum(message)) {
      throw new ExecutionGatewayError(
        'RECORD_INTEGRITY_FAILURE',
        'Discord management message checksum does not match its immutable fields.',
      )
    }
  }

  private messagePolicyError(message: DiscordManagementMessage): string | undefined {
    if (message.is_edit) return 'Edited Discord messages cannot create trade mutations.'
    const age = Date.parse(this.now()) - Date.parse(message.posted_at)
    if (age < -60_000) return 'Future-dated Discord messages are not executable.'
    if (age > this.maxMessageAgeMs) return 'Stale Discord messages are not executable.'
    return undefined
  }

  private async resolve(message: DiscordManagementMessage, symbol?: string): Promise<Resolution> {
    const records = (await this.options.gateway.list()).filter((record) => (
      record.intent.source.type === 'discord'
      && record.intent.source.author_id === message.author_id
      && record.command
    ))
    const allCandidates: Candidate[] = []
    for (const record of records) {
      const source = await this.options.source.get(record.intent.intent_id)
      if (
        source.source_author_id !== message.author_id
        || source.intent.intent_id !== record.intent.intent_id
      ) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'DiscoTrader source identity does not match its gateway record.',
        )
      }
      allCandidates.push({
        record,
        source,
        sourceChannelId: discordChannelId(source.source_ticket.provenance.channelUrl),
      })
    }

    if (message.reply_to_message_id) {
      const entryMatches = allCandidates.filter(
        ({ source }) => source.source_message_id === message.reply_to_message_id,
      )
      if (entryMatches.length > 0) {
        return authoritativeResolution(entryMatches, 'reply-entry')
      }
      const prior = (await this.listReceipts()).filter((receipt) => (
        receipt.source_message.message_id === message.reply_to_message_id
        && receipt.source_message.author_id === message.author_id
        && receipt.resolved_intent_id
        && ['prepared', 'executing', 'completed'].includes(receipt.status)
      ))
      const intentIds = [...new Set(prior.map((receipt) => receipt.resolved_intent_id!))]
      if (intentIds.length > 0) {
        return authoritativeResolution(
          allCandidates.filter(({ record }) => intentIds.includes(record.intent.intent_id)),
          'reply-followup',
        )
      }
      return {
        candidates: [],
        error: 'Reply target is not an accepted entry or management follow-up.',
      }
    }

    let candidates = allCandidates.filter(({ sourceChannelId }) => (
      sourceChannelId === message.channel_id
      || (
        message.thread_id === message.channel_id
        && message.parent_channel_id === sourceChannelId
      )
    ))
    const strategy: DiscordManagementResolutionStrategy = message.thread_id
      ? symbol
        ? 'thread-symbol'
        : 'single-thread-trade'
      : symbol
        ? 'channel-symbol'
        : 'single-channel-trade'
    if (symbol) {
      candidates = candidates.filter(
        ({ record }) => instrumentMatchesRoot(record.intent.instrument.symbol, symbol),
      )
    }
    candidates = candidates.filter(({ record }) => isManagementEligible(record))
    if (candidates.length !== 1) {
      return {
        candidates,
        error: candidates.length === 0
          ? 'No active trade matches this author and Discord channel context.'
          : 'More than one active trade matches; an exact reply or symbol is required.',
      }
    }
    return { candidates, resolved: candidates[0], strategy }
  }

  private prepareLogicalActions(
    record: ExecutionRecord,
    parsed: ParsedDiscordManagementAction[],
  ): DiscordManagementActionReceipt[] {
    if (!isManagementEligible(record)) {
      throw new Error('Resolved trade is not protected and active.')
    }
    const openQuantity = confirmedOpenQuantity(record)
    return parsed.map((action, index): DiscordManagementActionReceipt => {
      let logicalAction: DiscordManagementLogicalAction
      let concretePayload: ExecutionManagementPayload | undefined
      if (action.operation === 'partial-close') {
        const quantity = action.quantity ?? openQuantity * (action.fraction ?? 0)
        if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity >= openQuantity) {
          throw new Error(
            'Partial-close sizing must produce an exact positive contract count smaller than the open position.',
          )
        }
        logicalAction = {
          operation: 'partial-close',
          quantity,
          source_phrase: action.source_phrase,
        }
        concretePayload = { operation: 'partial-close', quantity }
      } else if (action.operation === 'flatten') {
        logicalAction = action
        concretePayload = { operation: 'flatten', reason: action.reason }
      } else {
        logicalAction = action
      }
      return {
        index,
        logical_action: logicalAction,
        ...(concretePayload ? { concrete_payload: concretePayload } : {}),
        status: 'pending',
      }
    })
  }

  private async executeReceipt(input: DiscordManagementReceipt): Promise<DiscordManagementReceipt> {
    let receipt = input
    if (!receipt.resolved_intent_id) return receipt
    const resolvedIntentId = receipt.resolved_intent_id
    for (const planned of receipt.actions) {
      if (planned.status === 'completed') continue
      if (planned.status === 'failed') return receipt
      let concrete = planned.concrete_payload
      try {
        if (planned.logical_action.operation === 'move-stop' && !concrete) {
          const target = planned.logical_action.target.basis === 'breakeven'
            ? 'breakeven'
            : planned.logical_action.target.price
          const prepared = await this.options.gateway.prepareStopMove(
            resolvedIntentId,
            target,
          )
          concrete = { operation: 'modify', ...prepared }
        }
        receipt = await this.updateReceipt(receipt, (current) => {
          current.status = 'executing'
          const action = current.actions[planned.index]!
          action.status = 'executing'
          if (concrete) action.concrete_payload = concrete
          return current
        })
      } catch (error) {
        return this.failAction(receipt, planned.index, error)
      }

      let record: ExecutionRecord
      try {
        record = await this.executeAction(
          resolvedIntentId,
          receipt.actions[planned.index]!,
        )
        this.assertActionOutcome(receipt.actions[planned.index]!, record)
      } catch (error) {
        return this.failAction(receipt, planned.index, error)
      }

      await this.options.afterGatewayAction?.(receipt, receipt.actions[planned.index]!, record)
      const commandId = managementCommandId(record, receipt.actions[planned.index]!.concrete_payload)
      if (
        receipt.actions[planned.index]!.logical_action.operation !== 'reconcile'
        && !commandId
      ) {
        return this.failAction(
          receipt,
          planned.index,
          new Error('Gateway mutation completed without a matching durable management command ID.'),
        )
      }
      receipt = await this.updateReceipt(receipt, (current) => {
        const action = current.actions[planned.index]!
        action.status = 'completed'
        action.completed_at = this.now()
        if (commandId) action.management_command_id = commandId
        return current
      })
    }
    return this.updateReceipt(receipt, (current) => {
      current.status = 'completed'
      current.evidence.push('Every planned action reconciled to the required gateway state.')
      return current
    })
  }

  private async executeAction(
    intentId: string,
    action: DiscordManagementActionReceipt,
  ): Promise<ExecutionRecord> {
    if (action.logical_action.operation === 'reconcile') {
      return this.options.gateway.reconcile(intentId)
    }
    const payload = action.concrete_payload
    if (!payload) throw new Error('Concrete gateway payload was not persisted.')
    if (payload.operation === 'partial-close') {
      return this.options.gateway.closePosition(intentId, payload.quantity)
    }
    if (payload.operation === 'flatten') {
      return this.options.gateway.flatten(intentId, payload.reason)
    }
    if (payload.operation === 'modify') {
      const { operation: _operation, ...input } = payload
      return this.options.gateway.modifyOrder(intentId, input)
    }
    throw new Error('Discord management cannot issue cancellation commands.')
  }

  private assertActionOutcome(
    action: DiscordManagementActionReceipt,
    record: ExecutionRecord,
  ): void {
    if (
      action.logical_action.operation === 'partial-close'
      || action.logical_action.operation === 'move-stop'
    ) {
      if (record.state !== 'protected' || !record.receipt?.protection_verified) {
        throw new Error('Gateway did not verify a protected remaining position.')
      }
      return
    }
    if (action.logical_action.operation === 'flatten') {
      if (record.state !== 'closed') throw new Error('Gateway did not verify the position flat.')
      return
    }
    if (record.state !== 'closed' && record.state !== 'canceled') {
      throw new Error('Provider truth does not confirm the reported stop-out.')
    }
  }

  private async failAction(
    receipt: DiscordManagementReceipt,
    index: number,
    error: unknown,
  ): Promise<DiscordManagementReceipt> {
    const message = error instanceof Error ? error.message : 'Gateway management action failed.'
    return this.updateReceipt(receipt, (current) => {
      current.status = 'failed'
      current.error = message
      const action = current.actions[index]!
      action.status = 'failed'
      action.error = message
      return current
    })
  }

  private async createReceipt(
    message: DiscordManagementMessage,
    input: {
      status: DiscordManagementReceipt['status']
      candidates: string[]
      resolvedIntentId?: string
      strategy?: DiscordManagementResolutionStrategy
      symbol?: string
      actions: DiscordManagementActionReceipt[]
      evidence: string[]
      error?: string
    },
  ): Promise<DiscordManagementReceipt> {
    const timestamp = this.now()
    const unsigned = {
      management_receipt_schema_version: DISCORD_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
      receipt_id: `discord-management-${sha256(message.message_id).slice(0, 32)}`,
      source_message: message,
      ...(input.strategy ? { resolution_strategy: input.strategy } : {}),
      candidate_intent_ids: [...new Set(input.candidates)].sort(),
      ...(input.resolvedIntentId ? { resolved_intent_id: input.resolvedIntentId } : {}),
      ...(input.symbol ? { symbol_evidence: input.symbol } : {}),
      status: input.status,
      actions: input.actions,
      evidence: input.evidence,
      ...(input.error ? { error: input.error } : {}),
      created_at: timestamp,
      updated_at: timestamp,
    } satisfies Omit<DiscordManagementReceipt, 'content_checksum'>
    const receipt = discordManagementReceiptSchema.parse({
      ...unsigned,
      content_checksum: computeDiscordManagementReceiptChecksum(unsigned),
    })
    await mkdir(this.options.directory, { recursive: true })
    try {
      await writeFile(this.receiptPath(message.message_id), `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      return receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(message.message_id)
      if (existing.source_message.content_checksum !== message.content_checksum) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Discord message ID conflicts with a different immutable payload.',
        )
      }
      return existing
    }
  }

  private async updateReceipt(
    receipt: DiscordManagementReceipt,
    mutate: (current: DiscordManagementReceipt) => DiscordManagementReceipt,
  ): Promise<DiscordManagementReceipt> {
    const current = await this.get(receipt.source_message.message_id)
    const changed = mutate(structuredClone(current))
    changed.updated_at = this.now()
    const { content_checksum: _ignored, ...unsigned } = changed
    const next = discordManagementReceiptSchema.parse({
      ...unsigned,
      content_checksum: computeDiscordManagementReceiptChecksum(unsigned),
    })
    const destination = this.receiptPath(receipt.source_message.message_id)
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, destination)
    return next
  }

  private async readReceiptIfPresent(messageId: string): Promise<DiscordManagementReceipt | null> {
    try {
      const receipt = discordManagementReceiptSchema.parse(JSON.parse(
        await readFile(this.receiptPath(messageId), 'utf8'),
      ))
      this.verifyMessage(receipt.source_message)
      if (receipt.content_checksum !== computeDiscordManagementReceiptChecksum(receipt)) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Discord management receipt checksum does not match its durable fields.',
        )
      }
      return receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async listReceipts(): Promise<DiscordManagementReceipt[]> {
    try {
      const files = (await readdir(this.options.directory))
        .filter((file) => file.endsWith('.management.json'))
        .sort()
      return Promise.all(files.map(async (file) => {
        const receipt = discordManagementReceiptSchema.parse(JSON.parse(
          await readFile(path.join(this.options.directory, file), 'utf8'),
        ))
        this.verifyMessage(receipt.source_message)
        if (receipt.content_checksum !== computeDiscordManagementReceiptChecksum(receipt)) {
          throw new ExecutionGatewayError(
            'RECORD_INTEGRITY_FAILURE',
            'Discord management receipt checksum does not match its durable fields.',
          )
        }
        return receipt
      }))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private receiptPath(messageId: string): string {
    return path.join(this.options.directory, `${sha256(messageId)}.management.json`)
  }
}

const authoritativeResolution = (
  candidates: Candidate[],
  strategy: DiscordManagementResolutionStrategy,
): Resolution => {
  const eligible = candidates.filter(({ record }) => isManagementEligible(record))
  if (eligible.length !== 1) {
    return {
      candidates,
      error: eligible.length === 0
        ? 'Authoritative reply target is no longer an active protected trade.'
        : 'Authoritative reply target maps to more than one active trade.',
    }
  }
  return { candidates, resolved: eligible[0], strategy }
}

const isManagementEligible = (record: ExecutionRecord): boolean => (
  record.state === 'protected'
  && Boolean(record.command)
  && Boolean(record.receipt?.protection_verified)
)

const confirmedOpenQuantity = (record: ExecutionRecord): number => {
  const stops = record.receipt?.protection_orders?.filter(
    (order) => order.role === 'stop-loss',
  ) ?? []
  if (stops.length !== 1) {
    throw new Error('Confirmed open quantity requires exactly one active provider stop order.')
  }
  return stops[0]!.quantity
}

const discordChannelId = (channelUrl: string): string => {
  const url = new URL(channelUrl)
  if (!['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)) {
    throw new ExecutionGatewayError(
      'RECORD_INTEGRITY_FAILURE',
      'DiscoTrader source channel URL is not hosted by Discord.',
    )
  }
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'channels' || !segments[2]) {
    throw new ExecutionGatewayError(
      'RECORD_INTEGRITY_FAILURE',
      'DiscoTrader source channel URL cannot be resolved to an immutable Discord channel ID.',
    )
  }
  return segments[2]
}

const managementCommandId = (
  record: ExecutionRecord,
  payload?: ExecutionManagementPayload,
): string | undefined => {
  if (!payload) return undefined
  const digest = sha256(payload)
  return record.management_actions.findLast(
    ({ command }) => sha256(command.payload) === digest,
  )?.command.management_command_id
}

const instrumentMatchesRoot = (instrument: string, root: string): boolean => {
  const normalized = instrument.toUpperCase()
  return normalized === root || new RegExp(`^${root}[FGHJKMNQUVXZ]\\d{1,4}$`).test(normalized)
}
