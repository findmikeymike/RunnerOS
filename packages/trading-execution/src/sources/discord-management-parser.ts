export type ParsedDiscordManagementAction =
  | { operation: 'partial-close'; fraction?: number; quantity?: number; source_phrase: string }
  | { operation: 'flatten'; reason: string; source_phrase: string }
  | {
      operation: 'move-stop'
      target: { basis: 'breakeven' } | { basis: 'explicit'; price: string }
      source_phrase: string
    }
  | { operation: 'reconcile'; reason: 'stopped-out'; source_phrase: string }

export interface ParsedDiscordManagement {
  actions: ParsedDiscordManagementAction[]
  symbol?: string
  error?: string
}

const SYMBOLS = ['MNQ', 'MES', 'MYM', 'M2K', 'RTY', 'NQ', 'ES', 'YM'] as const

export const parseDiscordManagementText = (rawText: string): ParsedDiscordManagement => {
  const text = rawText.trim()
  const normalized = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
  const symbol = SYMBOLS.find((candidate) => (
    new RegExp(`\\b${candidate}\\b`, 'i').test(text)
  ))

  if (
    text.includes('?')
    || /^(?:should|could|would|can|do)\b/.test(normalized)
    || /\b(?:if|when|unless|maybe|might|consider|thinking about)\b/.test(normalized)
    || /\b(?:earlier|yesterday|last week|already (?:closed|moved|took))\b/.test(normalized)
    || /\b(?:(?:do not|don't|dont|not)\s+(?:close|closing|flatten|move|moving|take|taking|trim|trimming))\b/.test(normalized)
    || /\b(?:later|tomorrow|in \d+\s+(?:seconds?|minutes?|hours?))\b/.test(normalized)
  ) {
    return { actions: [], symbol, error: 'Conditional, interrogative, or retrospective text is not executable.' }
  }

  const stoppedOut = /\b(?:stopped out|stop(?:ped)? (?:was )?hit|hit my stop)\b/.exec(normalized)
  const fullExit = /\b(?:all out|flatten(?: me)?|flat now|i(?:'m| am) out|done here|closing (?:it|this|everything|all|here|now)|close (?:it|this|everything|all|here|now))\b/.exec(normalized)
  const half = /\b(?:taking|take|closing|close|trim(?:ming)?|scal(?:e|ing)) (?:off |out )?(?:my )?half\b/.exec(normalized)
    ?? /\bhalf off\b/.exec(normalized)
    ?? /\bone of (?:my )?two\b/.exec(normalized)
  const percent = /\b(?:taking|take|closing|close|trim(?:ming)?|scal(?:e|ing)) (?:off |out )?(\d{1,3})\s*%\b/.exec(normalized)
  const quantity = /\b(?:taking|take|closing|close|trim(?:ming)?|scal(?:e|ing)) (?:off |out )?(\d{1,4})\s*(?:contracts?|lots?)\b/.exec(normalized)
  const breakeven = /\b(?:move|moving|raise|raising|set|setting)\s+(?:my |the )?stops?\s+(?:to )?(?:be|b\/e|breakeven|break even|entry|cost basis)\b/.exec(normalized)
  const explicitStop = /\b(?:move|moving|raise|raising|lower|lowering|set|setting)\s+(?:my |the )?stops?\s+(?:to|at)\s+\$?(\d+(?:\.\d+)?)\b/.exec(normalized)

  const partialMatches = [half, percent, quantity].filter(Boolean)
  if (partialMatches.length > 1 || (fullExit && partialMatches.length > 0)) {
    return { actions: [], symbol, error: 'Message contains conflicting exit instructions.' }
  }
  if (breakeven && explicitStop) {
    return { actions: [], symbol, error: 'Message contains conflicting stop instructions.' }
  }
  if (stoppedOut && (fullExit || partialMatches.length > 0 || breakeven || explicitStop)) {
    return { actions: [], symbol, error: 'Stopped-out status cannot be combined with a trade mutation.' }
  }
  if (stoppedOut) {
    return {
      actions: [{
        operation: 'reconcile',
        reason: 'stopped-out',
        source_phrase: stoppedOut[0],
      }],
      symbol,
    }
  }
  if (fullExit) {
    if (breakeven || explicitStop) {
      return { actions: [], symbol, error: 'A full exit cannot be combined with a stop movement.' }
    }
    return {
      actions: [{
        operation: 'flatten',
        reason: `Discord trader follow-up: ${fullExit[0]}`,
        source_phrase: fullExit[0],
      }],
      symbol,
    }
  }

  const actions: ParsedDiscordManagementAction[] = []
  if (half) {
    actions.push({ operation: 'partial-close', fraction: 0.5, source_phrase: half[0] })
  } else if (percent) {
    const value = Number(percent[1])
    if (!Number.isInteger(value) || value <= 0 || value >= 100) {
      return { actions: [], symbol, error: 'Partial-exit percentage must be between 1 and 99.' }
    }
    actions.push({ operation: 'partial-close', fraction: value / 100, source_phrase: percent[0] })
  } else if (quantity) {
    actions.push({
      operation: 'partial-close',
      quantity: Number(quantity[1]),
      source_phrase: quantity[0],
    })
  }
  if (breakeven) {
    actions.push({
      operation: 'move-stop',
      target: { basis: 'breakeven' },
      source_phrase: breakeven[0],
    })
  } else if (explicitStop) {
    actions.push({
      operation: 'move-stop',
      target: { basis: 'explicit', price: canonicalDecimal(explicitStop[1]!) },
      source_phrase: explicitStop[0],
    })
  }
  return actions.length > 0
    ? { actions, symbol }
    : { actions: [], symbol, error: 'Message has no supported trade-management instruction.' }
}

const canonicalDecimal = (value: string): string => {
  const [whole = '0', fractional] = value.split('.')
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '')
  const normalizedFractional = fractional?.replace(/0+$/, '')
  return normalizedFractional ? `${normalizedWhole}.${normalizedFractional}` : normalizedWhole
}
