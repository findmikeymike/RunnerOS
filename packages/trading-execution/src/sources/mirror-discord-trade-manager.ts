import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  MIRROR_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
  discoTraderPushPayloadSchema,
  discordManagementMessageSchema,
  mirrorManagementReceiptSchema,
  type DiscordManagementLogicalAction,
  type DiscordManagementMessage,
  type DiscordManagementResolutionStrategy,
  type ExecutionManagementPayload,
  type ExecutionNoExposureProof,
  type MirrorOwnershipReleaseJournal,
  type ExecutionRecord,
  type MirrorExecution,
  type MirrorManagementChild,
  type MirrorManagementChildAction,
  type MirrorManagementReceipt,
  type MirrorManagementInstruction,
} from '@trade-god/contracts'

import { computeDiscordManagementMessageChecksum, sha256 } from '../canonical.ts'
import { ExecutionGatewayError } from '../errors.ts'
import type { FileMirrorExecutionStore } from '../mirror-execution-store.ts'
import {
  parseDiscordManagementText,
  type ParsedDiscordManagementAction,
} from './discord-management-parser.ts'
import type { DiscordTradeManagementGateway } from './discord-trade-manager.ts'
import type { DiscordManagementFamilyProbe } from './discord-management-family-resolver.ts'

export interface MirrorDiscordTradeManagerOptions {
  directory: string
  gateway: DiscordTradeManagementGateway & {
    verifyNoExposure(intentId: string): Promise<ExecutionNoExposureProof>
    proveAndReleaseMirrorOwnership(intentIds: string[]): Promise<MirrorOwnershipReleaseJournal>
  }
  store: FileMirrorExecutionStore
  now?: () => string
  maxMessageAgeMs?: number
  maxConcurrency?: number
}

interface ParentResolution {
  candidates: MirrorExecution[]
  resolved?: MirrorExecution
  strategy?: DiscordManagementResolutionStrategy
  error?: string
  retryable?: boolean
}

interface ChildTruth {
  record: ExecutionRecord
  proof?: ExecutionNoExposureProof
}

