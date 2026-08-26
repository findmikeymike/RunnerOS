import { createHash } from 'node:crypto'

import {
  DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
  discordOptionsSignalSchema,
  type DiscordOptionsSignal,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'

export type DiscordOptionsEntryInput = {
  guild_id: string
  channel_id: string
  message_id: string
  author_id: string
  thread_id: string | null
  reply_to_message_id: string | null
  posted_at: string
  received_at: string
  raw_text: string
}

export type DiscordOptionsEntryParseResult =
  | { status: 'parsed'; signal: DiscordOptionsSignal }
  | { status: 'needs-review'; code: 'OPTIONS_SIGNAL_INCOMPLETE'; detail: string }
  | {
      status: 'blocked'
      code: 'OPTIONS_SIGNAL_AMBIGUOUS' | 'OPTIONS_STRATEGY_UNSUPPORTED' | 'OPTIONS_SIGNAL_INTEGRITY'
      detail: string
    }

const unsupportedStrategy = /\b(?:sell|close|sto|short\s+(?:a\s+)?(?:call|put)|spread|straddle|strangle|condor|butterfly|calendar|covered\s+call|cash[- ]secured\s+put)\b|\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?/i
const nonActionable = /\?|^(?:should|could|would|can|do)\b|\b(?:if|when|unless|maybe|might|consider|watching|thinking about|earlier|yesterday|already bought|filled at)\b/i

const exactEntry = /\b(?:buy\s+to\s+open|buy|bto)\s+(?:(\d{1,4})\s+)?([A-Z][A-Z0-9.]{0,14})\s+(\d{4}-\d{2}-\d{2})\s+(\d+(?:\.\d+)?)\s*(C|P|CALL|PUT)\b[\s\S]*?(?:@|\bAT\b|\bFOR\b)\s*\$?(\d+(?:\.\d+)?)(?:\s*-\s*\$?(\d+(?:\.\d+)?))?/i

export function parseDiscordOptionsEntry(input: DiscordOptionsEntryInput): DiscordOptionsEntryParseResult {
  if (!Number.isFinite(Date.parse(input.posted_at))
    || !Number.isFinite(Date.parse(input.received_at))
    || Date.parse(input.received_at) < Date.parse(input.posted_at)
    || input.raw_text.trim().length === 0) {
    return { status: 'blocked', code: 'OPTIONS_SIGNAL_INTEGRITY', detail: 'Discord evidence chronology or content is invalid.' }
  }

  const text = input.raw_text.trim().replace(/[–—]/g, '-')
  if (unsupportedStrategy.test(text)) {
    return { status: 'blocked', code: 'OPTIONS_STRATEGY_UNSUPPORTED', detail: 'Only one long call or put may be opened.' }
  }
  if (nonActionable.test(text)) {
    return { status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS', detail: 'Questions, conditions, and retrospective discussion are not executable.' }
  }
  const contractTokens = text.match(/\b\d+(?:\.\d+)?\s*(?:C|P|CALL|PUT)\b/gi) ?? []
  if (contractTokens.length > 1) {
    return { status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS', detail: 'Exactly one option contract must be stated.' }
  }
  const entryPriceMarkers = text.match(/(?:@|\bAT\b|\bFOR\b)\s*\$?\d+(?:\.\d+)?/gi) ?? []
  if (entryPriceMarkers.length > 1 || /\d+\.\d+\s*-\s*\d+\.\d+\s*-/.test(text)) {
    return { status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS', detail: 'Exactly one entry price or one bounded range must be stated.' }
  }

  const match = exactEntry.exec(text)
  if (!match) {
    return { status: 'needs-review', code: 'OPTIONS_SIGNAL_INCOMPLETE', detail: 'Ticker, ISO expiration, strike, call/put, and option premium are required.' }
  }

  const [, quantityText, underlyingText, expiration, strikeText, rightText, lowText, highText] = match
  const low = canonicalDecimal(lowText!)
  const high = highText ? canonicalDecimal(highText) : undefined
  if (high && decimalCompare(high, low) < 0) {
    return { status: 'blocked', code: 'OPTIONS_SIGNAL_AMBIGUOUS', detail: 'Entry range high cannot be below its low.' }
  }

  const withoutChecksum = {
    signal_schema_version: DISCORD_OPTIONS_SIGNAL_SCHEMA_VERSION,
    signal_id: `discord-options:${input.guild_id}:${input.channel_id}:${input.message_id}`,
    provenance: {
      guild_id: input.guild_id,
      channel_id: input.channel_id,
      message_id: input.message_id,
      author_id: input.author_id,
      thread_id: input.thread_id,
      reply_to_message_id: input.reply_to_message_id,
      posted_at: input.posted_at,
      received_at: input.received_at,
      content_sha256: createHash('sha256').update(input.raw_text).digest('hex'),
    },
    raw_text: input.raw_text,
    action: 'buy_to_open' as const,
    strategy: 'single-leg' as const,
    underlying: underlyingText!.toUpperCase(),
    expiration: expiration!,
    strike: canonicalDecimal(strikeText!),
    right: /^(?:C|CALL)$/i.test(rightText!) ? 'call' as const : 'put' as const,
    reference_entry: high ?? low,
    reference_kind: high ? 'entry_range' as const : 'single_price' as const,
    ...(high ? { reference_range: { low, high } } : {}),
    ...(quantityText ? { source_quantity: Number(quantityText) } : {}),
  }
  try {
    return {
      status: 'parsed',
      signal: discordOptionsSignalSchema.parse({
        ...withoutChecksum,
        content_checksum: sha256(withoutChecksum),
      }),
    }
  } catch {
    return { status: 'blocked', code: 'OPTIONS_SIGNAL_INTEGRITY', detail: 'Parsed evidence failed the strict signal contract.' }
  }
}

function canonicalDecimal(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '')
  const normalizedFraction = fraction.replace(/0+$/, '')
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole
}

function decimalCompare(left: string, right: string): number {
  const a = left.split('.')
  const b = right.split('.')
  const scale = Math.max(a[1]?.length ?? 0, b[1]?.length ?? 0)
  const leftValue = BigInt(`${a[0]}${(a[1] ?? '').padEnd(scale, '0')}`)
  const rightValue = BigInt(`${b[0]}${(b[1] ?? '').padEnd(scale, '0')}`)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}
