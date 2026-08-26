import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  OPTIONS_DISCORD_FOLLOWUP_RECEIPT_SCHEMA_VERSION,
  optionsDiscordFollowupReceiptSchema,
  type DiscordManagementMessage,
  type DiscordManagementResolutionStrategy,
  type OptionsDiscordFollowupActionReceipt,
  type OptionsDiscordFollowupReceipt,
  type OptionsExecutionRecord,
} from '@trade-god/contracts'

import { computeDiscordManagementMessageChecksum, sha256 } from '../canonical.ts'
import type { DiscordManagementFamilyProbe } from '../sources/discord-management-family-resolver.ts'
import { parseDiscordManagementText } from '../sources/discord-management-parser.ts'
import { FileOptionsAutomationPlanStore, FileOptionsAutomationReceiptStore } from './options-automatic-entry.ts'
import type { FileOptionsExecutionStore } from './options-execution-store.ts'
import type { OptionsPositionManager } from './options-position-manager.ts'

type OptionsManagementRuntime = {
  executions: FileOptionsExecutionStore
  positionManager: OptionsPositionManager
}

type OptionsParsedAction = ReturnType<typeof parseDiscordManagementText>['actions'][number]
  | { operation: 'cancel-entry'; source_phrase: string }

export class FileDiscordOptionsTradeManager {
  private queue: Promise<void> = Promise.resolve()
  private readonly maxMessageAgeMs: number

  constructor(private readonly options: {
    directory: string
    automationReceipts: FileOptionsAutomationReceiptStore
    automationPlans: FileOptionsAutomationPlanStore
    resolveRuntime(connectionId: string): Promise<OptionsManagementRuntime>
    now?: () => string
    maxMessageAgeMs?: number
  }) {
    this.maxMessageAgeMs = options.maxMessageAgeMs ?? 24 * 60 * 60_000
  }

  async probe(message: DiscordManagementMessage): Promise<DiscordManagementFamilyProbe> {
    this.assertMessage(message)
    const policyError = this.messagePolicyError(message)
    if (policyError) return { family: 'options', candidates: [], error: policyError }
    const parsed = parseOptionsManagementText(message.raw_text)
    if (parsed.error || parsed.actions.length !== 1
      || !['flatten', 'partial-close', 'cancel-entry'].includes(parsed.actions[0]!.operation)) {
      return { family: 'options', candidates: [], error: parsed.error ?? 'Options follow-ups support canceling an unfilled entry or closing owned contracts.' }
    }
    const candidates = await this.candidates(message)
    const reply = message.reply_to_message_id
    if (reply) {
      const entryMatch = candidates.filter((candidate) => candidate.entryMessageId === reply)
      if (entryMatch.length === 1) return { family: 'options', candidates: candidates.map((item) => item.intentId), resolved: entryMatch[0]!.intentId, strategy: 'reply-entry' }
      const prior = (await this.list()).filter((receipt) => receipt.source_message.message_id === reply)
      const followupMatch = candidates.filter((candidate) => prior.some((receipt) => receipt.resolved_intent_id === candidate.intentId))
      if (followupMatch.length === 1) return { family: 'options', candidates: candidates.map((item) => item.intentId), resolved: followupMatch[0]!.intentId, strategy: 'reply-followup' }
      return { family: 'options', candidates: candidates.map((item) => item.intentId), error: 'Reply does not identify one active automatic options trade.' }
    }
    if (candidates.length === 1) {
      return {
        family: 'options', candidates: [candidates[0]!.intentId], resolved: candidates[0]!.intentId,
        strategy: message.thread_id ? 'single-thread-trade' : 'single-channel-trade',
      }
    }
    return {
      family: 'options', candidates: candidates.map((item) => item.intentId), retryable: candidates.length === 0,
      error: candidates.length === 0
        ? 'No active automatic options trade matches this trader and channel yet.'
        : 'More than one automatic options trade matches; reply to the exact entry or follow-up.',
    }
  }

