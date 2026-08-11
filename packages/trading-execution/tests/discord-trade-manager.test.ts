import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  ExecutionManagementPayload,
  ExecutionRecord,
} from '@trade-god/contracts'

import {
  FileDiscordTradeManager,
  buildDiscordManagementMessage,
  convertDiscoTraderTicket,
  parseDiscordManagementText,
  sha256,
  type DiscoTraderIntentSourceArtifact,
  type DiscordTradeManagementGateway,
} from '../src/index.ts'

const NOW = '2026-07-30T15:10:01.000Z'

const ticket = (
  messageId = 'discord-entry-1',
  symbol = 'ESU6',
  channelId = '2',
  authorId = 'discord-user-456',
) => ({
  id: `ticket-${messageId}`,
  createdAt: '2026-07-30T15:05:00.000Z',
  mode: 'alert-only',
  action: {
    intent: 'entry',
    symbol: symbol.startsWith('NQ') ? 'NQ' : 'ES',
    side: 'long',
    entry: 5600,
    stop: 5598,
    targets: [5603],
    confidence: 0.95,
    evidence: ['entry:long', 'stop:absolute'],
  },
  symbol: symbol.startsWith('NQ') ? 'NQ' : 'ES',
  tradedSymbol: symbol,
  side: 'long',
  contracts: 4,
  entry: 5600,
  stop: 5598,
  stopDistancePoints: 2,
  targets: [5603],
  riskUsd: 400,
  provenance: {
    messageId,
    author: 'Trader',
    authorId,
    channelUrl: `https://discord.com/channels/1/${channelId}`,
    rawText: `${symbol} long`,
    postedAt: '2026-07-30T15:04:59.000Z',
    observedAt: '2026-07-30T15:05:00.000Z',
    latencyMs: 1_000,
  },
  gateTrail: ['killSwitch:pass', 'sizing:pass'],
  llmVeto: {
    decision: 'accept',
    reason: 'Fixture accepted.',
    model: 'fixture-veto',
    ms: 10,
  },
})

const artifact = (
  messageId = 'discord-entry-1',
  symbol = 'ESU6',
  channelId = '2',
  authorId = 'discord-user-456',
): DiscoTraderIntentSourceArtifact => convertDiscoTraderTicket(
  ticket(messageId, symbol, channelId, authorId),
  {
    connection_id: 'connection-paper',
    source_id: `discord-route-${channelId}-${authorId}`,
    instrument: {
      canonical_id: `CME:${symbol}`,
      symbol,
      exchange: 'XCME',
      expiry: '2026-09',
      tick_size: '0.25',
      point_value_usd: '50',
    },
    valid_for_ms: 60_000,
  },
  '2026-07-30T15:05:00.000Z',
)

const protectedRecord = (
  source: DiscoTraderIntentSourceArtifact,
  quantity = 4,
): ExecutionRecord => ({
  record_schema_version: 'execution-record@1',
  trace_id: `trace-${source.source_message_id}`,
  intent: source.intent,
  state: 'protected',
  claim: { claim_id: 'claim-1', claimed_at: '2026-07-30T15:05:01.000Z' },
  command: {
    command_schema_version: 'execution-command@1',
    command_id: `command-${source.source_message_id}`,
    intent_id: source.intent.intent_id,
    claim_id: 'claim-1',
    connection_id: 'connection-paper',
    adapter_id: 'fake-adapter',
    adapter_version: '1.0.0',
    action_digest: 'a'.repeat(64),
    idempotency_key: 'b'.repeat(64),
    issued_at: '2026-07-30T15:05:01.000Z',
  },
  management_actions: [],
  receipt: {
    receipt_schema_version: 'execution-receipt@1',
    receipt_id: `receipt-${source.source_message_id}`,
    trace_id: `trace-${source.source_message_id}`,
    intent_id: source.intent.intent_id,
    connection_id: 'connection-paper',
    transport: 'api',
    adapter: { id: 'fake-adapter', version: '1.0.0' },
    provider_order_ids: ['entry-1', 'stop-1', 'target-1'],
    result: 'filled-protected',
    filled_quantity: quantity,
    open_quantity: quantity,
    average_fill_price: '5600',
    protection_verified: true,
    protection_orders: [{
      protection_order_schema_version: 'execution-protection-order@1',
      provider_order_id: `stop-${source.source_message_id}`,
      role: 'stop-loss',
      quantity,
      order_type: 'stop',
      time_in_force: 'day',
      stop_price: '5598',
      status: 'working',
    }],
    evidence_refs: ['fake-evidence'],
    completed_at: '2026-07-30T15:05:02.000Z',
    content_checksum: 'c'.repeat(64),
  },
  transitions: [{
    transition_id: 'transition-1',
    from: 'protecting',
    to: 'protected',
    occurred_at: '2026-07-30T15:05:02.000Z',
    reason: 'Fixture protected.',
  }],
  created_at: '2026-07-30T15:05:00.000Z',
  updated_at: '2026-07-30T15:05:02.000Z',
})

