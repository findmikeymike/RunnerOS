import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION,
  MIRROR_OWNERSHIP_RELEASE_JOURNAL_SCHEMA_VERSION,
  MIRROR_EXECUTION_SCHEMA_VERSION,
  MIRROR_GROUP_SCHEMA_VERSION,
  MIRROR_CHILD_RISK_PROJECTION_SCHEMA_VERSION,
  executionNoExposureProofSchema,
  type ExecutionNoExposureProof,
  type ExecutionRecord,
  type MirrorExecution,
  type MirrorGroup,
  type MirrorChildRiskProjection,
  type MirrorOwnershipReleaseJournal,
} from '@trade-god/contracts'
import {
  FileMirrorDiscordTradeManager,
  FileMirrorExecutionStore,
  buildDiscordManagementMessage,
  sha256,
} from '../src/index.ts'

const NOW = '2026-08-11T15:05:00.000Z'
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const record = (intentId: string, connectionId: string, quantity: number): ExecutionRecord => ({
  trace_id: `trace-${intentId}`,
  state: 'protected',
  intent: {
    intent_id: intentId,
    connection_id: connectionId,
    instrument: { symbol: 'ESU6' },
  },
  command: { command_id: `command-${intentId}` },
  management_actions: [],
  receipt: {
    receipt_id: `receipt-${intentId}`,
    result: 'filled-protected',
    open_quantity: quantity,
    protection_verified: true,
    protection_orders: [{
      role: 'stop-loss', provider_order_id: `stop-${intentId}`,
      quantity, status: 'working', trigger_price: '5598',
    }],
    evidence_refs: [`evidence-${intentId}`],
  },
} as unknown as ExecutionRecord)

const parent = (): MirrorExecution => {
  const unsigned = {
    mirror_execution_schema_version: MIRROR_EXECUTION_SCHEMA_VERSION,
    mirror_execution_id: 'mirror-management-parent',
    trace_id: 'trace-mirror-management-parent',
    route_id: 'route-discord-trader',
    mirror_group_id: 'group-paper',
    mirror_group_revision: 1,
    group_snapshot_checksum: '1'.repeat(64),
    source: {
      ticket_id: 'ticket-entry', message_id: 'entry-message', author_id: '333',
      server_id: '111', channel_id: '222', ticket_checksum: '2'.repeat(64),
      instrument_canonical_id: 'CME:ESU6',
    },
    state: 'active' as const,
    children: [
      {
        member_id: 'member-a', connection_id: 'connection-a', intent_id: 'intent-a',
        planned_quantity: 1,
        quantity_rule_snapshot: { mode: 'source-quantity' as const, max_contracts: 10 },
        state: 'protected' as const,
      },
      {
        member_id: 'member-b', connection_id: 'connection-b', intent_id: 'intent-b',
        planned_quantity: 2,
        quantity_rule_snapshot: { mode: 'source-quantity' as const, max_contracts: 10 },
        state: 'protected' as const,
      },
    ],
    reservation_id: 'reservation-parent',
    order_mutation_io_started_at: NOW,
    transitions: [{ to: 'active', reason: 'Children protected.', at: NOW }],
    created_at: NOW, updated_at: NOW,
  }
  return { ...unsigned, content_checksum: sha256(unsigned) }
}

class FakeGateway {
  records = new Map<string, ExecutionRecord>([
    ['intent-a', record('intent-a', 'connection-a', 1)],
    ['intent-b', record('intent-b', 'connection-b', 2)],
  ])
  closeCalls: Array<{ intentId: string; quantity: number; requestId?: string }> = []
  flattenCalls: string[] = []
  released = 0
  refuseProofFor?: string
  failCloseFor = new Set<string>()

  async list(): Promise<ExecutionRecord[]> { return [...this.records.values()] }
  async get(intentId: string): Promise<ExecutionRecord> { return this.records.get(intentId)! }
  async reconcile(intentId: string): Promise<ExecutionRecord> { return this.get(intentId) }
  async prepareStopMove(): Promise<never> { throw new Error('not used') }
  async modifyOrder(): Promise<never> { throw new Error('not used') }

  async closePosition(intentId: string, quantity: number, requestId?: string): Promise<ExecutionRecord> {
    this.closeCalls.push({ intentId, quantity, ...(requestId ? { requestId } : {}) })
    if (this.failCloseFor.has(intentId)) throw new Error(`Safe fake rejection for ${intentId}.`)
    const current = await this.get(intentId)
    const openQuantity = current.receipt!.open_quantity! - quantity
    const next = {
      ...current,
      management_actions: [...current.management_actions, action(requestId!)],
      receipt: {
        ...current.receipt!, receipt_id: `receipt-close-${intentId}`,
        open_quantity: openQuantity,
        protection_orders: [{
          ...current.receipt!.protection_orders![0]!, quantity: openQuantity,
        }],
        evidence_refs: [`evidence-close-${intentId}`],
      },
    }
    this.records.set(intentId, next)
    return next
  }

