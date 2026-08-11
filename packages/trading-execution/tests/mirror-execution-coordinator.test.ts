import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
  EXECUTION_RECORD_SCHEMA_VERSION,
  RISK_DECISION_SCHEMA_VERSION,
  TRADING_CONNECTION_SCHEMA_VERSION,
  type DiscoTraderTicket,
  type ExecutionAuthorization,
  type ExecutionRecord,
  type OrderIntent,
  type TradingConnection,
} from '@trade-god/contracts'
import {
  FileMirrorExecutionStore,
  FileMirrorGroupStore,
  FileSourceExecutionBindingStore,
  MirrorExecutionCoordinator,
  mirrorExecutionIdFor,
  sha256,
  type MirrorExecutionGateway,
} from '../src/index.ts'

const NOW = '2026-08-11T15:05:00.000Z'
const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const connection = (id: string): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: id,
  display_name: id,
  firm: { slug: 'apex', name: 'Apex' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper', environment_class: 'rehearsal', transport_preference: 'api',
  account_ref: `account-${id}`, account_display: { label: `account-${id}` },
  credential_ref: `secret-${id}`, risk_policy_ref: 'risk-paper',
  authorization_basis_ref: 'operator-paper', approval_policy_ref: 'approval-paper',
  state: 'ready', enabled: true,
  capabilities: {
    read_accounts: true, read_orders: true, read_positions: true, read_executions: true,
    submit_market: true, submit_limit: true, submit_stop: true, submit_stop_limit: true,
    native_bracket: true, native_oco: true, modify_order: true, cancel_order: true,
    partial_close: true, flatten: true, streaming_events: true,
  },
  certifications: ['read-certified', 'paper-entry-certified', 'paper-lifecycle-certified'],
  created_at: NOW, updated_at: NOW,
})

const ticket = (suffix = 'stage-two'): DiscoTraderTicket => ({
  id: `ticket-mirror-${suffix}`, createdAt: NOW, mode: 'alert-only',
  action: {
    intent: 'entry', symbol: 'ES', side: 'long', entry: 5600, stop: 5598,
    targets: [5603], confidence: 0.95, evidence: ['entry:long', 'stop:absolute'],
  },
  symbol: 'ES', tradedSymbol: 'ESU6', side: 'long', contracts: 2,
  entry: 5600, stop: 5598, stopDistancePoints: 2, targets: [5603], riskUsd: 200,
  provenance: {
    messageId: `discord-message-${suffix}`, author: 'Trader', authorId: '333',
    channelUrl: 'https://discord.com/channels/1/2', rawText: 'ES long 5600 stop 5598',
    postedAt: NOW, observedAt: NOW, latencyMs: 0,
  },
  gateTrail: ['sizing:pass'],
  llmVeto: { decision: 'accept', reason: 'No objection.', model: 'fixture', ms: 1 },
})

class FakeMirrorGateway implements MirrorExecutionGateway {
  readonly records = new Map<string, ExecutionRecord>()
  executeCount = 0
  grantIds: string[] = []
  denyConnection?: string
  failExecuteConnection?: string
  failOwnership = false
  ownershipReservations = 0
  revalidationCount = 0
  reconcileCount = 0

  async registerIntent(intent: OrderIntent, traceId = 'trace'): Promise<ExecutionRecord> {
    const existing = this.records.get(intent.intent_id)
    if (existing) return existing
    const record: ExecutionRecord = {
      record_schema_version: EXECUTION_RECORD_SCHEMA_VERSION,
      trace_id: traceId, intent, state: 'created', management_actions: [],
      transitions: [{
        transition_id: `transition-${intent.intent_id}-created`, from: null, to: 'created',
        occurred_at: NOW, reason: 'Registered.',
      }],
      created_at: NOW, updated_at: NOW,
    }
    this.records.set(intent.intent_id, record)
    return record
  }

  async get(intentId: string): Promise<ExecutionRecord> { return this.records.get(intentId)! }

