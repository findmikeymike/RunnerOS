import {
  OPTIONS_ENTRY_DECISION_SCHEMA_VERSION,
  discordOptionsSignalSchema,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  optionsEntryPolicySchema,
  optionsEntryDecisionSchema,
  type DiscordOptionsSignal,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
  type OptionsEntryDecision,
  type OptionsEntryPolicy,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'
import { isOptionPriceOnTick, optionTickForPrice } from './option-tick.ts'

export type DecideOptionsEntryInput = {
  signal: DiscordOptionsSignal
  contract: OptionContractIdentity
  quote: OptionQuoteSnapshot
  policy: OptionsEntryPolicy
  route_checksum: string
  account_checksum: string
  decision_at: string
  estimated_fee_per_contract: string
}

export function decideOptionsEntry(input: DecideOptionsEntryInput): OptionsEntryDecision {
  const signal = discordOptionsSignalSchema.parse(input.signal)
  const contract = optionContractIdentitySchema.parse(input.contract)
  const quote = optionQuoteSnapshotSchema.parse(input.quote)
  const policy = optionsEntryPolicySchema.parse(input.policy)
  const decidedAtMs = Date.parse(input.decision_at)
  if (!Number.isFinite(decidedAtMs)) throw new Error('OPTIONS_SIGNAL_INTEGRITY: decision time is invalid')

  const bid = FixedDecimal.from(quote.bid)
  const ask = FixedDecimal.from(quote.ask)
  const reference = FixedDecimal.from(signal.reference_entry)
  const midpoint = bid.add(ask).divideInteger(2, 6)
  const spread = ask.subtract(bid)
  const spreadPct = spread.multiply('100', 6).divide(midpoint, 6)
  const unfavorable = ask.compare(reference) > 0 ? ask.subtract(reference) : FixedDecimal.from('0')
  const unfavorablePct = unfavorable.multiply('100', 6).divide(reference, 6)
  const favorable = ask.compare(reference) < 0 ? reference.subtract(ask) : FixedDecimal.from('0')
  const favorablePct = favorable.multiply('100', 6).divide(reference, 6)
  const absoluteCap = reference.add(policy.max_chase_abs)
  const percentageCap = reference
    .multiply(FixedDecimal.from('100').add(policy.max_chase_pct), 6)
    .divide('100', 6)
  let chaseCap = minimum(absoluteCap, percentageCap)
  if (signal.reference_range) chaseCap = minimum(chaseCap, FixedDecimal.from(signal.reference_range.high))

  let quantity = policy.sizing.mode === 'fixed_contracts'
    ? policy.sizing.fixed_contracts
    : policy.max_contracts_per_order
  if (policy.source_quantity_behavior === 'use_with_cap' && signal.source_quantity !== undefined) {
    quantity = Math.min(quantity, signal.source_quantity)
  }
  quantity = Math.min(quantity, policy.max_contracts_per_order)

  const blockers: string[] = []
  const postedAtMs = Date.parse(signal.provenance.posted_at)
  const receivedAtMs = Date.parse(signal.provenance.received_at)
  if (decidedAtMs - postedAtMs > policy.max_signal_age_ms
    || receivedAtMs - postedAtMs > policy.max_ingest_delay_ms
    || decidedAtMs < receivedAtMs) blockers.push('OPTIONS_SIGNAL_STALE')
  if (decidedAtMs >= Date.parse(policy.mandate_expires_at)) blockers.push('OPTIONS_MANDATE_EXPIRED')
  if (!isInsideEntryWindow(input.decision_at, policy)) blockers.push('OPTIONS_SESSION_CLOSED')
  const dte = calendarDaysBetween(exchangeDate(input.decision_at), signal.expiration)
  if (dte < policy.min_days_to_expiration || dte > policy.max_days_to_expiration) blockers.push('OPTIONS_EXPIRATION_INELIGIBLE')

  if (signal.underlying !== contract.underlying
    || signal.expiration !== contract.expiration
    || signal.strike !== contract.strike
    || signal.right !== contract.right
    || contract.multiplier !== 100
    || !contract.standard_deliverable
    || !contract.listing_eligible
    || !contract.smart_routing_eligible) blockers.push('OPTIONS_CONTRACT_UNSUPPORTED')
  if (Date.parse(contract.resolved_at) > decidedAtMs) blockers.push('OPTIONS_PROVIDER_DIVERGENCE')

  if (quote.connection_id !== policy.connection_id
    || quote.account_id !== policy.account_id
    || quote.canonical_contract_id !== contract.canonical_id
    || quote.provider_instrument_id !== contract.provider_instrument_id
    || quote.environment !== policy.environment
    || contract.provider !== policy.provider_slug) blockers.push('OPTIONS_PROVIDER_DIVERGENCE')
  if (quote.decision_at !== input.decision_at
    || quote.quote_age_ms > policy.max_quote_age_ms
    || quote.delayed
    || quote.indicative
    || quote.halted
    || quote.market_data_mode !== 'realtime') blockers.push('OPTIONS_QUOTE_STALE')
  if (quote.minimum_tick !== optionTickForPrice(contract, ask)
    || !isOptionPriceOnTick(contract, ask)
    || !isOptionPriceOnTick(contract, bid)) blockers.push('OPTIONS_PROVIDER_DIVERGENCE')
  if (quote.bid_size < policy.min_bid_size || quote.ask_size < policy.min_ask_size) blockers.push('OPTIONS_QUOTE_UNAVAILABLE')

  let action: OptionsEntryDecision['action'] = 'block'
  let limit: FixedDecimal | undefined
  let reasons = unique(blockers)
  if (reasons.length === 0 && ask.compare(chaseCap) > 0) {
    action = 'skip'
    reasons = ['OPTIONS_PRICE_MOVED_BEYOND_CAP']
  } else if (reasons.length === 0 && favorablePct.compare(policy.max_favorable_retrace_pct) > 0) {
    action = 'skip'
    reasons = ['OPTIONS_PRICE_COLLAPSED_FROM_SIGNAL']
  } else if (reasons.length === 0) {
    const spreadPasses = spread.compare(policy.max_spread_abs) <= 0
      && spreadPct.compare(policy.max_spread_pct) <= 0
    if (spreadPasses && policy.tight_spread_action === 'marketable_limit') {
      action = 'marketable_limit'
      const rawLimit = minimum(ask, chaseCap)
      limit = rawLimit.roundDownToTick(optionTickForPrice(contract, rawLimit))
      reasons = ['ELIGIBLE']
    } else if (!spreadPasses && policy.wide_spread_action === 'passive_limit') {
      const passiveCandidate = maximum(
        bid.add(optionTickForPrice(contract, bid)),
        minimum(midpoint, reference.add(policy.passive_limit_offset_abs)),
      )
      const rawCandidate = minimum(passiveCandidate, chaseCap)
      const candidate = rawCandidate.roundDownToTick(optionTickForPrice(contract, rawCandidate))
      if (candidate.compare(bid) > 0 && candidate.compare(midpoint) <= 0 && candidate.compare(chaseCap) <= 0) {
        action = 'passive_limit'
        limit = candidate
        reasons = ['ELIGIBLE_PASSIVE']
      } else {
        action = 'skip'
        reasons = ['OPTIONS_SPREAD_TOO_WIDE']
      }
    } else if (spreadPasses) {
      action = 'skip'
      reasons = ['OPTIONS_POLICY_SKIP']
    } else {
      action = 'skip'
      reasons = ['OPTIONS_SPREAD_TOO_WIDE']
    }
  }

  const rawProvisionalLimit = limit ?? minimum(ask, chaseCap)
  const provisionalLimit = rawProvisionalLimit.roundDownToTick(optionTickForPrice(contract, rawProvisionalLimit))
  const feePerContract = FixedDecimal.from(input.estimated_fee_per_contract)
  if (feePerContract.compare('0') < 0) throw new Error('OPTIONS_RISK_LIMIT: fee estimate cannot be negative')

  if (policy.sizing.mode === 'max_debit_budget') {
    quantity = quantityForBudget(
      provisionalLimit,
      feePerContract,
      policy.sizing.max_debit_budget,
      quantity,
    )
    if (quantity === 0) {
      action = 'block'
      limit = undefined
      reasons = ['OPTIONS_RISK_LIMIT']
      quantity = 1
    }
  }

  if (action === 'marketable_limit' && quote.ask_size < quantity) {
    action = 'block'
    limit = undefined
    reasons = ['OPTIONS_QUOTE_UNAVAILABLE']
  }

  const fees = feePerContract.multiplyInteger(quantity)
  const maximumDebit = provisionalLimit.multiplyInteger(100).multiplyInteger(quantity).add(fees)
  if (maximumDebit.compare(policy.max_debit_per_trade) > 0) {
    action = 'block'
    limit = undefined
    reasons = ['OPTIONS_RISK_LIMIT']
  }

  const validityCandidates = [
    postedAtMs + policy.max_signal_age_ms,
    decidedAtMs + policy.working_order_ttl_ms,
    Date.parse(policy.mandate_expires_at),
  ].filter(Number.isFinite)
  const validUntilMs = Math.max(decidedAtMs + 1, Math.min(...validityCandidates))
  const decisionId = `options-decision:${sha256({
    signal: signal.content_checksum,
    contract: contract.content_checksum,
    quote: quote.content_checksum,
    policy: policy.content_checksum,
    decision_at: input.decision_at,
  }).slice(0, 32)}`

  const withoutChecksum = {
    decision_schema_version: OPTIONS_ENTRY_DECISION_SCHEMA_VERSION,
    decision_id: decisionId,
    signal_checksum: signal.content_checksum,
    route_checksum: input.route_checksum,
    account_checksum: input.account_checksum,
    contract_checksum: contract.content_checksum,
    quote_checksum: quote.content_checksum,
    policy_checksum: policy.content_checksum,
    source_reference_price: money(reference),
    bid: money(bid),
    ask: money(ask),
    midpoint: midpoint.toCanonicalString(2),
    spread_abs: money(spread),
    spread_pct: spreadPct.toString(),
    unfavorable_drift_abs: money(unfavorable),
    unfavorable_drift_pct: unfavorablePct.toString(),
    favorable_retrace_pct: favorablePct.toString(),
    absolute_chase_cap: money(absoluteCap),
    percentage_chase_cap: money(percentageCap),
    effective_chase_cap: money(chaseCap),
    action,
    ...(limit ? { limit_price: money(limit) } : {}),
    planned_quantity: quantity,
    maximum_debit: money(maximumDebit),
    reason_codes: reasons,
    decided_at: input.decision_at,
    valid_until: new Date(validUntilMs).toISOString(),
  }
  return optionsEntryDecisionSchema.parse({
    ...withoutChecksum,
    content_checksum: sha256(withoutChecksum),
  })
}

function quantityForBudget(limit: FixedDecimal, fee: FixedDecimal, budget: string, cap: number): number {
  const perContract = limit.multiplyInteger(100).add(fee)
  let quantity = 0
  for (let candidate = 1; candidate <= cap; candidate += 1) {
    if (perContract.multiplyInteger(candidate).compare(budget) > 0) break
    quantity = candidate
  }
  return quantity
}

function money(value: FixedDecimal): string {
  return value.toCanonicalString(2)
}

function minimum(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  return left.compare(right) <= 0 ? left : right
}

function maximum(left: FixedDecimal, right: FixedDecimal): FixedDecimal {
  return left.compare(right) >= 0 ? left : right
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function exchangeDate(timestamp: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

function calendarDaysBetween(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000)
}

function isInsideEntryWindow(timestamp: string, policy: OptionsEntryPolicy): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: policy.entry_window.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const weekday = parts.find((part) => part.type === 'weekday')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value
  const weekdayNumber = weekday ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday) : -1
  const clock = `${hour ?? ''}:${minute ?? ''}`
  return policy.allowed_weekdays.includes(weekdayNumber)
    && clock >= policy.entry_window.earliest
    && clock <= policy.entry_window.latest
}