  async flatten(intentId: string, _reason: string, requestId?: string): Promise<ExecutionRecord> {
    this.flattenCalls.push(intentId)
    const current = await this.get(intentId)
    const next = {
      ...current, state: 'closed' as const,
      management_actions: [...current.management_actions, action(requestId!)],
      receipt: {
        ...current.receipt!, receipt_id: `receipt-flat-${intentId}`,
        result: 'closed' as const, open_quantity: 0, protection_verified: false,
        protection_orders: [], evidence_refs: [`evidence-flat-${intentId}`],
      },
    }
    this.records.set(intentId, next)
    return next
  }

  async verifyNoExposure(intentId: string): Promise<ExecutionNoExposureProof> {
    if (this.refuseProofFor === intentId) throw new Error('Provider still reports exposure.')
    const current = await this.get(intentId)
    const unsigned = {
      proof_schema_version: EXECUTION_NO_EXPOSURE_PROOF_SCHEMA_VERSION,
      proof_id: `proof-${intentId}`, intent_id: intentId,
      connection_id: current.intent.connection_id,
      account_ref: `account-${current.intent.connection_id}`,
      account_snapshot_id: `snapshot-${intentId}`,
      account_snapshot_checksum: sha256({ intentId, flat: true }),
      execution_record_checksum: sha256(current),
      positions_count: 0 as const, working_orders_count: 0 as const,
      captured_at: NOW, evidence_refs: [`snapshot-${intentId}`],
    } satisfies Omit<ExecutionNoExposureProof, 'content_checksum'>
    return executionNoExposureProofSchema.parse({ ...unsigned, content_checksum: sha256(unsigned) })
  }

  async releaseMirrorOwnership(): Promise<void> { this.released += 1 }
  async proveAndReleaseMirrorOwnership(intentIds: string[]): Promise<MirrorOwnershipReleaseJournal> {
    const proofs = await Promise.all(intentIds.map((intentId) => this.verifyNoExposure(intentId)))
    this.released += 1
    const unsigned = {
      release_journal_schema_version: MIRROR_OWNERSHIP_RELEASE_JOURNAL_SCHEMA_VERSION,
      journal_id: 'mirror-release-test',
      mirror_execution_id: 'mirror-management-parent',
      intent_ids: intentIds,
      proofs,
      state: 'released' as const,
      created_at: NOW,
      updated_at: NOW,
    }
    return { ...unsigned, content_checksum: sha256(unsigned) }
  }
}

const action = (requestId: string) => ({
  command: { request_id: requestId, management_command_id: `command-${requestId}` },
}) as unknown as ExecutionRecord['management_actions'][number]

const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mirror-management-'))
  roots.push(root)
  const store = new FileMirrorExecutionStore(root, () => NOW)
  const activeParent = parent()
  const planningUnsigned = {
    ...activeParent,
    state: 'planning' as const,
    children: activeParent.children.map((child) => ({ ...child, state: 'planned' as const })),
    reservation_id: undefined,
    order_mutation_io_started_at: undefined,
    transitions: [{ to: 'planning', reason: 'Planning.', at: NOW }],
    content_checksum: undefined,
  }
  const { content_checksum: _planningChecksum, ...planningBody } = planningUnsigned
  const planning = await store.createParent({ ...planningBody, content_checksum: sha256(planningBody) })
  const groupBody = {
    mirror_group_schema_version: MIRROR_GROUP_SCHEMA_VERSION,
    mirror_group_id: 'group-paper', revision: 1, display_name: 'Paper group',
    environment: 'paper' as const, state: 'active' as const,
    admission_policy: 'all-members-before-order-mutation-io' as const,
    dispatch_policy: { mode: 'bounded-parallel' as const, max_concurrency: 2 },
    portfolio_limits: {
      currency: 'USD' as const, max_aggregate_initial_risk: '1000', max_active_parent_trades: 5,
    },
    members: planning.children.map((child) => ({
      member_id: child.member_id, connection_id: child.connection_id, enabled: true,
      quantity_rule: child.quantity_rule_snapshot,
    })),
    created_at: NOW, updated_at: NOW,
  }
  const group: MirrorGroup = { ...groupBody, content_checksum: sha256(groupBody) }
  const projections = planning.children.map((child, index): MirrorChildRiskProjection => {
    const body = {
      mirror_child_risk_projection_schema_version: MIRROR_CHILD_RISK_PROJECTION_SCHEMA_VERSION,
      projection_id: `projection-${child.intent_id}`,
      mirror_execution_id: planning.mirror_execution_id,
      intent_id: child.intent_id,
      connection_id: child.connection_id,
      provider_account_key: `paper:account-${child.connection_id}`,
      account_snapshot_id: `snapshot-${child.intent_id}`,
      risk_decision_id: `risk-${child.intent_id}`,
      mirror_child_source_checksum: `${index + 3}`.repeat(64),
      instrument_canonical_id: 'CME:ESU6', planned_quantity: child.planned_quantity,
      valuation: {
        currency: 'USD' as const, side: 'buy' as const, entry_order_type: 'market' as const,
        adverse_entry_bound: { kind: 'maximum-price' as const, price: '5600' },
        protection: { kind: 'absolute-price' as const, stop_price: '5598' },
        tick_value_usd: '12.5', instrument_value_version: 'cme-futures@1',
        slippage_policy_version: 'limit-price-bound@1', risk_policy_version: 'paper@1',
        fees_policy_version: 'fees@1', risk_model_authority: 'planning-stop-distance-with-fees' as const,
      },
      initial_risk_upper_bound_usd: '100', evaluated_at: NOW,
      valid_until: '2026-08-11T15:10:00.000Z',
    }
    return { ...body, content_checksum: sha256(body) }
  })
  const reservation = await store.reserve({ parent: planning, group, projections })
  await store.updateParent(planning.mirror_execution_id, () => {
    const { content_checksum: _activeChecksum, ...activeBody } = activeParent
    return {
      ...activeBody,
      group_snapshot_checksum: group.content_checksum,
      reservation_id: reservation.reservation_id,
    }
  })
  const gateway = new FakeGateway()
  const manager = new FileMirrorDiscordTradeManager({
    directory: path.join(root, 'receipts'), gateway, store, now: () => NOW,
  })
  return { root, store, gateway, manager }
}