  ingestMessage(message: DiscordManagementMessage): Promise<OptionsDiscordFollowupReceipt> {
    return this.withLock(async () => {
      const probe = await this.probe(message)
      if (!probe.resolved || !probe.strategy) return this.blocked(message, probe.candidates, probe.error ?? 'Options trade is ambiguous.')
      return this.ingestResolvedUnlocked(message, probe.resolved, probe.strategy)
    })
  }

  ingestResolvedMessage(message: DiscordManagementMessage, expectedTargetId: string,
    strategy: DiscordManagementResolutionStrategy): Promise<OptionsDiscordFollowupReceipt> {
    return this.withLock(() => this.ingestResolvedUnlocked(message, expectedTargetId, strategy))
  }

  async recoverPending(): Promise<OptionsDiscordFollowupReceipt[]> {
    return this.withLock(async () => {
      const recovered: OptionsDiscordFollowupReceipt[] = []
      for (const receipt of (await this.list()).filter((item) => item.status === 'prepared' || item.status === 'executing').reverse()) {
        recovered.push(await this.execute(receipt))
      }
      return recovered
    })
  }

  private async ingestResolvedUnlocked(message: DiscordManagementMessage, expectedTargetId: string,
    strategy: DiscordManagementResolutionStrategy): Promise<OptionsDiscordFollowupReceipt> {
    this.assertMessage(message)
    const existing = await this.getOrNull(message.message_id)
    if (existing) {
      if (existing.source_message.content_checksum !== message.content_checksum
        || existing.resolved_intent_id !== expectedTargetId || existing.resolution_strategy !== strategy) {
        throw new Error('Frozen options follow-up identity conflicts with replayed evidence.')
      }
      if (existing.status === 'prepared' || existing.status === 'executing') {
        if (await this.hasNewerAccepted(existing)) {
          return this.update(existing, { status: 'failed', error: 'A newer options follow-up superseded this instruction.', updated_at: this.now() })
        }
        return this.execute(existing)
      }
      return existing
    }
    const policyError = this.messagePolicyError(message)
    if (policyError) return this.blocked(message, [], policyError)
    const probe = await this.probe(message)
    if (!probe.candidates.includes(expectedTargetId)) throw new Error('Frozen options family target is no longer in the exact candidate set.')
    const parsed = parseOptionsManagementText(message.raw_text)
    const instruction = parsed.actions[0]
    if (!instruction || !['flatten', 'partial-close', 'cancel-entry'].includes(instruction.operation)) {
      return this.blocked(message, probe.candidates, parsed.error ?? 'Options follow-up action is unsupported.')
    }
    const target = (await this.candidates(message)).find((candidate) => candidate.intentId === expectedTargetId)
    if (!target) throw new Error('Exact automatic options lineage is unavailable.')
    const later = (await this.list()).find((receipt) => receipt.resolved_intent_id === expectedTargetId
      && Date.parse(receipt.source_message.posted_at) > Date.parse(message.posted_at)
      && receipt.status !== 'blocked')
    if (later) return this.blocked(message, probe.candidates, 'A newer options follow-up was already accepted for this trade.')
    const actions = this.actions(instruction)
    const timestamp = this.now()
    const body = {
      followup_receipt_schema_version: OPTIONS_DISCORD_FOLLOWUP_RECEIPT_SCHEMA_VERSION,
      receipt_id: `options-followup:${sha256(message.message_id).slice(0, 32)}`,
      source_message: message, resolution_strategy: strategy as OptionsDiscordFollowupReceipt['resolution_strategy'],
      candidate_intent_ids: probe.candidates, resolved_intent_id: expectedTargetId,
      status: 'prepared' as const, actions, evidence: [`Frozen automatic options entry ${target.entryMessageId}.`],
      error: undefined, created_at: timestamp, updated_at: timestamp,
    }
    const receipt = await this.saveNew(this.sign(body))
    return this.execute(receipt)
  }

