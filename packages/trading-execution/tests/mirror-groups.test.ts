import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  TRADING_CONNECTION_SCHEMA_VERSION,
  type DiscoTraderTicket,
  type TradingConnection,
} from '@trade-god/contracts'

import {
  ExecutionGatewayError,
  FileMirrorGroupStore,
  FileMirrorPreviewCoordinator,
  FileSourceExecutionBindingStore,
  sha256,
  type SaveMirrorGroupInput,
} from '../src/index.ts'

const roots: string[] = []
const NOW = '2026-08-11T15:05:00.000Z'
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

const connection = (id: string, accountRef: string, overrides: Partial<TradingConnection> = {}): TradingConnection => ({
  connection_schema_version: TRADING_CONNECTION_SCHEMA_VERSION,
  connection_id: id,
  display_name: id,
  firm: { slug: 'apex', name: 'Apex' },
  platform: { slug: 'tradovate', name: 'Tradovate' },
  environment: 'paper',
  environment_class: 'rehearsal',
  transport_preference: 'api',
  account_ref: accountRef,
  account_display: { label: accountRef },
  credential_ref: `secret-${id}`,
  risk_policy_ref: 'risk-paper',
  authorization_basis_ref: 'operator-paper',
  approval_policy_ref: 'approval-paper',
  state: 'ready',
  capabilities: {
    read_accounts: true, read_orders: true, read_positions: true, read_executions: true,
    submit_market: true, submit_limit: true, submit_stop: true, submit_stop_limit: true,
    native_bracket: true, native_oco: true, modify_order: true, cancel_order: true,
    partial_close: true, flatten: true, streaming_events: true,
  },
  certifications: ['read-certified', 'paper-entry-certified', 'paper-lifecycle-certified'],
  enabled: true,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
})

const groupInput = (overrides: Partial<SaveMirrorGroupInput> = {}): SaveMirrorGroupInput => ({
  mirror_group_id: 'mirror-group-alpha',
  display_name: 'Alpha paper mirror',
  environment: 'paper',
  state: 'active',
  dispatch_max_concurrency: 2,
  max_aggregate_initial_risk: '500',
  max_active_parent_trades: 1,
  members: [
    { connection_id: 'connection-a', enabled: true, quantity_rule: { mode: 'source-quantity', max_contracts: 4 } },
    { connection_id: 'connection-b', enabled: true, quantity_rule: { mode: 'fixed-contracts', contracts: 1, max_contracts: 2 } },
  ],
  ...overrides,
})

const ticket = (overrides: Partial<DiscoTraderTicket> = {}): DiscoTraderTicket => ({
  id: 'ticket-mirror-1',
  createdAt: NOW,
  mode: 'alert-only',
  action: {
    intent: 'entry', symbol: 'ES', side: 'long', entry: 5600, stop: 5598,
    targets: [5603], confidence: 0.95, evidence: ['entry:long', 'stop:absolute'],
  },
  symbol: 'ES', tradedSymbol: 'ESU6', side: 'long', contracts: 3,
  entry: 5600, stop: 5598, stopDistancePoints: 2, targets: [5603], riskUsd: 300,
  provenance: {
    messageId: 'discord-message-mirror-1', author: 'Trader', authorId: 'discord-user-456',
    channelUrl: 'https://discord.com/channels/1/2', rawText: 'ES long 5600 stop 5598 target 5603',
    postedAt: '2026-08-11T15:04:59.000Z', observedAt: NOW, latencyMs: 1_000,
  },
  gateTrail: ['killSwitch:pass', 'sizing:pass'],
  llmVeto: { decision: 'accept', reason: 'Deterministic evidence agrees.', model: 'fixture-veto', ms: 10 },
  ...overrides,
})