class SourceReader {
  constructor(readonly artifacts: DiscoTraderIntentSourceArtifact[]) {}

  async get(intentId: string) {
    const found = this.artifacts.find((item) => item.intent.intent_id === intentId)
    if (!found) throw new Error('source missing')
    return found
  }
}

class FakeGateway implements DiscordTradeManagementGateway {
  readonly log: string[] = []
  readonly delivered = new Set<string>()
  stoppedOut = false

  constructor(readonly records: ExecutionRecord[]) {}

  async list() { return this.records }

  async get(intentId: string) { return this.required(intentId) }

  async reconcile(intentId: string) {
    this.log.push('reconcile')
    const record = this.required(intentId)
    if (this.stoppedOut) {
      record.state = 'closed'
      record.receipt = {
        ...record.receipt!,
        result: 'closed',
        filled_quantity: 0,
        open_quantity: 0,
        protection_verified: false,
      }
    }
    return record
  }

  async closePosition(intentId: string, quantity: number, requestId?: string) {
    const key = requestId ?? `partial:${intentId}:${quantity}`
    const record = this.required(intentId)
    if (!this.delivered.has(key)) {
      this.delivered.add(key)
      this.log.push(`partial:${quantity}`)
      const remaining = record.receipt!.filled_quantity - quantity
      record.receipt = {
        ...record.receipt!,
        filled_quantity: remaining,
        open_quantity: remaining,
        protection_orders: record.receipt!.protection_orders!.map((order) => ({
          ...order,
          quantity: remaining,
        })),
      }
      this.journal(record, { operation: 'partial-close', quantity }, requestId)
    }
    return record
  }

  async flatten(intentId: string, reason: string, requestId?: string) {
    const key = requestId ?? `flatten:${intentId}:${reason}`
    const record = this.required(intentId)
    if (!this.delivered.has(key)) {
      this.delivered.add(key)
      this.log.push('flatten')
      record.state = 'closed'
      record.receipt = {
        ...record.receipt!,
        result: 'closed',
        filled_quantity: 0,
        open_quantity: 0,
        protection_verified: false,
      }
      this.journal(record, { operation: 'flatten', reason }, requestId)
    }
    return record
  }

  async prepareStopMove(intentId: string, target: 'breakeven' | string) {
    const record = this.required(intentId)
    const stop = record.receipt!.protection_orders![0]!
    return {
      provider_order_id: stop.provider_order_id,
      quantity: stop.quantity,
      order_type: 'stop' as const,
      stop_price: target === 'breakeven' ? record.receipt!.average_fill_price! : target,
      time_in_force: stop.time_in_force,
    }
  }

  async modifyOrder(
    intentId: string,
    input: Omit<Extract<ExecutionManagementPayload, { operation: 'modify' }>, 'operation'>,
    requestId?: string,
  ) {
    const payload = { operation: 'modify' as const, ...input }
    const key = requestId ?? `modify:${intentId}:${sha256(payload)}`
    const record = this.required(intentId)
    if (!this.delivered.has(key)) {
      this.delivered.add(key)
      this.log.push(`stop:${input.stop_price}`)
      this.journal(record, payload, requestId)
    }
    return record
  }

