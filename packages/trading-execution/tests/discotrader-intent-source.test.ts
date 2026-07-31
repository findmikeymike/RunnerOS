import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ExecutionRecord, OrderIntent } from '@trade-god/contracts'

import {
  ExecutionGatewayError,
  FileDiscoTraderIntentSource,
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
  instrument: {
    canonical_id: 'CME:ESU6',
    symbol: 'ESU6',
    exchange: 'XCME',
    expiry: '2026-09',
    tick_size: '0.25',
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
  test('preserves deterministic size and immutable author while converting to order-intent@1', () => {
    const artifact = convertDiscoTraderTicket(ticket(), route, NOW)

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
          source_id: 'discord-message-123',
          author_id: 'discord-user-456',
        },
        instrument: {
          canonical_id: 'CME:ESU6',
          symbol: 'ESU6',
        },
        side: 'buy',
        quantity: 3,
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
    const source = ticket({ entry: undefined, stop: undefined, stopDistancePoints: 2.5 })
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
    expect(() => convertDiscoTraderTicket(ticket({ targets: [5599] }), route, NOW))
      .toThrow('target is on the wrong side')
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

  test('fails closed on an off-grid points stop', () => {
    expect(() => convertDiscoTraderTicket(
      ticket({ entry: undefined, stop: undefined, stopDistancePoints: 2.1 }),
      route,
      NOW,
    )).toThrow('exact positive instrument tick count')
  })
})
