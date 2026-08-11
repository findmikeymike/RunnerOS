import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  DISCOTRADER_TICKET_SCHEMA_VERSION,
  LEGACY_DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION,
  LEGACY_ORDER_INTENT_SCHEMA_VERSION,
  type ExecutionRecord,
  type OrderIntent,
} from '@trade-god/contracts'

import {
  ExecutionGatewayError,
  FileDiscoTraderIntentSource,
  computeOrderIntentChecksum,
  convertDiscoTraderTicket,
} from '../src/index.ts'

const NOW = '2026-07-30T15:05:00.000Z'

const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-1',
  createdAt: NOW,
  mode: 'alert-only',
  action: {
    intent: 'entry',
    symbol: 'ES',
    side: 'long',
    entry: 5600,
    stop: 5598,
    targets: [5603],
    confidence: 0.95,
    evidence: ['entry:long', 'stop:absolute'],
  },
  symbol: 'ES',
  tradedSymbol: 'ESU6',
  side: 'long',
  contracts: 3,
  entry: 5600,
  stop: 5598,
  stopDistancePoints: 2,
  targets: [5603],
  riskUsd: 300,
  provenance: {
    messageId: 'discord-message-123',
    author: 'Trader',
    authorId: 'discord-user-456',
    channelUrl: 'https://discord.com/channels/1/2',
    rawText: 'ES long 5600 stop 5598 target 5603',
    postedAt: '2026-07-30T15:04:59.000Z',
    observedAt: NOW,
    latencyMs: 1_000,
  },
  gateTrail: ['killSwitch:pass', 'sizing:pass'],
  llmVeto: {
    decision: 'accept',
    reason: 'The deterministic interpretation matches the message.',
    model: 'fixture-veto',
    ms: 10,
  },
  ...overrides,
})

const route = {
  connection_id: 'connection-apex-paper',
  source_id: 'discord-route-jordan-v',
  instrument: {
    canonical_id: 'CME:ESU6',
    symbol: 'ESU6',
    exchange: 'XCME',
    expiry: '2026-09',
    tick_size: '0.25',
    point_value_usd: '50',
  },
  valid_for_ms: 60_000,
}

const record = (intent: OrderIntent): ExecutionRecord => ({
  record_schema_version: 'execution-record@1',
  trace_id: 'trace-discotrader-test',
  intent,
  state: 'created',
  management_actions: [],
  transitions: [{
    transition_id: 'transition-discotrader-test',
    from: null,
    to: 'created',
    occurred_at: NOW,
    reason: 'Order intent registered.',
  }],
  created_at: NOW,
  updated_at: NOW,
})

class Registrar {
  registerCount = 0
  records = new Map<string, ExecutionRecord>()

  async registerIntent(intent: OrderIntent) {
    this.registerCount += 1
    const value = record(intent)
    this.records.set(intent.intent_id, value)
    return value
  }

  async get(intentId: string) {
    const value = this.records.get(intentId)
    if (!value) throw new ExecutionGatewayError('INTENT_NOT_FOUND', 'missing')
    return value
  }
}