const message = (id: string, rawText: string, postedAt = NOW) => buildDiscordManagementMessage({
  message_id: id, author_id: '333', channel_id: '222', guild_id: '111',
  reply_to_message_id: 'entry-message', raw_text: rawText,
  posted_at: postedAt, observed_at: NOW, is_edit: false,
})

describe('Mirror Discord trade manager', () => {
  test('blocks an uneven half instruction before any child mutation', async () => {
    const { gateway, manager } = await setup()

    const receipt = await manager.ingestMessage(message('management-half', 'taking half'))

    expect(receipt.status).toBe('blocked')
    expect(gateway.closeCalls).toHaveLength(0)
  })

  test('freezes child-specific quantities and duplicate-safe request IDs', async () => {
    const { gateway, manager } = await setup()
    gateway.records.set('intent-a', record('intent-a', 'connection-a', 4))

    const input = message('management-half-valid', 'taking half')
    const first = await manager.ingestMessage(input)
    const duplicate = await manager.ingestMessage(input)

    expect(first.status).toBe('completed')
    expect(duplicate.content_checksum).toBe(first.content_checksum)
    expect(gateway.closeCalls.map(({ quantity }) => quantity).sort()).toEqual([1, 2])
    expect(new Set(gateway.closeCalls.map(({ requestId }) => requestId)).size).toBe(2)
    expect(gateway.closeCalls).toHaveLength(2)
  })

  test('blocks half then breakeven until post-resize stop planning is certified', async () => {
    const { gateway, manager } = await setup()
    gateway.records.set('intent-a', record('intent-a', 'connection-a', 4))

    const receipt = await manager.ingestMessage(message(
      'management-half-be',
      'taking half and moving stop to BE',
    ))

    expect(receipt.status).toBe('blocked')
    expect(receipt.error).toContain('post-resize stop payload')
    expect(gateway.closeCalls).toHaveLength(0)
  })

  test('keeps the parent partial when one child safely rejects the same reduction', async () => {
    const { store, gateway, manager } = await setup()
    gateway.records.set('intent-a', record('intent-a', 'connection-a', 4))
    gateway.failCloseFor.add('intent-b')

    const receipt = await manager.ingestMessage(message('management-half-partial', 'taking half'))

    expect(receipt.status).toBe('partial')
    expect((await store.getParent('mirror-management-parent')).state).toBe('partial')
  })

  test('blocks an older flatten after a newer halted instruction', async () => {
    const { gateway, manager } = await setup()
    gateway.records.set('intent-a', record('intent-a', 'connection-a', 4))
    gateway.failCloseFor.add('intent-a')
    gateway.failCloseFor.add('intent-b')
    expect((await manager.ingestMessage(message('management-newer-halted', 'taking half'))).status).toBe('halted')

    const older = await manager.ingestMessage(message(
      'management-older-flat',
      'all out',
      '2026-08-11T15:04:00.000Z',
    ))

    expect(older.status).toBe('blocked')
    expect(older.error).toContain('older Discord follow-up')
    expect(gateway.flattenCalls).toHaveLength(0)
  })

  test('matches root symbols to exact contract-month Mirror parents', async () => {
    const { manager } = await setup()
    const probe = await manager.probe(buildDiscordManagementMessage({
      message_id: 'management-symbol-probe', author_id: '333', channel_id: '222', guild_id: '111',
      raw_text: 'ES all out', posted_at: NOW, observed_at: NOW, is_edit: false,
    }))

    expect(probe.candidates).toEqual(['mirror-management-parent'])
    expect(probe.resolved).toBe('mirror-management-parent')
  })

  test('enforces the frozen parent after a same-family candidate appears', async () => {
    const { store, gateway, manager } = await setup()
    const secondUnsigned = {
      ...parent(), mirror_execution_id: 'mirror-management-parent-late',
      trace_id: 'trace-mirror-management-parent-late',
      source: { ...parent().source, message_id: 'entry-message-late' },
      children: parent().children.map((child, index) => ({
        ...child,
        member_id: `${child.member_id}-late`,
        connection_id: `${child.connection_id}-late`,
        intent_id: `${child.intent_id}-late`,
        planned_quantity: index + 1,
      })),
      content_checksum: undefined,
    }
    const { content_checksum: _checksum, ...lateBody } = secondUnsigned
    await store.createParent({ ...lateBody, content_checksum: sha256(lateBody) })

    const input = buildDiscordManagementMessage({
      message_id: 'management-frozen-parent', author_id: '333', channel_id: '222', guild_id: '111',
      raw_text: 'ES all out', posted_at: NOW, observed_at: NOW, is_edit: false,
    })
    const receipt = await manager.ingestResolvedMessage(
      input,
      'mirror-management-parent',
      'channel-symbol',
    )

    expect(receipt.mirror_execution_id).toBe('mirror-management-parent')
    expect(gateway.flattenCalls.sort()).toEqual(['intent-a', 'intent-b'])
    expect((await store.getParent('mirror-management-parent-late')).state).toBe('active')
  })

  test('closes and releases only after every child has fresh no-exposure proof', async () => {
    const { store, gateway, manager } = await setup()

    const receipt = await manager.ingestMessage(message('management-flat', 'all out'))

    expect(receipt.status).toBe('completed')
    expect((await store.getParent('mirror-management-parent')).state).toBe('closed')
    expect((await store.getReservation('mirror-management-parent'))?.state).toBe('released')
    expect(gateway.released).toBe(1)
    const finalized = await manager.get('management-flat')
    await manager.recoverPending()
    await manager.recoverPending()
    expect((await manager.get('management-flat')).content_checksum).toBe(finalized.content_checksum)
    expect(gateway.released).toBe(1)
  })

  test('treats a missing aggregate reservation as durable-state corruption', async () => {
    const { root, manager } = await setup()
    await rm(path.join(
      root,
      'mirror-groups',
      'risk-reservations',
      `${sha256('mirror-management-parent')}.json`,
    ))

    await expect(manager.ingestMessage(message('management-flat-missing-risk', 'all out')))
      .rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
  })

  test('proves an entry-time denied child flat while flattening its protected sibling', async () => {
    const { store, gateway, manager } = await setup()
    const denied = record('intent-a', 'connection-a', 1)
    gateway.records.set('intent-a', {
      ...denied, state: 'risk-denied', command: undefined, receipt: undefined,
    })

    const receipt = await manager.ingestMessage(message('management-flat-mixed-entry', 'all out'))

    expect(receipt.status).toBe('completed')
    expect(gateway.flattenCalls).toEqual(['intent-b'])
    expect((await store.getParent('mirror-management-parent')).state).toBe('closed')
    expect(gateway.released).toBe(1)
  })

  test('does not refinalize older receipts after a later flatten released the parent', async () => {
    const { gateway, manager } = await setup()
    gateway.records.set('intent-a', record('intent-a', 'connection-a', 4))
    expect((await manager.ingestMessage(message('management-before-flat', 'taking half'))).status)
      .toBe('completed')
    expect((await manager.ingestMessage(message('management-final-flat', 'all out'))).status)
      .toBe('completed')
    expect(gateway.released).toBe(1)

    await manager.recoverPending()

    expect(gateway.released).toBe(1)
  })

  test('halts and retains ownership when any provider-flat proof is unavailable', async () => {
    const { store, gateway, manager } = await setup()
    gateway.refuseProofFor = 'intent-b'

    const receipt = await manager.ingestMessage(message('management-flat-unknown', 'all out'))

    expect(receipt.status).toBe('halted')
    expect((await store.getParent('mirror-management-parent')).state).toBe('halted')
    expect(gateway.released).toBe(0)
  })
})