export class FileMirrorDiscordTradeManager {
  private readonly now: () => string
  private readonly maxMessageAgeMs: number
  private readonly maxConcurrency: number
  private queue: Promise<void> = Promise.resolve()
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly options: MirrorDiscordTradeManagerOptions) {
    this.now = options.now ?? (() => new Date().toISOString())
    this.maxMessageAgeMs = options.maxMessageAgeMs ?? 24 * 60 * 60_000
    this.maxConcurrency = options.maxConcurrency ?? 4
  }

  ingestPush(input: unknown): Promise<MirrorManagementReceipt> {
    const payload = discoTraderPushPayloadSchema.parse(input)
    if (payload.kind !== 'management' || !payload.management) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Only a DiscoTrader management push can manage a Mirror parent.',
      )
    }
    return this.ingestMessage(payload.management)
  }

  ingestMessage(input: unknown): Promise<MirrorManagementReceipt> {
    return this.withLock(() => this.ingestMessageUnlocked(input))
  }

  ingestResolvedMessage(
    input: DiscordManagementMessage,
    expectedMirrorExecutionId: string,
    strategy: DiscordManagementResolutionStrategy,
  ): Promise<MirrorManagementReceipt> {
    return this.withLock(() => this.ingestMessageUnlocked(
      input,
      expectedMirrorExecutionId,
      strategy,
    ))
  }

  async probe(input: DiscordManagementMessage): Promise<DiscordManagementFamilyProbe> {
    const message = discordManagementMessageSchema.parse(input)
    if (message.content_checksum !== computeDiscordManagementMessageChecksum(message)) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror management message checksum failed.')
    }
    const parsed = parseDiscordManagementText(message.raw_text)
    const policyError = this.messagePolicyError(message) ?? parsed.error
    if (policyError) return { family: 'mirror', candidates: [], error: policyError }
    const resolution = await this.resolve(message, parsed.actions, parsed.symbol)
    return {
      family: 'mirror',
      candidates: resolution.candidates.map((parent) => parent.mirror_execution_id),
      ...(resolution.resolved ? { resolved: resolution.resolved.mirror_execution_id } : {}),
      ...(resolution.strategy ? { strategy: resolution.strategy } : {}),
      ...(resolution.retryable ? { retryable: true } : {}),
      ...(resolution.error ? { error: resolution.error } : {}),
    }
  }

  async get(messageId: string): Promise<MirrorManagementReceipt> {
    const receipt = await this.readReceiptIfPresent(messageId)
    if (!receipt) throw new ExecutionGatewayError('INTENT_NOT_FOUND', 'Mirror management receipt was not found.')
    return receipt
  }

  async recoverPending(): Promise<MirrorManagementReceipt[]> {
    const recovered: MirrorManagementReceipt[] = []
    for (const receipt of await this.listReceipts()) {
      if (receipt.status === 'prepared' || receipt.status === 'executing') {
        recovered.push(await this.withLock(() => this.executeReceipt(receipt)))
      } else if (receipt.mirror_execution_id) {
        const parent = await this.options.store.getParent(receipt.mirror_execution_id)
        if (parent.state === 'closed') {
          const reservation = await this.options.store.getReservation(receipt.mirror_execution_id)
          if (reservation?.state === 'released') continue
          await this.finalizeClosedResources(
            receipt.mirror_execution_id,
            receipt.source_message.message_id,
          )
        }
      }
    }
    return recovered
  }

  private async ingestMessageUnlocked(
    input: unknown,
    expectedMirrorExecutionId?: string,
    expectedStrategy?: DiscordManagementResolutionStrategy,
  ): Promise<MirrorManagementReceipt> {
    const parsedMessage = discordManagementMessageSchema.parse(input)
    if (parsedMessage.content_checksum !== computeDiscordManagementMessageChecksum(parsedMessage)) {
      throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror management message checksum failed.')
    }
    const existing = await this.readReceiptIfPresent(parsedMessage.message_id)
    if (existing) {
      if (existing.source_message.content_checksum !== parsedMessage.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror message identity conflicts.')
      }
      if (expectedMirrorExecutionId && existing.mirror_execution_id !== expectedMirrorExecutionId) {
        throw new ExecutionGatewayError(
          'RECORD_INTEGRITY_FAILURE',
          'Durable Mirror receipt does not match the frozen family target.',
        )
      }
      return existing.status === 'prepared' || existing.status === 'executing'
        ? this.executeReceipt(existing)
        : existing
    }

    const parsed = parseDiscordManagementText(parsedMessage.raw_text)
    const policyError = this.messagePolicyError(parsedMessage) ?? parsed.error
    if (policyError) return this.createBlocked(parsedMessage, [], [], policyError)
    let resolution = await this.resolve(parsedMessage, parsed.actions, parsed.symbol)
    if (expectedMirrorExecutionId) {
      const expected = resolution.candidates.find((parent) => (
        parent.mirror_execution_id === expectedMirrorExecutionId
        && parentAllowsActions(parent, parsed.actions)
      ))
      if (!expected || !expectedStrategy) {
        throw new ExecutionGatewayError(
          'AUTHORIZATION_MISMATCH',
          'Frozen Mirror family target is no longer valid for this immutable message context.',
        )
      }
      resolution = { ...resolution, resolved: expected, strategy: expectedStrategy, error: undefined }
    }
    if (!resolution.resolved || !resolution.strategy) {
      return this.createReceipt({
        source_message: parsedMessage,
        candidate_mirror_execution_ids: resolution.candidates.map((parent) => parent.mirror_execution_id),
        status: resolution.retryable ? 'deferred' : 'blocked',
        logical_actions: [], children: [],
        evidence: ['No gateway mutation was attempted.'],
        error: resolution.error ?? 'Mirror follow-up did not resolve to one active parent.',
      })
    }
    const orderingError = await this.messageOrderingError(parsedMessage, resolution.resolved.mirror_execution_id)
    if (orderingError) {
      return this.createBlocked(
        parsedMessage,
        resolution.candidates.map((parent) => parent.mirror_execution_id),
        [],
        orderingError,
        resolution.resolved,
        resolution.strategy,
        parsed.symbol,
      )
    }

    let children: MirrorManagementChild[]
    try {
      children = await this.preflightChildren(parsedMessage, resolution.resolved, parsed.actions)
    } catch (error) {
      return this.createBlocked(
        parsedMessage,
        resolution.candidates.map((parent) => parent.mirror_execution_id),
        [],
        error instanceof Error ? error.message : 'Mirror child preflight failed.',
        resolution.resolved,
        resolution.strategy,
        parsed.symbol,
      )
    }
    const receipt = await this.createReceipt({
      source_message: parsedMessage,
      resolution_strategy: resolution.strategy,
      candidate_mirror_execution_ids: resolution.candidates.map((parent) => parent.mirror_execution_id),
      mirror_execution_id: resolution.resolved.mirror_execution_id,
      ...(parsed.symbol ? { symbol_evidence: parsed.symbol } : {}),
      status: 'prepared',
      logical_actions: parsed.actions.map(toParentInstruction),
      children,
      evidence: [
        `Resolved immutable Mirror parent ${resolution.resolved.mirror_execution_id}.`,
        'Every eligible child reconciled and the complete action matrix was persisted before mutation.',
      ],
    })
    return this.executeReceipt(receipt)
  }

  private async resolve(
    message: DiscordManagementMessage,
    actions: ParsedDiscordManagementAction[],
    symbol?: string,
  ): Promise<ParentResolution> {
    const all = (await this.options.store.listParents()).filter((parent) => (
      parent.source.author_id === message.author_id
      && (!message.guild_id || parent.source.server_id === message.guild_id)
    ))
    if (message.reply_to_message_id) {
      const entries = all.filter((parent) => parent.source.message_id === message.reply_to_message_id)
      if (entries.length > 0) return authoritativeParent(entries, 'reply-entry', actions)
      const prior = (await this.listReceipts()).filter((receipt) => (
        receipt.source_message.message_id === message.reply_to_message_id
        && receipt.source_message.author_id === message.author_id
        && receipt.mirror_execution_id
        && ['prepared', 'executing', 'completed', 'partial', 'halted'].includes(receipt.status)
      ))
      const ids = new Set(prior.map((receipt) => receipt.mirror_execution_id!))
      if (ids.size > 0) return authoritativeParent(
        all.filter((parent) => ids.has(parent.mirror_execution_id)),
        'reply-followup',
        actions,
      )
      return { candidates: [], error: 'Reply target is not an accepted Mirror entry or follow-up.', retryable: true }
    }

    let candidates = all.filter((parent) => (
      parent.source.channel_id === message.channel_id
      || (
        message.thread_id === message.channel_id
        && message.parent_channel_id === parent.source.channel_id
      )
    ))
    const strategy: DiscordManagementResolutionStrategy = message.thread_id
      ? symbol ? 'thread-symbol' : 'single-thread-trade'
      : symbol ? 'channel-symbol' : 'single-channel-trade'
    if (symbol) candidates = candidates.filter((parent) => instrumentMatchesRoot(
      parent.source.instrument_canonical_id.split(':').at(-1) ?? '',
      symbol,
    ))
    const scoped = candidates
    candidates = candidates.filter((parent) => parentAllowsActions(parent, actions))
    if (candidates.length !== 1) {
      return {
        candidates: scoped,
        error: candidates.length === 0
          ? 'No manageable Mirror parent matches this author and Discord context.'
          : 'More than one Mirror parent matches; an exact reply or symbol is required.',
        retryable: candidates.length === 0 && scoped.some((parent) => (
          parent.state === 'planning' || parent.state === 'admitted' || parent.state === 'dispatching'
        )),
      }
    }
    return { candidates, resolved: candidates[0], strategy }
  }

  private async preflightChildren(
    message: DiscordManagementMessage,
    parent: MirrorExecution,
    actions: ParsedDiscordManagementAction[],
  ): Promise<MirrorManagementChild[]> {
    const children: MirrorManagementChild[] = []
    let activeCount = 0
    for (const [parentChildIndex, child] of parent.children.entries()) {
      let record = await this.options.gateway.get(child.intent_id)
      if (record.command && !TERMINAL_STATES.has(record.state)) {
        record = await this.options.gateway.reconcile(child.intent_id)
      }
      if (!isProtected(record)) {
        const proof = await this.options.gateway.verifyNoExposure(child.intent_id)
        children.push({
          parent_child_index: parentChildIndex,
          member_id: child.member_id, connection_id: child.connection_id,
          intent_id: child.intent_id, status: 'terminal', actions: [],
          execution_record_checksum: proof.execution_record_checksum,
          no_exposure_proof: proof,
        })
        continue
      }
      activeCount += 1
      children.push({
        parent_child_index: parentChildIndex,
        member_id: child.member_id,
        connection_id: child.connection_id,
        intent_id: child.intent_id,
        status: 'prepared',
        actions: await this.planChildActions(message, record, actions),
        execution_record_checksum: sha256(record),
      })
    }
    if (activeCount === 0 && actions.some((action) => action.operation !== 'reconcile')) {
      throw new ExecutionGatewayError('INVALID_STATE', 'Mirror parent has no active child to manage.')
    }
    return children
  }

  private async planChildActions(
    message: DiscordManagementMessage,
    record: ExecutionRecord,
    actions: ParsedDiscordManagementAction[],
  ): Promise<MirrorManagementChildAction[]> {
    const openQuantity = confirmedOpenQuantity(record)
    const hasEarlierReduction = (index: number) => actions.slice(0, index).some(
      (action) => action.operation === 'partial-close',
    )
    const planned: MirrorManagementChildAction[] = []
    for (const [index, action] of actions.entries()) {
      const logical = toLogicalAction(action, openQuantity)
      let concrete: ExecutionManagementPayload | undefined
      if (logical.operation === 'partial-close') {
        concrete = { operation: 'partial-close', quantity: logical.quantity }
      } else if (logical.operation === 'flatten') {
        concrete = { operation: 'flatten', reason: logical.reason }
      } else if (logical.operation === 'move-stop') {
        if (hasEarlierReduction(index)) {
          throw new ExecutionGatewayError(
            'CAPABILITY_UNAVAILABLE',
            'Compound partial-close then stop-move is blocked until the adapter can certify the post-resize stop payload.',
          )
        }
        const target = logical.target.basis === 'breakeven' ? 'breakeven' : logical.target.price
        const prepared = await this.options.gateway.prepareStopMove(record.intent.intent_id, target)
        concrete = { operation: 'modify', ...prepared }
      }
      planned.push({
        index,
        logical_action: logical,
        request_id: childRequestId(message, index, record.intent.intent_id),
        ...(concrete ? { concrete_payload: concrete } : {}),
        status: 'pending',
      })
    }
    return planned
  }

  private async executeReceipt(input: MirrorManagementReceipt): Promise<MirrorManagementReceipt> {
    if (!input.mirror_execution_id) return input
    let receipt = await this.updateReceipt(input, (current) => ({ ...current, status: 'executing' }))
    await this.options.store.updateParent(input.mirror_execution_id, (parent) => {
      if (parent.state === 'closing') return withoutChecksum(parent)
      const timestamp = this.now()
      return withoutChecksum({
        ...parent, state: 'closing',
        transitions: [...parent.transitions, {
          from: parent.state, to: 'closing', reason: 'Mirror Discord follow-up execution started.', at: timestamp,
        }], updated_at: timestamp,
      })
    })
    await mapLimit(
      receipt.children.filter((child) => child.status !== 'terminal'),
      this.maxConcurrency,
      (child) => this.executeChild(receipt.source_message.message_id, child.intent_id),
    )
    receipt = await this.get(receipt.source_message.message_id)
    const truths = new Map<string, ChildTruth>(await Promise.all(receipt.children.map(async (child) => {
      const record = await this.options.gateway.get(child.intent_id)
      if (isProtected(record)) return [child.intent_id, { record }] as const
      try {
        const proof = await this.options.gateway.verifyNoExposure(child.intent_id)
        return [child.intent_id, { record, proof }] as const
      } catch {
        return [child.intent_id, { record }] as const
      }
    })))
    const nextParent = await this.options.store.updateParent(input.mirror_execution_id, (parent) => {
      const timestamp = this.now()
      const children = parent.children.map((child) => {
        const truth = truths.get(child.intent_id)!
        const { record, proof } = truth
        const receiptChild = receipt.children.find((candidate) => candidate.intent_id === child.intent_id)!
        return {
          ...child,
          state: proof
            ? 'terminal' as const
            : receiptChild.status === 'failed' || receiptChild.status === 'blocked'
              ? 'divergent' as const
            : isProtected(record)
              ? 'protected' as const
              : 'unknown' as const,
          execution_record_checksum: proof?.execution_record_checksum ?? sha256(record),
          ...(proof || (isProtected(record) && receiptChild.status !== 'failed' && receiptChild.status !== 'blocked')
            ? { error_code: undefined }
            : { error_code: 'MIRROR_MANAGEMENT_DIVERGENCE' }),
        }
      })
      const successfulChildren = receipt.children.filter((child) => (
        child.status === 'completed' || child.status === 'terminal'
      )).length
      const state: MirrorExecution['state'] = children.every((child) => child.state === 'terminal')
        ? 'closed'
        : children.some((child) => child.state === 'unknown')
          ? 'halted'
          : children.some((child) => child.state === 'divergent')
            ? successfulChildren > 0 ? 'partial' : 'halted'
          : children.some((child) => child.state === 'terminal')
            ? 'partial'
            : 'active'
      return withoutChecksum({
        ...parent, state, children,
        transitions: [...parent.transitions, {
          from: parent.state, to: state, reason: 'Mirror management rollup rebuilt from child truth.', at: timestamp,
        }], updated_at: timestamp,
      })
    })
    const completed = receipt.children.filter((child) => child.status === 'completed' || child.status === 'terminal').length
    const failed = receipt.children.length - completed
    const status: MirrorManagementReceipt['status'] = nextParent.state === 'halted'
      ? 'halted'
      : failed === 0
        ? 'completed'
        : completed > 0 ? 'partial' : 'halted'
    receipt = await this.updateReceipt(receipt, (current) => ({
      ...current,
      children: current.children.map((child) => {
        const truth = truths.get(child.intent_id)!
        if (!truth.proof) return child
        return {
          ...child,
          execution_record_checksum: truth.proof.execution_record_checksum,
          no_exposure_proof: truth.proof,
        }
      }),
      status,
      evidence: [...current.evidence, 'Mirror child result matrix reconciled to gateway truth.'],
      ...(status === 'completed' ? { error: undefined } : { error: 'One or more Mirror children did not complete safely.' }),
    }))
    if (nextParent.state === 'closed') {
      await this.finalizeClosedResources(
        nextParent.mirror_execution_id,
        receipt.source_message.message_id,
      )
      receipt = await this.get(receipt.source_message.message_id)
    }
    return receipt
  }

  private async executeChild(messageId: string, intentId: string): Promise<void> {
    let receipt = await this.get(messageId)
    const initial = receipt.children.find((child) => child.intent_id === intentId)!
    for (const initialAction of initial.actions) {
      receipt = await this.get(messageId)
      const child = receipt.children.find((candidate) => candidate.intent_id === intentId)!
      const action = child.actions[initialAction.index]!
      if (action.status === 'completed') continue
      if (action.status === 'failed') return
      let concrete = action.concrete_payload
      try {
        if (action.logical_action.operation === 'move-stop' && !concrete) {
          const target = action.logical_action.target.basis === 'breakeven'
            ? 'breakeven'
            : action.logical_action.target.price
          concrete = { operation: 'modify', ...await this.options.gateway.prepareStopMove(intentId, target) }
        }
        await this.updateReceipt(receipt, (current) => {
          current.status = 'executing'
          const currentChild = current.children.find((candidate) => candidate.intent_id === intentId)!
          currentChild.status = 'executing'
          const currentAction = currentChild.actions[action.index]!
          currentAction.status = 'executing'
          if (concrete) currentAction.concrete_payload = concrete
          return current
        })
        const record = await executeAction(this.options.gateway, intentId, {
          ...action,
          ...(concrete ? { concrete_payload: concrete } : {}),
        })
        assertActionOutcome(action, record)
        const commandId = managementCommandId(record, concrete, action.request_id)
        if (!record.receipt?.evidence_refs.length) throw new Error('Child action lacks provider evidence.')
        if (action.logical_action.operation !== 'reconcile' && !commandId) {
          throw new Error('Child mutation lacks its exact durable command ID.')
        }
        await this.updateReceipt(await this.get(messageId), (current) => {
          const currentChild = current.children.find((candidate) => candidate.intent_id === intentId)!
          const currentAction = currentChild.actions[action.index]!
          currentAction.status = 'completed'
          currentAction.completed_at = this.now()
          currentAction.gateway_receipt_id = record.receipt!.receipt_id
          currentAction.evidence_refs = record.receipt!.evidence_refs
          if (commandId) currentAction.management_command_id = commandId
          if (currentChild.actions.every((candidate) => candidate.status === 'completed')) {
            currentChild.status = 'completed'
          }
          currentChild.execution_record_checksum = sha256(record)
          return current
        })
      } catch (error) {
        await this.updateReceipt(await this.get(messageId), (current) => {
          const currentChild = current.children.find((candidate) => candidate.intent_id === intentId)!
          currentChild.status = 'failed'
          currentChild.error = error instanceof Error ? error.message : 'Mirror child action failed.'
          const currentAction = currentChild.actions[action.index]!
          currentAction.status = 'failed'
          currentAction.error = currentChild.error
          return current
        })
        return
      }
    }
  }

  private async finalizeClosedResources(
    mirrorExecutionId: string,
    messageId: string,
  ): Promise<void> {
    let parent = await this.options.store.getParent(mirrorExecutionId)
    if (parent.state !== 'closed' || parent.children.some((child) => child.state !== 'terminal')) return
    const releaseJournal = await this.options.gateway.proveAndReleaseMirrorOwnership(
      parent.children.map((child) => child.intent_id),
    )
    const proofs = releaseJournal.proofs
    const proofByIntent = new Map(proofs.map((proof) => [proof.intent_id, proof]))
    parent = await this.options.store.updateParent(mirrorExecutionId, (current) => withoutChecksum({
      ...current,
      children: current.children.map((child) => ({
        ...child,
        execution_record_checksum: proofByIntent.get(child.intent_id)!.execution_record_checksum,
      })),
      updated_at: this.now(),
    }))
    await this.updateReceipt(await this.get(messageId), (current) => ({
      ...current,
      children: current.children.map((child) => ({
        ...child,
        execution_record_checksum: proofByIntent.get(child.intent_id)!.execution_record_checksum,
        no_exposure_proof: proofByIntent.get(child.intent_id)!,
      })),
      evidence: [
        ...current.evidence,
        `Ownership release journal ${releaseJournal.journal_id} persisted before lease deletion.`,
      ],
    }))
    await this.options.store.releaseTerminalReservation(mirrorExecutionId, proofs)
  }

  private messagePolicyError(message: DiscordManagementMessage): string | undefined {
    if (message.is_edit) return 'Edited Discord messages cannot create Mirror mutations.'
    const age = Date.parse(this.now()) - Date.parse(message.posted_at)
    if (age < -60_000) return 'Future-dated Discord messages are not executable.'
    if (age > this.maxMessageAgeMs) return 'Stale Discord messages are not executable.'
    return undefined
  }

  private async messageOrderingError(message: DiscordManagementMessage, parentId: string): Promise<string | undefined> {
    const postedAt = Date.parse(message.posted_at)
    return (await this.listReceipts()).some((receipt) => (
      receipt.source_message.message_id !== message.message_id
      && receipt.mirror_execution_id === parentId
      && ['prepared', 'executing', 'completed', 'partial', 'halted'].includes(receipt.status)
      && Date.parse(receipt.source_message.posted_at) > postedAt
    )) ? 'An older Discord follow-up cannot supersede a newer accepted Mirror instruction.' : undefined
  }

  private createBlocked(
    message: DiscordManagementMessage,
    candidates: string[],
    logicalActions: MirrorManagementInstruction[],
    error: string,
    parent?: MirrorExecution,
    strategy?: DiscordManagementResolutionStrategy,
    symbol?: string,
  ): Promise<MirrorManagementReceipt> {
    return this.createReceipt({
      source_message: message,
      ...(strategy ? { resolution_strategy: strategy } : {}),
      candidate_mirror_execution_ids: candidates,
      ...(parent ? { mirror_execution_id: parent.mirror_execution_id } : {}),
      ...(symbol ? { symbol_evidence: symbol } : {}),
      status: 'blocked', logical_actions: logicalActions, children: [],
      evidence: ['No gateway mutation was attempted.'], error,
    })
  }

  private async createReceipt(
    input: Omit<MirrorManagementReceipt, 'mirror_management_receipt_schema_version' | 'receipt_id' | 'created_at' | 'updated_at' | 'content_checksum'>,
  ): Promise<MirrorManagementReceipt> {
    const timestamp = this.now()
    const unsigned = {
      mirror_management_receipt_schema_version: MIRROR_MANAGEMENT_RECEIPT_SCHEMA_VERSION,
      receipt_id: `mirror-management-${sha256(input.source_message.message_id).slice(0, 32)}`,
      ...input,
      candidate_mirror_execution_ids: [...new Set(input.candidate_mirror_execution_ids)].sort(),
      created_at: timestamp,
      updated_at: timestamp,
    }
    const receipt = mirrorManagementReceiptSchema.parse({
      ...unsigned, content_checksum: sha256(unsigned),
    })
    await mkdir(this.options.directory, { recursive: true })
    try {
      await writeFile(this.receiptPath(input.source_message.message_id), `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: 'utf8', flag: 'wx', mode: 0o600,
      })
      return receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(input.source_message.message_id)
      if (existing.source_message.content_checksum !== input.source_message.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror receipt identity conflicts.')
      }
      return existing
    }
  }

  private updateReceipt(
    receipt: MirrorManagementReceipt,
    mutate: (current: MirrorManagementReceipt) => MirrorManagementReceipt,
  ): Promise<MirrorManagementReceipt> {
    return this.withWriteLock(async () => {
      const current = await this.get(receipt.source_message.message_id)
      const changed = mutate(structuredClone(current))
      changed.updated_at = this.now()
      const { content_checksum: _checksum, ...unsigned } = changed
      const next = mirrorManagementReceiptSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
      const destination = this.receiptPath(receipt.source_message.message_id)
      const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, destination)
      return next
    })
  }

  private async readReceiptIfPresent(messageId: string): Promise<MirrorManagementReceipt | null> {
    try {
      const receipt = mirrorManagementReceiptSchema.parse(JSON.parse(await readFile(this.receiptPath(messageId), 'utf8')))
      const { content_checksum: _checksum, ...unsigned } = receipt
      if (sha256(unsigned) !== receipt.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror management receipt checksum failed.')
      }
      return receipt
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async listReceipts(): Promise<MirrorManagementReceipt[]> {
    let files: string[]
    try { files = await readdir(this.options.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const receipts = await Promise.all(files.filter((file) => file.endsWith('.mirror-management.json')).map(async (file) => {
      const receipt = mirrorManagementReceiptSchema.parse(JSON.parse(
        await readFile(path.join(this.options.directory, file), 'utf8'),
      ))
      const { content_checksum: _checksum, ...unsigned } = receipt
      if (sha256(unsigned) !== receipt.content_checksum) {
        throw new ExecutionGatewayError('RECORD_INTEGRITY_FAILURE', 'Mirror management receipt checksum failed.')
      }
      return receipt
    }))
    return receipts.sort((left, right) => (
      Date.parse(left.source_message.posted_at) - Date.parse(right.source_message.posted_at)
      || left.source_message.message_id.localeCompare(right.source_message.message_id)
    ))
  }

  private receiptPath(messageId: string): string {
    return path.join(this.options.directory, `${sha256(messageId)}.mirror-management.json`)
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue
    let release!: () => void
    this.writeQueue = previous.catch(() => undefined).then(() => new Promise<void>((resolve) => { release = resolve }))
    await previous.catch(() => undefined)
    try { return await operation() } finally { release() }
  }
}

const authoritativeParent = (
  candidates: MirrorExecution[],
  strategy: DiscordManagementResolutionStrategy,
  actions: ParsedDiscordManagementAction[],
): ParentResolution => {
  const eligible = candidates.filter((parent) => parentAllowsActions(parent, actions))
  return eligible.length === 1
    ? { candidates, resolved: eligible[0], strategy }
    : {
        candidates,
        error: eligible.length === 0
          ? 'Authoritative Mirror reply is not currently manageable.'
          : 'Authoritative reply maps to more than one Mirror parent.',
        retryable: eligible.length === 0 && candidates.some((parent) => (
          parent.state === 'planning' || parent.state === 'admitted' || parent.state === 'dispatching'
        )),
      }
}

const parentAllowsActions = (parent: MirrorExecution, actions: ParsedDiscordManagementAction[]): boolean => (
  parent.state === 'active'
  || parent.state === 'partial'
  || (parent.state === 'halted' && actions.every((action) => (
    action.operation === 'flatten' || action.operation === 'reconcile'
  )))
)

const toLogicalAction = (
  action: ParsedDiscordManagementAction,
  openQuantity?: number,
): DiscordManagementLogicalAction => {
  if (action.operation === 'partial-close') {
    const quantity = action.quantity ?? (openQuantity ?? 0) * (action.fraction ?? 0)
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || !openQuantity || quantity >= openQuantity) {
      throw new ExecutionGatewayError(
        'CAPABILITY_UNAVAILABLE',
        'Every Mirror child must express the exact integer partial reduction safely.',
      )
    }
    return { operation: 'partial-close', quantity, source_phrase: action.source_phrase }
  }
  return action
}

const toParentInstruction = (
  action: ParsedDiscordManagementAction,
): MirrorManagementInstruction => {
  if (action.operation !== 'partial-close') return action
  return {
    operation: 'partial-close',
    sizing: action.quantity !== undefined
      ? { basis: 'quantity', quantity: action.quantity }
      : { basis: 'fraction', fraction: action.fraction ?? 0 },
    source_phrase: action.source_phrase,
  }
}

const isProtected = (record: ExecutionRecord): boolean => (
  record.state === 'protected'
  && Boolean(record.command)
  && Boolean(record.receipt?.protection_verified)
  && Boolean(record.receipt?.open_quantity)
)

const confirmedOpenQuantity = (record: ExecutionRecord): number => {
  const stops = record.receipt?.protection_orders?.filter((order) => order.role === 'stop-loss') ?? []
  const quantity = record.receipt?.open_quantity
  if (stops.length !== 1 || !quantity || stops[0]!.quantity !== quantity) {
    throw new ExecutionGatewayError(
      'RECONCILIATION_DIVERGENCE',
      'Mirror child requires one verified stop sized to the confirmed open position.',
    )
  }
  return quantity
}

const executeAction = async (
  gateway: MirrorDiscordTradeManagerOptions['gateway'],
  intentId: string,
  action: MirrorManagementChildAction,
): Promise<ExecutionRecord> => {
  if (action.logical_action.operation === 'reconcile') return gateway.reconcile(intentId)
  const payload = action.concrete_payload
  if (!payload) throw new Error('Concrete Mirror child payload was not persisted.')
  if (payload.operation === 'partial-close') return gateway.closePosition(intentId, payload.quantity, action.request_id)
  if (payload.operation === 'flatten') return gateway.flatten(intentId, payload.reason, action.request_id)
  if (payload.operation === 'modify') {
    const { operation: _operation, ...input } = payload
    return gateway.modifyOrder(intentId, input, action.request_id)
  }
  throw new Error('Mirror Discord management cannot cancel orders.')
}

const assertActionOutcome = (action: MirrorManagementChildAction, record: ExecutionRecord): void => {
  if (action.logical_action.operation === 'partial-close' || action.logical_action.operation === 'move-stop') {
    if (!isProtected(record)) throw new Error('Mirror child did not retain verified protection.')
  } else if (action.logical_action.operation === 'flatten') {
    if (record.state !== 'closed') throw new Error('Mirror child did not reconcile flat.')
  } else if (record.state !== 'closed' && record.state !== 'canceled') {
    throw new Error('Stopped-out report did not reconcile the Mirror child terminal.')
  }
}

const managementCommandId = (
  record: ExecutionRecord,
  payload?: ExecutionManagementPayload,
  requestId?: string,
): string | undefined => {
  if (!payload) return undefined
  return record.management_actions.findLast(({ command }) => command.request_id === requestId)
    ?.command.management_command_id
}

const childRequestId = (
  message: DiscordManagementMessage,
  actionIndex: number,
  intentId: string,
): string => `mirror-management-${sha256({
  source_checksum: message.content_checksum,
  action_index: actionIndex,
  child_intent_id: intentId,
}).slice(0, 32)}`

const instrumentMatchesRoot = (instrument: string, root: string): boolean => {
  const symbol = instrument.toUpperCase()
  return symbol === root || new RegExp(`^${root}[FGHJKMNQUVXZ]\\d{1,4}$`).test(symbol)
}

const TERMINAL_STATES = new Set([
  'risk-denied', 'closed', 'rejected', 'canceled', 'expired',
])

const withoutChecksum = <T extends { content_checksum: string }>(value: T): Omit<T, 'content_checksum'> => {
  const { content_checksum: _checksum, ...unsigned } = value
  return unsigned
}

const mapLimit = async <T>(items: T[], limit: number, operation: (item: T) => Promise<void>): Promise<void> => {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await operation(items[next++]!)
  })
  await Promise.all(workers)
}
