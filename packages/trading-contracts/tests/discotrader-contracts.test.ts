import { describe, expect, test } from 'bun:test'

import { discoTraderPushPayloadSchema, discoTraderTicketSchema } from '../src/index.ts'

const ticket = {
  id: 'ticket-1',
  createdAt: '2026-07-30T15:05:00.000Z',
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
    observedAt: '2026-07-30T15:05:00.000Z',
    latencyMs: 1_000,
  },
  gateTrail: ['killSwitch:pass', 'sizing:pass'],
  llmVeto: {
    decision: 'accept',
    reason: 'The deterministic interpretation matches the message.',
    model: 'fixture-veto',
    ms: 10,
  },
} as const

describe('DiscoTrader handoff contracts', () => {
  test('accepts the complete immutable webhook ticket', () => {
    expect(discoTraderPushPayloadSchema.parse({
      kind: 'ticket',
      severity: 'action_required',
      summary: 'LONG 3xESU6',
      ticket,
      at: '2026-07-30T15:05:00.000Z',
    }).ticket?.provenance.authorId).toBe('discord-user-456')
  })

  test('rejects ticket pushes without a full ticket', () => {
    expect(discoTraderPushPayloadSchema.safeParse({
      kind: 'ticket',
      severity: 'action_required',
      summary: 'ticket omitted',
      at: '2026-07-30T15:05:00.000Z',
    }).success).toBe(false)
  })

  test('rejects non-finite money and size fields', () => {
    expect(discoTraderTicketSchema.safeParse({
      ...ticket,
      riskUsd: Number.POSITIVE_INFINITY,
    }).success).toBe(false)
  })
})