describe('DiscoTrader intent source', () => {
  test('preserves deterministic size and immutable author while converting to order-intent@2', () => {
    const artifact = convertDiscoTraderTicket(ticket({
      provenance: {
        ...ticket().provenance,
        postedAt: '2026-07-30T15:04:58.000Z',
        observedAt: '2026-07-30T15:04:58.250Z',
        latencyMs: 2_000,
      },
    }), route, NOW)

    expect(artifact).toMatchObject({
      source_ticket_id: 'ticket-1',
      source_message_id: 'discord-message-123',
      source_author_id: 'discord-user-456',
      deterministic_contracts: 3,
      deterministic_risk_usd: '300',
      intent: {
        connection_id: 'connection-apex-paper',
        source: {
          type: 'discord',
          source_id: 'discord-route-jordan-v',
          author_id: 'discord-user-456',
        },
        instrument: {
          canonical_id: 'CME:ESU6',
          symbol: 'ESU6',
        },
        side: 'buy',
        quantity: 3,
        max_loss_usd: '300',
        entry: { type: 'limit', price: '5600' },
        protection: {
          stop_loss: { type: 'price', value: '5598' },
          take_profit: { type: 'price', value: '5603' },
        },
      },
    })
    expect(artifact.intent.content_checksum).toHaveLength(64)
    expect(artifact.source_ticket.provenance.rawText)
      .toBe('ES long 5600 stop 5598 target 5603')
  })

  test('converts a points stop to exact ticks without accepting a size override', () => {
    const source = ticket({
      entry: undefined,
      stop: undefined,
      stopDistancePoints: 2.5,
      action: { ...ticket().action, entry: undefined, stop: undefined },
    })
    const artifact = convertDiscoTraderTicket(source, route, NOW)

    expect(artifact.intent.quantity).toBe(3)
    expect(artifact.intent.entry).toEqual({ type: 'market' })
    expect(artifact.intent.protection.stop_loss).toEqual({ type: 'ticks', value: '10' })
  })

  test('refuses duplicate execution authority, mutable identity, veto rejection, and symbol drift', () => {
    expect(() => convertDiscoTraderTicket(ticket({ mode: 'armed-live' }), route, NOW))
      .toThrow('execution authority must not be duplicated')
    expect(() => convertDiscoTraderTicket(ticket({
      provenance: { ...ticket().provenance, authorId: undefined },
    }), route, NOW)).toThrow('immutable Discord author ID')
    expect(() => convertDiscoTraderTicket(ticket({
      llmVeto: { decision: 'reject', reason: 'Mismatch', model: 'fixture-veto', ms: 10 },
    }), route, NOW)).toThrow('accepted veto')
    expect(() => convertDiscoTraderTicket(ticket({ tradedSymbol: 'NQU6' }), route, NOW))
      .toThrow('does not match')
    expect(() => convertDiscoTraderTicket(ticket({
      action: { ...ticket().action, side: 'short' },
    }), route, NOW)).toThrow('direction conflicts')
    expect(() => convertDiscoTraderTicket(ticket({
      provenance: { ...ticket().provenance, postedAt: undefined },
    }), route, NOW)).toThrow('posted timestamp')
    expect(() => convertDiscoTraderTicket(ticket({
      createdAt: '2026-07-30T15:03:02.000Z',
      provenance: {
        ...ticket().provenance,
        postedAt: '2026-07-30T15:03:00.000Z',
        observedAt: '2026-07-30T15:03:01.000Z',
        latencyMs: 1_000,
      },
    }), route, NOW)).toThrow('expired before reaching')
    expect(() => convertDiscoTraderTicket(ticket({
      createdAt: NOW,
      provenance: {
        ...ticket().provenance,
        postedAt: '2026-07-30T15:04:58.000Z',
        observedAt: '2026-07-30T15:04:58.250Z',
        latencyMs: 250,
      },
    }), route, NOW)).toThrow('timestamps disagree')
    expect(() => convertDiscoTraderTicket(ticket({
      createdAt: '2026-07-30T15:05:01.000Z',
      provenance: {
        ...ticket().provenance,
        postedAt: '2026-07-30T15:05:00.000Z',
        observedAt: '2026-07-30T15:05:00.250Z',
        latencyMs: 1_000,
      },
    }), route, NOW)).toThrow('timestamps disagree')
    expect(() => convertDiscoTraderTicket(ticket({
      targets: [5599], action: { ...ticket().action, targets: [5599] },
    }), route, NOW))
      .toThrow('target is on the wrong side')
    expect(() => convertDiscoTraderTicket(ticket({
      targets: [5603, 5605], action: { ...ticket().action, targets: [5603, 5605] },
    }), route, NOW))
      .toThrow('explicit immutable target-leg quantities')
  })

  test('freezes explicit multi-target quantities without inferring a split', () => {
    const artifact = convertDiscoTraderTicket(ticket({
      targets: [5603, 5605],
      ticketSchemaVersion: DISCOTRADER_TICKET_SCHEMA_VERSION,
      action: { ...ticket().action, targets: [5603, 5605] },
      targetLegs: [
        { legId: 'tp-one', quantity: 2, target: 5603 },
        { legId: 'tp-two', quantity: 1, target: 5605 },
      ],
    }), route, NOW)
    expect(artifact.intent.protection.exit_legs).toEqual([
      { leg_id: 'tp-one', quantity: 2, take_profit: { type: 'price', value: '5603' } },
      { leg_id: 'tp-two', quantity: 1, take_profit: { type: 'price', value: '5605' } },
    ])
    expect(() => convertDiscoTraderTicket(ticket({
      targets: [5603, 5605],
      ticketSchemaVersion: DISCOTRADER_TICKET_SCHEMA_VERSION,
      action: { ...ticket().action, targets: [5603, 5605] },
      targetLegs: [
        { legId: 'tp-one', quantity: 1, target: 5603 },
        { legId: 'tp-two', quantity: 1, target: 5605 },
      ],
    }), route, NOW)).toThrow('Target-leg quantities must exactly cover')
  })

  test('persists source evidence once and makes webhook replay idempotent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-intent-source-'))
    const registrar = new Registrar()
    const source = new FileDiscoTraderIntentSource(directory, registrar, () => NOW)
    const push = {
      kind: 'ticket',
      severity: 'action_required',
      summary: 'LONG 3xESU6',
      ticket: ticket(),
      at: NOW,
    }

    const first = await source.ingestPush(push, route)
    const replay = await source.ingestPush(push, route)

    expect(replay.artifact).toEqual(first.artifact)
    expect(replay.record.intent.intent_id).toBe(first.record.intent.intent_id)
    expect(registrar.registerCount).toBe(1)
    expect(await source.get(first.record.intent.intent_id)).toEqual(first.artifact)
  })

  test('binds one Discord source event and one ticket id to one durable intent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-intent-lineage-'))
    const registrar = new Registrar()
    const source = new FileDiscoTraderIntentSource(directory, registrar, () => NOW)
    const push = (sourceTicket: ReturnType<typeof ticket>) => ({
      kind: 'ticket' as const,
      severity: 'action_required' as const,
      summary: 'LONG 3xESU6',
      ticket: sourceTicket,
      at: NOW,
    })
    await source.ingestPush(push(ticket()), route)

    await expect(source.ingestPush(push(ticket({ id: 'ticket-reissued' })), route))
      .rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
    await expect(source.ingestPush(push(ticket({
      provenance: {
        ...ticket().provenance,
        messageId: 'discord-message-different',
      },
    })), route)).rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
    expect(registrar.registerCount).toBe(1)
  })

  test('recovers registration after source persistence but before gateway registration', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-intent-recovery-'))
    const registrar = new Registrar()
    const source = new FileDiscoTraderIntentSource(directory, registrar, () => NOW)
    const push = {
      kind: 'ticket',
      severity: 'action_required',
      summary: 'LONG 3xESU6',
      ticket: ticket(),
      at: NOW,
    }
    const artifact = convertDiscoTraderTicket(ticket(), route, NOW)
    await writeFile(
      path.join(directory, `${artifact.intent.intent_id}.source.json`),
      `${JSON.stringify(artifact, null, 2)}\n`,
      'utf8',
    )

    const recovered = await source.ingestPush(push, route)

    expect(recovered.record.intent.intent_id).toBe(artifact.intent.intent_id)
    expect(registrar.registerCount).toBe(1)
  })

  test('durably registers the halted gateway record before writing source sidecars', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-admission-order-'))
    const registrar = new Registrar()
    const originalRegister = registrar.registerIntent.bind(registrar)
    let sourceExistedAtRegistration = true
    registrar.registerIntent = async (intent) => {
      sourceExistedAtRegistration = existsSync(path.join(directory, `${intent.intent_id}.source.json`))
      return originalRegister(intent)
    }
    const source = new FileDiscoTraderIntentSource(directory, registrar, () => NOW)

    await source.ingestPush({
      kind: 'ticket', severity: 'action_required', summary: 'LONG 3xESU6', ticket: ticket(), at: NOW,
    }, route)

    expect(sourceExistedAtRegistration).toBe(false)
  })

  test('reads checksum-valid version 1 source artifacts only without exit legs', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-v1-read-'))
    const source = new FileDiscoTraderIntentSource(directory, new Registrar(), () => NOW)
    const current = convertDiscoTraderTicket(ticket(), route, NOW)
    const { content_checksum: _checksum, ...currentUnsigned } = current.intent
    const legacyUnsigned = {
      ...currentUnsigned,
      intent_schema_version: LEGACY_ORDER_INTENT_SCHEMA_VERSION,
    }
    const legacy = {
      ...current,
      source_schema_version: LEGACY_DISCOTRADER_INTENT_SOURCE_SCHEMA_VERSION,
      intent: {
        ...legacyUnsigned,
        content_checksum: computeOrderIntentChecksum(legacyUnsigned),
      },
    }
    await writeFile(
      path.join(directory, `${legacy.intent.intent_id}.source.json`),
      `${JSON.stringify(legacy, null, 2)}\n`,
      'utf8',
    )
    expect((await source.get(legacy.intent.intent_id)).intent.intent_schema_version)
      .toBe(LEGACY_ORDER_INTENT_SCHEMA_VERSION)
  })

  test('detects tampered source evidence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-intent-tamper-'))
    const registrar = new Registrar()
    const source = new FileDiscoTraderIntentSource(directory, registrar, () => NOW)
    const result = await source.ingestPush({
      kind: 'ticket',
      severity: 'action_required',
      summary: 'LONG 3xESU6',
      ticket: ticket(),
      at: NOW,
    }, route)
    await writeFile(
      path.join(directory, `${result.artifact.intent.intent_id}.source.json`),
      `${JSON.stringify({
        ...result.artifact,
        deterministic_contracts: 99,
      }, null, 2)}\n`,
      'utf8',
    )

    await expect(source.get(result.artifact.intent.intent_id))
      .rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
  })

  test('rejects a rechecksummed intent whose exit legs drift from the signed ticket', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'discotrader-leg-tamper-'))
    const source = new FileDiscoTraderIntentSource(directory, new Registrar(), () => NOW)
    const sourceTicket = ticket({
      ticketSchemaVersion: DISCOTRADER_TICKET_SCHEMA_VERSION,
      targets: [5603, 5605],
      action: { ...ticket().action, targets: [5603, 5605] },
      targetLegs: [
        { legId: 'tp-one', quantity: 2, target: 5603 },
        { legId: 'tp-two', quantity: 1, target: 5605 },
      ],
    })
    const artifact = convertDiscoTraderTicket(sourceTicket, route, NOW)
    const { content_checksum: _checksum, ...unsigned } = artifact.intent
    const driftedUnsigned = {
      ...unsigned,
      protection: {
        ...unsigned.protection,
        exit_legs: unsigned.protection.exit_legs!.map((leg, index) => ({
          ...leg,
          quantity: index === 0 ? 1 : 2,
        })),
      },
    }
    const drifted = {
      ...artifact,
      intent: {
        ...driftedUnsigned,
        content_checksum: computeOrderIntentChecksum(driftedUnsigned),
      },
    }
    await writeFile(
      path.join(directory, `${artifact.intent.intent_id}.source.json`),
      `${JSON.stringify(drifted, null, 2)}\n`,
      'utf8',
    )
    await expect(source.get(artifact.intent.intent_id))
      .rejects.toMatchObject({ code: 'RECORD_INTEGRITY_FAILURE' })
  })

  test('fails closed on an off-grid points stop', () => {
    expect(() => convertDiscoTraderTicket(
      ticket({
        entry: undefined,
        stop: undefined,
        stopDistancePoints: 2.1,
        action: { ...ticket().action, entry: undefined, stop: undefined },
      }),
      route,
      NOW,
    )).toThrow('exact positive instrument tick count')
  })
})