  async evaluateAndApprove(intentId: string, authorization: ExecutionAuthorization): Promise<ExecutionRecord> {
    const current = await this.get(intentId)
    const denied = current.intent.connection_id === this.denyConnection
    const record: ExecutionRecord = {
      ...current,
      state: denied ? 'risk-denied' : 'approved',
      risk_decision: {
        risk_decision_schema_version: RISK_DECISION_SCHEMA_VERSION,
        decision_id: `risk-${intentId}`,
        intent_id: intentId,
        account_snapshot_id: `snapshot-${current.intent.connection_id}`,
        risk_policy_version: '1.0.0', result: denied ? 'deny' : 'allow',
        reasons: [denied ? 'Denied by fake account truth.' : 'Allowed by fake account truth.'],
        evaluated_at: NOW, valid_until: '2026-08-11T15:05:05.000Z',
      },
      ...(denied ? {} : { authorization }),
      transitions: [...current.transitions, {
        transition_id: `transition-${intentId}-risk`, from: 'created',
        to: denied ? 'risk-denied' : 'approved', occurred_at: NOW,
        reason: denied ? 'Denied.' : 'Approved.',
      }],
      updated_at: NOW,
    }
    this.records.set(intentId, record)
    return record
  }

  async execute(intentId: string, grantId?: string): Promise<ExecutionRecord> {
    this.executeCount += 1
    this.grantIds.push(grantId ?? '')
    const current = await this.get(intentId)
    if (current.intent.connection_id === this.failExecuteConnection) {
      throw new Error('Forced dispatch failure.')
    }
    const record: ExecutionRecord = {
      ...current, state: 'protected',
      transitions: [...current.transitions, {
        transition_id: `transition-${intentId}-protected`, from: current.state,
        to: 'protected', occurred_at: NOW, reason: 'Fake protected fill.',
      }], updated_at: NOW,
    }
    this.records.set(intentId, record)
    return record
  }

  async reconcile(intentId: string): Promise<ExecutionRecord> {
    this.reconcileCount += 1
    return this.get(intentId)
  }

  async reserveMirrorOwnership(_intentIds: string[]): Promise<void> {
    if (this.failOwnership) throw new Error('Forced ownership conflict.')
    this.ownershipReservations += 1
  }

  async releaseMirrorOwnership(_intentIds: string[]): Promise<void> {
    if (this.ownershipReservations > 0) this.ownershipReservations -= 1
  }

  async revalidateMirrorAdmission(_intentIds: string[]): Promise<void> {
    this.revalidationCount += 1
  }
}

const setup = async (options: { maxRisk?: string; maxParents?: number } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), 'mirror-stage-two-')); roots.push(root)
  const connections = new Map([
    ['connection-a', connection('connection-a')],
    ['connection-b', connection('connection-b')],
  ])
  const resolveConnection = async (id: string) => connections.get(id)!
  const group = await new FileMirrorGroupStore(root, resolveConnection, () => NOW).save({
    mirror_group_id: 'mirror-stage-two', display_name: 'Stage two', environment: 'paper', state: 'active',
    dispatch_max_concurrency: 2,
    max_aggregate_initial_risk: options.maxRisk ?? '500',
    max_active_parent_trades: options.maxParents ?? 1,
    members: [...connections.keys()].map((connection_id) => ({
      connection_id, enabled: true,
      quantity_rule: { mode: 'fixed-contracts' as const, contracts: 1, max_contracts: 1 },
    })),
  })
  const sourceStore = new FileSourceExecutionBindingStore(root, () => NOW)
  const binding = await sourceStore.bind({
    source_type: 'discord', server_id: '1', channel_id: '2', author_id: '333',
    message_id: ticket().provenance.messageId, ticket_id: ticket().id,
    ticket_checksum: sha256(ticket()), route_id: 'route-stage-two', received_at: NOW,
    instrument: {
      canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2026-09',
      tick_size: '0.25', point_value_usd: '50',
    },
    target: {
      type: 'mirror-group', mirror_group_id: group.mirror_group_id,
      mirror_group_revision: group.revision, group_snapshot_checksum: group.content_checksum,
      mirror_execution_id: mirrorExecutionIdFor(ticket(), group),
    },
  })
  const gateway = new FakeMirrorGateway()
  const authorization = (connectionId: string): ExecutionAuthorization => ({
    authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
    authorization_id: `mandate-${connectionId}`, connection_id: connectionId,
    mode: 'standing-mandate', scope: {
      symbols: ['ESU6'], max_contracts: 1, allowed_sides: ['buy'], allowed_order_types: ['limit'],
      session_start: '2026-08-11T15:00:00.000Z', session_end: '2026-08-11T16:00:00.000Z',
      max_daily_loss: '1000', max_open_risk: '500',
    }, issued_by: 'operator', issued_at: NOW, expires_at: '2026-08-11T16:00:00.000Z',
  })
  const authorizations = new Map([...connections.keys()].map((id) => [id, authorization(id)]))
  const store = new FileMirrorExecutionStore(root, () => NOW)
  const coordinator = new MirrorExecutionCoordinator({
    store, gateway, resolveConnection,
    resolveAuthorization: async (id) => authorizations.get(id) ?? null,
    now: () => NOW,
    riskPolicy: {
      policy_version: 'mirror-risk@1', fees_policy_version: 'fees@1', fee_per_contract_usd: '5',
    },
  })
  return { root, group, binding, gateway, store, coordinator, authorizations }
}