  private async execute(receipt: OptionsDiscordFollowupReceipt): Promise<OptionsDiscordFollowupReceipt> {
    if (await this.hasNewerAccepted(receipt)) {
      return this.update(receipt, { status: 'failed', error: 'A newer options follow-up superseded this instruction.', updated_at: this.now() })
    }
    const plan = (await this.options.automationPlans.list()).find((item) => item.decision.decision_id === receipt.resolved_intent_id)
    if (!plan) throw new Error('Options follow-up has no frozen automatic entry plan.')
    const runtime = await this.options.resolveRuntime(plan.connection.connection_id)
    let current = receipt
    for (const action of current.actions) {
      if (action.status === 'completed') continue
      const requestId = `discord-options:${sha256({ message: current.source_message.content_checksum, index: action.index }).slice(0, 32)}`
      const managementId = `options-management:${sha256({ request: requestId, intent: current.resolved_intent_id, action: action.logical_action.operation === 'cancel-entry' ? 'cancel-entry' : 'close-position' }).slice(0, 32)}`
      current = await this.updateAction(current, action.index, { status: 'executing', management_id: managementId })
      try {
        const latestAction = current.actions[action.index]!
        if (latestAction.logical_action.operation === 'cancel-entry') {
          const managed = await runtime.positionManager.cancelWorkingEntry({ intent_id: current.resolved_intent_id!, request_id: requestId, reason: 'signal-no-fill' })
          if (managed.state === 'cancel-unknown') return current
          if (managed.state !== 'entry-canceled' && managed.state !== 'position-open') {
            return this.failAction(current, action.index, `Entry cancellation ended in ${managed.state}.`)
          }
          current = await this.completeAction(current, action.index, managed.management_id, managed.content_checksum, `Entry remainder reconciled as ${managed.state}.`)
          continue
        }
        const entry = await runtime.executions.getRecord(current.resolved_intent_id!)
        if (entry.open_quantity === 0 && entry.state === 'canceled-flat' && latestAction.logical_action.quantity === 'all') {
          current = await this.completeAction(current, action.index, undefined, undefined, 'Entry had no fill; account is already flat.')
          continue
        }
        const quantity = latestAction.logical_action.quantity ?? {
          numerator: latestAction.logical_action.fraction!.numerator,
          denominator: latestAction.logical_action.fraction!.denominator,
        }
        const managed = await runtime.positionManager.closePosition({
          intent_id: current.resolved_intent_id!, request_id: requestId, reason: 'signal-exit', quantity, minimum_credit: '0.01',
        })
        const done = managed.state === 'closed-flat'
          || (managed.closed_quantity === managed.requested_close_quantity && managed.remaining_open_quantity > 0)
        if (!done && (managed.state === 'close-canceled' || managed.state === 'partial-close-canceled')) {
          return this.failAction(current, action.index, `Options close ended in ${managed.state}.`)
        }
        if (!done) return current
        current = await this.completeAction(current, action.index, managed.management_id, managed.content_checksum,
          `Exact options close reconciled as ${managed.state}; ${managed.remaining_open_quantity} remain.`)
      } catch (error) {
        return this.failAction(current, action.index, safeError(error))
      }
    }
    return this.update(current, { status: 'completed', error: undefined, updated_at: this.now() })
  }

  private actions(action: OptionsParsedAction): OptionsDiscordFollowupActionReceipt[] {
    const cancel: OptionsDiscordFollowupActionReceipt = {
      index: 0, logical_action: { operation: 'cancel-entry', reason: 'signal-exit', source_phrase: action.source_phrase }, status: 'pending',
    }
    if (action.operation === 'cancel-entry') return [cancel]
    if (action.operation === 'flatten') return [cancel, {
      index: 1, logical_action: { operation: 'close-position', quantity: 'all', fraction: null, source_phrase: action.source_phrase }, status: 'pending',
    }]
    if (action.operation !== 'partial-close') throw new Error('Options follow-up action is unsupported.')
    const ratio = action.quantity ? null : fractionRatio(action.fraction!)
    return [cancel, {
      index: 1,
      logical_action: { operation: 'close-position', quantity: action.quantity ?? null, fraction: ratio, source_phrase: action.source_phrase },
      status: 'pending',
    }]
  }

