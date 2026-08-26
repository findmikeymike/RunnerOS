import { describe, expect, test } from 'bun:test'

import {
  DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  discordOptionsSignalSchema,
} from '@trade-god/contracts'

import { parseDiscordOptionsEntry } from '../src/index.ts'

const metadata = {
  guild_id: 'guild-options',
  channel_id: 'channel-options',
  message_id: 'message-options-1',
  author_id: 'trader-options',
  thread_id: null,
  reply_to_message_id: null,
  posted_at: '2026-08-26T14:59:50.000Z',
  received_at: '2026-08-26T14:59:51.000Z',
} as const

describe('Discord single-leg options parser', () => {
  test('parses an exact long call and preserves immutable source evidence', () => {
    const result = parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'BUY SPY 2026-09-18 650C @ 1.25',
    })
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') throw new Error('Expected parsed signal')
    expect(result.signal).toMatchObject({
      signal_schema_version: DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
      action: 'buy_to_open',
      strategy: 'single-leg',
      underlying: 'SPY',
      expiration: '2026-09-18',
      strike: '650',
      right: 'call',
      reference_entry: '1.25',
      reference_kind: 'single_price',
      raw_text: 'BUY SPY 2026-09-18 650C @ 1.25',
    })
    expect(discordOptionsSignalSchema.parse(result.signal)).toEqual(result.signal)
  })

  test('parses a put range and freezes its high as the hard reference ceiling', () => {
    const result = parseDiscordOptionsEntry({
      ...metadata,
      message_id: 'message-options-2',
      raw_text: 'BTO QQQ 2026-09-18 590P at 1.20-1.30',
    })
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') throw new Error('Expected parsed signal')
    expect(result.signal).toMatchObject({
      underlying: 'QQQ',
      strike: '590',
      right: 'put',
      reference_entry: '1.3',
      reference_kind: 'entry_range',
      reference_range: { low: '1.2', high: '1.3' },
    })
  })

  test('retains source quantity as evidence without making it account sizing', () => {
    const result = parseDiscordOptionsEntry({
      ...metadata,
      message_id: 'message-options-3',
      raw_text: 'BUY 3 SPY 2026-09-18 650 CALL @ $1.25',
    })
    expect(result.status).toBe('parsed')
    if (result.status !== 'parsed') throw new Error('Expected parsed signal')
    expect(result.signal.source_quantity).toBe(3)
  })

  test('blocks spreads and short-option openings instead of selecting one leg', () => {
    expect(parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'BUY SPY 2026-09-18 650/655 call spread @ 1.20',
    })).toMatchObject({ status: 'blocked', code: 'OPTIONS_STRATEGY_UNSUPPORTED' })
    expect(parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'SELL TO OPEN SPY 2026-09-18 650C @ 1.25',
    })).toMatchObject({ status: 'blocked', code: 'OPTIONS_STRATEGY_UNSUPPORTED' })
    expect(parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'BUY SPY 2026-09-18 650C or 655C @ 1.25',
    })).toMatchObject({ status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS' })
  })

  test('needs review for missing contract fields and refuses conversational text', () => {
    expect(parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'SPY calls here around 1.25',
    })).toMatchObject({ status: 'needs-review', code: 'OPTIONS_SIGNAL_INCOMPLETE' })
    expect(parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'Should we buy SPY 2026-09-18 650C @ 1.25?',
    })).toMatchObject({ status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS' })
    expect(parseDiscordOptionsEntry({
      ...metadata,
      raw_text: 'BUY SPY 2026-09-18 650C @ 1.25 or @ 1.10',
    })).toMatchObject({ status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS' })
  })

  test('is deterministic and refuses impossible provenance chronology', () => {
    const input = { ...metadata, raw_text: 'BUY SPY 2026-09-18 650C @ 1.25' }
    expect(parseDiscordOptionsEntry(input)).toEqual(parseDiscordOptionsEntry(input))
    expect(parseDiscordOptionsEntry({
      ...input,
      received_at: '2026-08-26T14:59:49.000Z',
    })).toMatchObject({ status: 'blocked', code: 'OPTIONS_SIGNAL_INTEGRITY' })
  })
})