  private required(intentId: string): ExecutionRecord {
    const found = this.records.find((record) => record.intent.intent_id === intentId)
    if (!found) throw new Error('record missing')
    return found
  }

  private journal(
    record: ExecutionRecord,
    payload: ExecutionManagementPayload,
    requestId?: string,
  ): void {
    record.management_actions.push({
      command: {
        management_command_schema_version: 'execution-management-command@1',
        management_command_id: `management-${this.delivered.size}`,
        ...(requestId ? { request_id: requestId } : {}),
        parent_command_id: record.command!.command_id,
        intent_id: record.intent.intent_id,
        claim_id: record.claim!.claim_id,
        connection_id: record.intent.connection_id,
        adapter_id: 'fake-adapter',
        adapter_version: '1.0.0',
        payload,
        action_digest: sha256(payload),
        idempotency_key: sha256({ payload, intent: record.intent.intent_id }),
        issued_at: NOW,
        content_checksum: 'd'.repeat(64),
      },
    })
  }
}

const message = (rawText: string, overrides: Record<string, unknown> = {}) => buildDiscordManagementMessage({
  message_id: 'discord-followup-1',
  author_id: 'discord-user-456',
  channel_id: '2',
  raw_text: rawText,
  posted_at: '2026-07-30T15:10:00.000Z',
  observed_at: NOW,
  is_edit: false,
  ...overrides,
})

const setup = async (
  sources = [artifact()],
  quantities = [4],
  afterGatewayAction?: ConstructorParameters<typeof FileDiscordTradeManager>[0]['afterGatewayAction'],
) => {
  const gateway = new FakeGateway(sources.map((source, index) => (
    protectedRecord(source, quantities[index] ?? 4)
  )))
  const manager = new FileDiscordTradeManager({
    directory: await mkdtemp(path.join(tmpdir(), 'discord-trade-manager-')),
    gateway,
    source: new SourceReader(sources),
    now: () => NOW,
    afterGatewayAction,
  })
  return { gateway, manager }
}

describe('Discord management-only parser', () => {
  test('keeps partial exit before breakeven in a compound message', () => {
    expect(parseDiscordManagementText('taking off half here, moving stops to BE').actions)
      .toMatchObject([
        { operation: 'partial-close', fraction: 0.5 },
        { operation: 'move-stop', target: { basis: 'breakeven' } },
      ])
  })

  test('understands discretionary close and refuses questions and vague sizing', () => {
    expect(parseDiscordManagementText("ehh not loving this closing here").actions[0])
      .toMatchObject({ operation: 'flatten' })
    expect(parseDiscordManagementText('should I close here?').actions).toHaveLength(0)
    expect(parseDiscordManagementText('take some off').actions).toHaveLength(0)
    expect(parseDiscordManagementText("don't close here").actions).toHaveLength(0)
    expect(parseDiscordManagementText("I can't close here").actions).toHaveLength(0)
    expect(parseDiscordManagementText('do not move stop to BE').actions).toHaveLength(0)
    expect(parseDiscordManagementText('moving stops to be safe').actions).toHaveLength(0)
    expect(parseDiscordManagementText('close here in 5 minutes').actions).toHaveLength(0)
    expect(parseDiscordManagementText('close here after CPI').actions).toHaveLength(0)
    expect(parseDiscordManagementText('flat').actions[0]).toMatchObject({ operation: 'flatten' })
    expect(parseDiscordManagementText('done').actions[0]).toMatchObject({ operation: 'flatten' })
    expect(parseDiscordManagementText("I'm out of patience here").actions).toHaveLength(0)
    expect(parseDiscordManagementText('done here analyzing this').actions).toHaveLength(0)
  })
})