  private async hasNewerAccepted(receipt: OptionsDiscordFollowupReceipt): Promise<boolean> {
    return (await this.list()).some((candidate) => candidate.receipt_id !== receipt.receipt_id
      && candidate.resolved_intent_id === receipt.resolved_intent_id
      && Date.parse(candidate.source_message.posted_at) > Date.parse(receipt.source_message.posted_at)
      && candidate.status !== 'blocked')
  }

  private async candidates(message: DiscordManagementMessage): Promise<Array<{ intentId: string; entryMessageId: string }>> {
    const receipts = await this.options.automationReceipts.list()
    const plans = await this.options.automationPlans.list()
    const results: Array<{ intentId: string; entryMessageId: string }> = []
    for (const receipt of receipts) {
      if (!receipt.execution_intent_id || !receipt.connection_id
        || receipt.author_id !== message.author_id || receipt.channel_id !== message.channel_id
        || (receipt.thread_id ?? undefined) !== message.thread_id) continue
      const plan = plans.find((candidate) => candidate.receipt_id === receipt.receipt_id)
      if (!plan || plan.decision.decision_id !== receipt.execution_intent_id) continue
      const runtime = await this.options.resolveRuntime(receipt.connection_id)
      const record = await runtime.executions.getRecordOrNull(receipt.execution_intent_id)
      if (!record || !manageable(record)) continue
      results.push({ intentId: record.intent_id, entryMessageId: receipt.message_id })
    }
    return [...new Map(results.map((item) => [item.intentId, item])).values()]
  }

  private async blocked(message: DiscordManagementMessage, candidates: string[], error: string): Promise<OptionsDiscordFollowupReceipt> {
    const existing = await this.getOrNull(message.message_id)
    if (existing) return existing
    const timestamp = this.now()
    return this.saveNew(this.sign({
      followup_receipt_schema_version: OPTIONS_DISCORD_FOLLOWUP_RECEIPT_SCHEMA_VERSION,
      receipt_id: `options-followup:${sha256(message.message_id).slice(0, 32)}`, source_message: message,
      resolution_strategy: undefined, candidate_intent_ids: candidates, resolved_intent_id: undefined,
      status: 'blocked' as const, actions: [], evidence: ['No provider mutation was attempted.'], error,
      created_at: timestamp, updated_at: timestamp,
    }))
  }

  private completeAction(receipt: OptionsDiscordFollowupReceipt, index: number, managementId: string | undefined,
    checksum: string | undefined, evidence: string): Promise<OptionsDiscordFollowupReceipt> {
    return this.updateAction(receipt, index, {
      status: 'completed', ...(managementId ? { management_id: managementId, management_record_checksum: checksum } : {}),
      completed_at: this.now(), evidence: [evidence], error: undefined,
    })
  }

  private failAction(receipt: OptionsDiscordFollowupReceipt, index: number, error: string): Promise<OptionsDiscordFollowupReceipt> {
    return this.update(receipt, {
      status: 'failed', error, updated_at: this.now(),
      actions: receipt.actions.map((item) => item.index === index
        ? { ...item, status: 'failed' as const, error }
        : item),
    })
  }

  private updateAction(receipt: OptionsDiscordFollowupReceipt, index: number,
    changes: Partial<OptionsDiscordFollowupActionReceipt>): Promise<OptionsDiscordFollowupReceipt> {
    return this.update(receipt, {
      status: changes.status === 'executing' ? 'executing' : receipt.status,
      actions: receipt.actions.map((action) => action.index === index ? { ...action, ...changes } : action), updated_at: this.now(),
    })
  }