describe('Mirror Stage 2 coordinator', () => {
  test('admits every child, reserves aggregate risk, persists grants, then dispatches', async () => {
    const fixture = await setup()
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('active')
    expect(parent.children.map((child) => child.state)).toEqual(['protected', 'protected'])
    expect(fixture.gateway.executeCount).toBe(2)
    expect(fixture.gateway.grantIds.every((id) => id.startsWith('mirror-grant-'))).toBe(true)
    expect(fixture.gateway.ownershipReservations).toBe(1)
  })

  test('blocks the parent with zero order calls when one child fails admission', async () => {
    const fixture = await setup()
    fixture.gateway.denyConnection = 'connection-b'
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('blocked')
    expect(fixture.gateway.executeCount).toBe(0)
    expect(parent.children.every((child) => child.state === 'blocked')).toBe(true)
  })

  test('keeps fake-provider dispatch off when only admission evidence is requested', async () => {
    const fixture = await setup()
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })
    expect(parent.state).toBe('admitted')
    expect(parent.reservation_id).toBeDefined()
    expect(fixture.gateway.executeCount).toBe(0)
  })

  test('blocks before dispatch when aggregate fee-inclusive risk exceeds the group limit', async () => {
    const fixture = await setup({ maxRisk: '200' })
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('blocked')
    expect(fixture.gateway.executeCount).toBe(0)
  })

  test('releases aggregate risk and submits nothing when complete ownership cannot be reserved', async () => {
    const fixture = await setup()
    fixture.gateway.failOwnership = true
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('blocked')
    expect(fixture.gateway.executeCount).toBe(0)
    expect(fixture.gateway.ownershipReservations).toBe(0)
  })

  test('resumes a fully admitted parent after coordinator restart without re-admission', async () => {
    const fixture = await setup()
    expect((await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })).state).toBe('admitted')
    const restarted = new MirrorExecutionCoordinator({
      store: new FileMirrorExecutionStore(fixture.root, () => NOW),
      gateway: fixture.gateway,
      resolveConnection: async (id) => connection(id),
      resolveAuthorization: async (id) => fixture.authorizations.get(id) ?? null,
      now: () => NOW,
      riskPolicy: {
        policy_version: 'mirror-risk@1', fees_policy_version: 'fees@1', fee_per_contract_usd: '5',
      },
    })
    const parent = await restarted.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('active')
    expect(fixture.gateway.executeCount).toBe(2)
  })

  test('blocks an admitted parent when a child mandate is replaced before dispatch', async () => {
    const fixture = await setup()
    expect((await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })).state).toBe('admitted')
    const current = fixture.authorizations.get('connection-b')!
    fixture.authorizations.set('connection-b', {
      ...current,
      scope: { ...current.scope, max_open_risk: '499' },
    })
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('blocked')
    expect(fixture.gateway.executeCount).toBe(0)
    expect(fixture.gateway.ownershipReservations).toBe(0)
  })

  test('invalidates every persisted grant when the aggregate reservation is released', async () => {
    const fixture = await setup()
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })
    const projections = await fixture.store.getProjectionsForParent(parent)
    const grants = await fixture.store.issueGrants({
      parent,
      expires_at: projections[0]!.valid_until,
    })
    await fixture.store.cancelReservation(parent.mirror_execution_id)

    await expect(fixture.store.getGrant(grants[0]!.grant_id)).rejects.toMatchObject({
      code: 'RECORD_INTEGRITY_FAILURE',
    })
  })

  test('recovers a dispatching parent without resubmitting an already protected child', async () => {
    const fixture = await setup()
    let parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })
    const projections = await fixture.store.getProjectionsForParent(parent)
    const grants = await fixture.store.issueGrants({
      parent,
      expires_at: projections[0]!.valid_until,
    })
    await fixture.gateway.execute(grants[0]!.intent_id, grants[0]!.grant_id)
    parent = await fixture.store.updateParent(parent.mirror_execution_id, (current) => {
      const { content_checksum: _checksum, ...unsigned } = current
      return {
        ...unsigned,
        state: 'dispatching',
        order_mutation_io_started_at: NOW,
        children: current.children.map((child) => ({ ...child, state: 'dispatching' as const })),
        transitions: [...current.transitions, {
          from: current.state, to: 'dispatching', reason: 'Injected crash boundary.', at: NOW,
        }],
        updated_at: NOW,
      }
    })
    const restarted = new MirrorExecutionCoordinator({
      store: new FileMirrorExecutionStore(fixture.root, () => NOW),
      gateway: fixture.gateway,
      resolveConnection: async (id) => connection(id),
      resolveAuthorization: async (id) => fixture.authorizations.get(id) ?? null,
      now: () => NOW,
      riskPolicy: {
        policy_version: 'mirror-risk@1', fees_policy_version: 'fees@1', fee_per_contract_usd: '5',
      },
    })
    const recovered = await restarted.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(recovered.state).toBe('active')
    expect(fixture.gateway.executeCount).toBe(2)
  })

  test('does not resume remaining dispatch after a mandate is revoked during downtime', async () => {
    const fixture = await setup()
    let parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })
    const projections = await fixture.store.getProjectionsForParent(parent)
    await fixture.store.issueGrants({ parent, expires_at: projections[0]!.valid_until })
    parent = await fixture.store.updateParent(parent.mirror_execution_id, (current) => {
      const { content_checksum: _checksum, ...unsigned } = current
      return {
        ...unsigned, state: 'dispatching', order_mutation_io_started_at: NOW,
        children: current.children.map((child) => ({ ...child, state: 'dispatching' as const })),
        transitions: [...current.transitions, {
          from: current.state, to: 'dispatching', reason: 'Injected restart boundary.', at: NOW,
        }], updated_at: NOW,
      }
    })
    fixture.authorizations.delete('connection-b')
    const recovered = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(recovered.state).toBe('halted')
    expect(recovered.children.every((child) => child.state === 'blocked')).toBe(true)
    expect(fixture.gateway.executeCount).toBe(0)
  })

  test('persists a partial parent instead of falsely claiming success when one dispatch fails', async () => {
    const fixture = await setup()
    fixture.gateway.failExecuteConnection = 'connection-b'
    const parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(parent.state).toBe('partial')
    expect(parent.children.map((child) => child.state)).toEqual(['protected', 'unknown'])
    expect(fixture.gateway.executeCount).toBe(2)
  })

  test('preserves a known terminal child during crash recovery without invalid reconciliation', async () => {
    const fixture = await setup()
    let parent = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: false,
    })
    const projections = await fixture.store.getProjectionsForParent(parent)
    const grants = await fixture.store.issueGrants({ parent, expires_at: projections[0]!.valid_until })
    await fixture.gateway.execute(grants[0]!.intent_id, grants[0]!.grant_id)
    const rejected = await fixture.gateway.get(grants[1]!.intent_id)
    fixture.gateway.records.set(grants[1]!.intent_id, { ...rejected, state: 'rejected' })
    parent = await fixture.store.updateParent(parent.mirror_execution_id, (current) => {
      const { content_checksum: _checksum, ...unsigned } = current
      return {
        ...unsigned, state: 'dispatching', order_mutation_io_started_at: NOW,
        children: current.children.map((child) => ({ ...child, state: 'dispatching' as const })),
        transitions: [...current.transitions, {
          from: current.state, to: 'dispatching', reason: 'Injected terminal crash boundary.', at: NOW,
        }], updated_at: NOW,
      }
    })
    const recovered = await fixture.coordinator.coordinate({
      ticket: ticket(), binding: fixture.binding, group: fixture.group,
      instrument: fixture.binding.instrument, dispatch: true,
    })
    expect(recovered.state).toBe('partial')
    expect(recovered.children.map((child) => child.state)).toEqual(['protected', 'terminal'])
    expect(fixture.gateway.reconcileCount).toBe(0)
  })

  test('atomically admits only one concurrent parent into the final group risk slot', async () => {
    const fixture = await setup({ maxParents: 1 })
    const secondTicket = ticket('stage-two-second')
    const sourceStore = new FileSourceExecutionBindingStore(fixture.root, () => NOW)
    const secondBinding = await sourceStore.bind({
      source_type: 'discord', server_id: '1', channel_id: '2', author_id: '333',
      message_id: secondTicket.provenance.messageId, ticket_id: secondTicket.id,
      ticket_checksum: sha256(secondTicket), route_id: 'route-stage-two', received_at: NOW,
      instrument: fixture.binding.instrument,
      target: {
        type: 'mirror-group', mirror_group_id: fixture.group.mirror_group_id,
        mirror_group_revision: fixture.group.revision,
        group_snapshot_checksum: fixture.group.content_checksum,
        mirror_execution_id: mirrorExecutionIdFor(secondTicket, fixture.group),
      },
    })
    const secondCoordinator = new MirrorExecutionCoordinator({
      store: new FileMirrorExecutionStore(fixture.root, () => NOW),
      gateway: fixture.gateway,
      resolveConnection: async (id) => connection(id),
      resolveAuthorization: async (id) => ({
        authorization_schema_version: EXECUTION_AUTHORIZATION_SCHEMA_VERSION,
        authorization_id: `mandate-${id}`, connection_id: id, mode: 'standing-mandate',
        scope: {
          symbols: ['ESU6'], max_contracts: 1, allowed_sides: ['buy'], allowed_order_types: ['limit'],
          session_start: '2026-08-11T15:00:00.000Z', session_end: '2026-08-11T16:00:00.000Z',
          max_daily_loss: '1000', max_open_risk: '500',
        }, issued_by: 'operator', issued_at: NOW, expires_at: '2026-08-11T16:00:00.000Z',
      }),
      now: () => NOW,
      riskPolicy: {
        policy_version: 'mirror-risk@1', fees_policy_version: 'fees@1', fee_per_contract_usd: '5',
      },
    })
    const parents = await Promise.all([
      fixture.coordinator.coordinate({
        ticket: ticket(), binding: fixture.binding, group: fixture.group,
        instrument: fixture.binding.instrument, dispatch: false,
      }),
      secondCoordinator.coordinate({
        ticket: secondTicket, binding: secondBinding, group: fixture.group,
        instrument: secondBinding.instrument, dispatch: false,
      }),
    ])
    expect(parents.filter((parent) => parent.state === 'admitted')).toHaveLength(1)
    expect(parents.filter((parent) => parent.state === 'blocked')).toHaveLength(1)
    expect(fixture.gateway.executeCount).toBe(0)
  })
})