describe('Mirror Group stage 0 and preview', () => {
  test('writes immutable revisions and rejects stale edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mirror-groups-')); roots.push(root)
    const connections = new Map([
      ['connection-a', connection('connection-a', 'account-a')],
      ['connection-b', connection('connection-b', 'account-b')],
    ])
    const store = new FileMirrorGroupStore(root, async (id) => connections.get(id)!, () => NOW)
    const first = await store.save(groupInput())
    expect(first).toMatchObject({ revision: 1, state: 'active', members: [{}, {}] })
    expect(first.content_checksum).toHaveLength(64)
    const second = await store.save(groupInput({ expected_revision: 1, state: 'paused' }))
    expect(second).toMatchObject({ revision: 2, state: 'paused', created_at: NOW })
    await expect(store.save(groupInput({ expected_revision: 1 }))).rejects.toThrow('changed from revision 1 to 2')
    expect(await store.get(first.mirror_group_id)).toEqual(second)
  })

  test('rejects duplicate provider accounts, unready activation, and more than five members', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mirror-groups-')); roots.push(root)
    const connections = new Map([
      ['connection-a', connection('connection-a', 'same-account')],
      ['connection-b', connection('connection-b', 'same-account')],
      ['connection-c', connection('connection-c', 'account-c', { state: 'degraded' })],
    ])
    const store = new FileMirrorGroupStore(root, async (id) => connections.get(id)!, () => NOW)
    await expect(store.save(groupInput())).rejects.toThrow('same underlying provider account')
    connections.set('connection-b', connection('connection-b', 'account-b'))
    await expect(store.save(groupInput({
      members: [groupInput().members[0]!, { ...groupInput().members[1]!, connection_id: 'connection-c' }],
    }))).rejects.toThrow('not enabled, ready')
    await expect(store.save(groupInput({
      state: 'draft',
      members: Array.from({ length: 6 }, (_, index) => ({
        connection_id: `connection-${index}`,
        enabled: true,
        quantity_rule: { mode: 'source-quantity' as const, max_contracts: 1 },
      })),
    }))).rejects.toThrow('capped at five')
  })

  test('persists a deterministic exact fan-out preview with zero execution authority', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mirror-preview-')); roots.push(root)
    const connections = new Map([
      ['connection-a', connection('connection-a', 'account-a')],
      ['connection-b', connection('connection-b', 'account-b')],
    ])
    const resolve = async (id: string) => connections.get(id)!
    const group = await new FileMirrorGroupStore(root, resolve, () => NOW).save(groupInput())
    const coordinator = new FileMirrorPreviewCoordinator(root, resolve)
    const input = {
      ticket: ticket(), route_id: 'route-mirror-alpha', group,
      received_at: NOW,
      instrument: {
        canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2026-09',
        tick_size: '0.25', point_value_usd: '50',
      },
    }
    const first = await coordinator.preview(input)
    const replay = await coordinator.preview(input)
    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      state: 'ready', order_mutation_allowed: false,
      aggregate_estimated_price_distance_risk_usd: '400',
      execution_blockers: [
        'MIRROR_CHILD_RISK_PROJECTION_UNIMPLEMENTED',
        'MIRROR_DISPATCH_GRANTS_UNIMPLEMENTED',
      ],
      children: [
        { connection_id: 'connection-a', planned_quantity: 3, estimated_price_distance_risk_usd: '300' },
        { connection_id: 'connection-b', planned_quantity: 1, estimated_price_distance_risk_usd: '100' },
      ],
    })
    expect(new Set(first.children.map((child) => child.child_intent_id)).size).toBe(2)
  })

  test('blocks the complete preview when one child is unready or aggregate risk is exceeded', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mirror-preview-')); roots.push(root)
    const connections = new Map([
      ['connection-a', connection('connection-a', 'account-a')],
      ['connection-b', connection('connection-b', 'account-b')],
    ])
    const resolve = async (id: string) => connections.get(id)!
    const group = await new FileMirrorGroupStore(root, resolve, () => NOW).save(groupInput({
      max_aggregate_initial_risk: '350',
    }))
    connections.set('connection-b', connection('connection-b', 'account-b', { state: 'degraded' }))
    const preview = await new FileMirrorPreviewCoordinator(root, resolve).preview({
      ticket: ticket(), route_id: 'route-mirror-alpha', group,
      received_at: NOW,
      instrument: {
        canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2026-09',
        tick_size: '0.25', point_value_usd: '50',
      },
    })
    expect(preview.state).toBe('blocked')
    expect(preview.blocking_reasons).toContain('MIRROR_MEMBER_UNREADY')
    expect(preview.blocking_reasons).toContain('MIRROR_AGGREGATE_RISK_DENIED')
    expect(preview.order_mutation_allowed).toBe(false)
  })

  test('uses trusted receipt time so a stale ticket cannot become a ready preview', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mirror-preview-')); roots.push(root)
    const connections = new Map([
      ['connection-a', connection('connection-a', 'account-a')],
      ['connection-b', connection('connection-b', 'account-b')],
    ])
    const resolve = async (id: string) => connections.get(id)!
    const group = await new FileMirrorGroupStore(root, resolve, () => NOW).save(groupInput())
    const preview = await new FileMirrorPreviewCoordinator(root, resolve).preview({
      ticket: ticket(), route_id: 'route-mirror-alpha', group,
      received_at: '2026-08-11T15:20:00.000Z',
      instrument: {
        canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2026-09',
        tick_size: '0.25', point_value_usd: '50',
      },
    })
    expect(preview.state).toBe('blocked')
    expect(preview.blocking_reasons).toContain('MIRROR_SOURCE_INELIGIBLE')
  })

  test('detects durable revision corruption', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mirror-groups-')); roots.push(root)
    const connections = new Map([
      ['connection-a', connection('connection-a', 'account-a')],
      ['connection-b', connection('connection-b', 'account-b')],
    ])
    const store = new FileMirrorGroupStore(root, async (id) => connections.get(id)!, () => NOW)
    const group = await store.save(groupInput())
    const revisionRoot = path.join(root, 'mirror-groups', 'groups', 'revisions')
    const revisionDirectory = (await readdir(revisionRoot))[0]!
    const file = path.join(revisionRoot, revisionDirectory, 'revision-1.json')
    const current = JSON.parse(await readFile(file, 'utf8'))
    current.display_name = 'tampered'
    await writeFile(file, JSON.stringify(current))
    await expect(store.get(group.mirror_group_id)).rejects.toBeInstanceOf(ExecutionGatewayError)
  })

  test('freezes one source event and ticket to one target before materialization', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'source-binding-')); roots.push(root)
    const store = new FileSourceExecutionBindingStore(root, () => NOW)
    const source = {
      server_id: '1', channel_id: '2', author_id: 'discord-user-456', message_id: 'message-one',
    }
    const input = {
      source_type: 'discord' as const,
      ...source,
      ticket_id: 'ticket-one',
      ticket_checksum: sha256({ ticket: 'one' }),
      route_id: 'route-one',
      received_at: NOW,
      instrument: {
        canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2026-09',
        tick_size: '0.25', point_value_usd: '50',
      },
      target: {
        type: 'connection' as const,
        connection_id: 'connection-a',
        intent_id: 'intent-one',
      },
    }
    const first = await store.bind(input)
    expect(await store.bind(input)).toEqual(first)
    await rm(path.join(
      root,
      'mirror-groups',
      'source-bindings',
      `${sha256('1:2:discord-user-456:message-one')}.json`,
    ))
    expect(await store.getByTicket(input.ticket_id)).toEqual(first)
    expect((await store.markMaterialized(first.binding_id, source)).state).toBe('materialized')
    expect((await store.getByTicket(input.ticket_id))?.state).toBe('materialized')
    expect((await store.getBySource(source))?.target).toEqual(input.target)
    expect(await store.hasMirrorBindingForContext({
      server_id: source.server_id,
      channel_ids: [source.channel_id],
      author_id: source.author_id,
    })).toBe(false)
    await expect(store.bind({
      ...input,
      target: { ...input.target, connection_id: 'connection-b' },
    })).rejects.toThrow('already bound to another source execution')
    await expect(store.bind({
      ...input,
      message_id: 'message-two',
    })).rejects.toThrow('already bound to another source execution')
  })

  test('finds frozen Mirror Group context without reading ticket claim files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'source-binding-')); roots.push(root)
    const store = new FileSourceExecutionBindingStore(root, () => NOW)
    await store.bind({
      source_type: 'discord', server_id: '1', channel_id: '2', author_id: '3', message_id: '4',
      ticket_id: 'ticket-mirror-context', ticket_checksum: sha256({ ticket: 'mirror' }),
      route_id: 'route-mirror',
      received_at: NOW,
      instrument: {
        canonical_id: 'CME:ESU6', symbol: 'ESU6', exchange: 'XCME', expiry: '2026-09',
        tick_size: '0.25', point_value_usd: '50',
      },
      target: {
        type: 'mirror-group', mirror_group_id: 'group-one', mirror_group_revision: 1,
        group_snapshot_checksum: sha256({ group: 'one' }), mirror_execution_id: 'mirror-one',
      },
    })
    expect(await store.hasMirrorBindingForContext({
      server_id: '1', channel_ids: ['2'], author_id: '3',
    })).toBe(true)
    expect(await store.hasMirrorBindingForContext({
      server_id: '1', channel_ids: ['9'], author_id: '3',
    })).toBe(false)
    expect(await store.hasMirrorBindingForContext({
      server_id: '1', channel_ids: ['different-thread'], author_id: '3', reply_to_message_id: '4',
    })).toBe(true)
  })
})