describe('Discord trade manager', () => {
  test('executes half then breakeven in strict reconciled order and joins command IDs', async () => {
    const { gateway, manager } = await setup()
    const receipt = await manager.ingestMessage(message('taking off half here, moving stops to BE'))

    expect(gateway.log).toEqual(['reconcile', 'partial:2', 'stop:5600'])
    expect(receipt.status).toBe('completed')
    expect(receipt.actions.map((action) => action.management_command_id))
      .toEqual(['management-1', 'management-2'])
    expect(receipt.actions[1]!.concrete_payload).toMatchObject({
      operation: 'modify',
      quantity: 2,
      stop_price: '5600',
    })
    expect(receipt.actions[1]).toMatchObject({
      gateway_receipt_id: expect.any(String),
      evidence_refs: ['fake-evidence'],
    })
  })

  test('uses exact reply identity and blocks wrong-author and cross-channel messages', async () => {
    const { manager } = await setup()
    const exact = await manager.ingestMessage(message('all out', {
      message_id: 'followup-exact',
      channel_id: '99',
      reply_to_message_id: 'discord-entry-1',
    }))
    expect(exact.status).toBe('completed')
    expect(exact.resolution_strategy).toBe('reply-entry')

    const wrong = await manager.ingestMessage(message('all out', {
      message_id: 'followup-wrong',
      author_id: 'another-user',
    }))
    expect(wrong.status).toBe('blocked')

    const { manager: otherManager } = await setup()
    const cross = await otherManager.ingestMessage(message('all out', {
      message_id: 'followup-cross',
      channel_id: '99',
    }))
    expect(cross.status).toBe('blocked')
  })

  test('uses explicit symbol to resolve multiple same-channel trades', async () => {
    const sources = [artifact('entry-es', 'ESU6'), artifact('entry-nq', 'NQU6')]
    const { gateway, manager } = await setup(sources)
    const receipt = await manager.ingestMessage(message('NQ closing here'))

    expect(receipt.status).toBe('completed')
    expect(receipt.resolved_intent_id).toBe(sources[1]!.intent.intent_id)
    expect(gateway.log).toEqual(['reconcile', 'flatten'])
  })

  test('uses parent-channel context to resolve one active trade from a thread', async () => {
    const { manager } = await setup()
    const receipt = await manager.ingestMessage(message('all out', {
      message_id: 'thread-followup',
      channel_id: 'thread-12',
      thread_id: 'thread-12',
      parent_channel_id: '2',
    }))

    expect(receipt.status).toBe('completed')
    expect(receipt.resolution_strategy).toBe('single-thread-trade')
  })

  test('rejects Discord-looking channel paths hosted outside Discord', async () => {
    const source = artifact()
    source.source_ticket.provenance.channelUrl = 'https://evil.example/channels/1/2'
    const { manager } = await setup([source])

    await expect(manager.ingestMessage(message('all out'))).rejects.toMatchObject({
      code: 'RECORD_INTEGRITY_FAILURE',
    })
  })

  test('blocks ambiguity, odd halves, edits, and stale messages without mutation', async () => {
    const sources = [artifact('entry-a'), artifact('entry-b')]
    const ambiguous = await setup(sources)
    expect((await ambiguous.manager.ingestMessage(message('all out'))).status).toBe('blocked')
    expect(ambiguous.gateway.log).toEqual([])

    const odd = await setup([artifact()], [3])
    expect((await odd.manager.ingestMessage(message('taking off half'))).status).toBe('blocked')
    expect(odd.gateway.log).toEqual(['reconcile'])

    const edited = await setup()
    expect((await edited.manager.ingestMessage(message('all out', {
      message_id: 'edited',
      is_edit: true,
    }))).status).toBe('blocked')
    expect(edited.gateway.log).toEqual([])

    const stale = await setup()
    expect((await stale.manager.ingestMessage(message('all out', {
      message_id: 'stale',
      posted_at: '2026-07-28T15:10:00.000Z',
      observed_at: '2026-07-28T15:10:01.000Z',
    }))).status).toBe('blocked')
    expect(stale.gateway.log).toEqual([])
  })

  test('replays duplicate messages and crash recovery without a second partial close', async () => {
    let crashed = false
    const { gateway, manager } = await setup([artifact()], [4], (_receipt, action) => {
      if (!crashed && action.logical_action.operation === 'partial-close') {
        crashed = true
        throw new Error('simulated-process-crash')
      }
    })
    const sourceMessage = message('taking off half here, moving stops to BE')
    await expect(manager.ingestMessage(sourceMessage)).rejects.toThrow('simulated-process-crash')
    expect(gateway.log).toEqual(['reconcile', 'partial:2'])

    const recovered = await manager.recoverPending()
    expect(recovered[0]!.status).toBe('completed')
    expect(gateway.log).toEqual(['reconcile', 'partial:2', 'stop:5600'])

    const replay = await manager.ingestMessage(sourceMessage)
    expect(replay).toEqual(recovered[0]!)
    expect(gateway.log).toEqual(['reconcile', 'partial:2', 'stop:5600'])
  })

  test('defers an exact early follow-up and executes it after the entry becomes protected', async () => {
    const source = artifact()
    const protectedEntry = protectedRecord(source)
    const pendingEntry = structuredClone(protectedEntry)
    pendingEntry.state = 'created'
    delete pendingEntry.claim
    delete pendingEntry.command
    delete pendingEntry.receipt
    const gateway = new FakeGateway([pendingEntry])
    const manager = new FileDiscordTradeManager({
      directory: await mkdtemp(path.join(tmpdir(), 'discord-trade-manager-deferred-')),
      gateway,
      source: new SourceReader([source]),
      now: () => NOW,
    })
    const followUp = message('all out', { reply_to_message_id: source.source_message_id })

    expect(await manager.ingestMessage(followUp)).toMatchObject({ status: 'deferred' })
    expect(gateway.log).toEqual([])

    Object.assign(pendingEntry, protectedEntry)
    const recovered = await manager.recoverPending()
    expect(recovered[0]).toMatchObject({ status: 'completed' })
    expect(gateway.log).toEqual(['reconcile', 'flatten'])
  })

  test('executes the same explicit reduction from two distinct Discord messages', async () => {
    const { gateway, manager } = await setup([artifact()], [3])

    const first = await manager.ingestMessage(message('taking off 1 contract', {
      message_id: 'distinct-partial-1',
    }))
    const second = await manager.ingestMessage(message('taking off 1 contract', {
      message_id: 'distinct-partial-2',
    }))

    expect(first.status).toBe('completed')
    expect(second.status).toBe('completed')
    expect(gateway.log).toEqual(['reconcile', 'partial:1', 'reconcile', 'partial:1'])
    expect(first.actions[0]!.management_command_id)
      .not.toBe(second.actions[0]!.management_command_id)
  })

  test('serializes concurrent follow-ups against freshly reconciled quantity', async () => {
    const { gateway, manager } = await setup([artifact()], [4])
    await Promise.all([
      manager.ingestMessage(message('taking off half', { message_id: 'concurrent-half-1' })),
      manager.ingestMessage(message('taking off half', { message_id: 'concurrent-half-2' })),
    ])
    expect(gateway.log).toEqual(['reconcile', 'partial:2', 'reconcile', 'partial:1'])
  })

  test('blocks a delayed older follow-up from superseding a newer accepted stop', async () => {
    const { gateway, manager } = await setup()
    expect(await manager.ingestMessage(message('move stop to 5601', {
      message_id: 'newer-stop',
      posted_at: '2026-07-30T15:10:00.000Z',
    }))).toMatchObject({ status: 'completed' })
    expect(await manager.ingestMessage(message('move stop to 5600', {
      message_id: 'older-stop',
      posted_at: '2026-07-30T15:09:59.000Z',
    }))).toMatchObject({
      status: 'blocked',
      error: 'An older Discord follow-up cannot supersede a newer accepted instruction for this trade.',
    })
    expect(gateway.log).toEqual(['reconcile', 'stop:5601'])
  })

  test('treats stopped out as reconciliation only', async () => {
    const { gateway, manager } = await setup()
    gateway.stoppedOut = true
    const receipt = await manager.ingestMessage(message('stopped out', {
      message_id: 'stopped-out',
    }))

    expect(receipt.status).toBe('completed')
    expect(gateway.log).toEqual(['reconcile'])
    expect(receipt.actions[0]!.concrete_payload).toBeUndefined()
    expect(receipt.actions[0]).toMatchObject({
      gateway_receipt_id: expect.any(String),
      evidence_refs: ['fake-evidence'],
    })
  })
})