  private async getOrNull(messageId: string): Promise<OptionsDiscordFollowupReceipt | null> {
    try { return verify(JSON.parse(await readFile(this.file(messageId), 'utf8'))) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async list(): Promise<OptionsDiscordFollowupReceipt[]> {
    let names: string[]
    try { names = (await readdir(this.options.directory)).filter((name) => name.endsWith('.json')).sort() } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.map(async (name) => verify(JSON.parse(await readFile(path.join(this.options.directory, name), 'utf8')))))
  }

  private async saveNew(receipt: OptionsDiscordFollowupReceipt): Promise<OptionsDiscordFollowupReceipt> {
    await mkdir(this.options.directory, { recursive: true })
    try { await writeFile(this.file(receipt.source_message.message_id), `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return (await this.getOrNull(receipt.source_message.message_id))! }
    return receipt
  }

  private async update(receipt: OptionsDiscordFollowupReceipt, changes: Partial<OptionsDiscordFollowupReceipt>): Promise<OptionsDiscordFollowupReceipt> {
    const current = await this.getOrNull(receipt.source_message.message_id)
    if (!current || current.content_checksum !== receipt.content_checksum) throw new Error('Options follow-up changed before transition.')
    const { content_checksum: _checksum, ...body } = current
    const next = this.sign({ ...body, ...changes })
    const temporary = `${this.file(receipt.source_message.message_id)}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.file(receipt.source_message.message_id))
    return next
  }

  private sign(input: Omit<OptionsDiscordFollowupReceipt, 'content_checksum'>): OptionsDiscordFollowupReceipt {
    return optionsDiscordFollowupReceiptSchema.parse({ ...input, content_checksum: sha256(input) })
  }

  private file(messageId: string): string { return path.join(this.options.directory, `${sha256(messageId)}.json`) }
  private now(): string { return this.options.now?.() ?? new Date().toISOString() }
  private assertMessage(message: DiscordManagementMessage): void {
    if (message.content_checksum !== computeDiscordManagementMessageChecksum(message)) throw new Error('Options follow-up message checksum failed.')
  }
  private messagePolicyError(message: DiscordManagementMessage): string | undefined {
    if (message.is_edit) return 'Edited Discord messages cannot change an options trade.'
    const age = Date.parse(this.now()) - Date.parse(message.posted_at)
    if (age < -60_000) return 'Future-dated Discord messages are not executable.'
    if (age > this.maxMessageAgeMs) return 'Stale Discord messages are not executable.'
    return undefined
  }
  private withLock<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }
}

function parseOptionsManagementText(rawText: string): { actions: OptionsParsedAction[]; error?: string } {
  const parsed = parseDiscordManagementText(rawText)
  if (parsed.error && parsed.error !== 'Message has no supported trade-management instruction.') return parsed
  const normalized = rawText.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ')
  if (/\b(?:do not|don't|dont|never|cannot|can't|cant|won't|wont|shouldn't|shouldnt)\s+(?:cancel|pull)\b/.test(normalized)) {
    return { actions: [], error: 'Negated cancel instructions are not executable.' }
  }
  const cancel = /\b(?:no\s+fill|not\s+filled|did(?:n't|\s+not)\s+fill|cancel(?:\s+(?:it|the\s+order|order|entry))?|pull(?:\s+(?:it|the\s+order|order))?)\b/i.exec(rawText)
  if (!cancel) return parsed
  if (parsed.actions.length > 0) return { actions: [], error: 'Canceling an entry cannot be combined with a close or stop instruction.' }
  return { actions: [{ operation: 'cancel-entry', source_phrase: cancel[0] }] }
}

const manageable = (record: OptionsExecutionRecord): boolean => ['working', 'partially-filled', 'open-position'].includes(record.state)

function fractionRatio(fraction: number): { numerator: number; denominator: number } {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) throw new Error('Partial close fraction is invalid.')
  const denominator = 10_000
  const numerator = Math.round(fraction * denominator)
  const divisor = gcd(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}
const gcd = (left: number, right: number): number => right === 0 ? left : gcd(right, left % right)
const safeError = (error: unknown): string => error instanceof Error ? error.message.slice(0, 1_000) : 'Unknown options management failure.'
const verify = (input: unknown): OptionsDiscordFollowupReceipt => {
  const receipt = optionsDiscordFollowupReceiptSchema.parse(input)
  const { content_checksum: _checksum, ...body } = receipt
  if (sha256(body) !== receipt.content_checksum) throw new Error('Options follow-up receipt checksum failed.')
  return receipt
}
