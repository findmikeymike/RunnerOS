import { createHash, createHmac, randomUUID } from 'node:crypto'

import {
  OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
} from '@trade-god/contracts'

import { sha256 } from '../canonical.ts'
import { FixedDecimal } from './fixed-decimal.ts'
import { isOptionPriceOnTick } from './option-tick.ts'
import type {
  OptionsProviderAccountSnapshot,
  OptionsProviderAdapter,
  OptionsProviderOrder,
  OptionsProviderOrderRequest,
} from './options-provider-adapter.ts'

const WEBULL_ENDPOINT = 'https://api.sandbox.webull.com'

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class WebullOptionsAdapter implements OptionsProviderAdapter {
  readonly descriptor: OptionsProviderAdapter['descriptor']
  private readonly contracts = new Map<string, OptionContractIdentity>()

  constructor(private readonly config: {
    connection_id: string
    account_id: string
    app_key: string
    app_secret: string
    access_token?: string
    credential_generation: string
    fetch?: FetchLike
    now?: () => string
    nonce?: () => string
  }) {
    this.descriptor = {
      adapter_id: 'webull-options-api',
      adapter_version: '1.0.0',
      provider_contract_version: 'webull-trading-api-options-sandbox-2026-08-26',
      environment: 'sandbox',
      credential_generation: config.credential_generation,
      preview_supported: true,
    }
  }

  async resolveContract(query: { underlying: string; expiration: string; strike: string; right: 'call' | 'put' }): Promise<OptionContractIdentity> {
    const underlying = query.underlying.trim().toUpperCase()
    const strike = FixedDecimal.from(query.strike).toString()
    const response = await this.get('/trading/instruments/options/contracts/list', {
      symbol: underlying,
      status: 'ACTIVE',
      option_expire_date: query.expiration,
    })
    const matches = rows(response).filter((row) => (
      field(row, 'symbol')?.toUpperCase() === underlying
      && field(row, 'option_expire_date', 'expire_date') === query.expiration
      && equalDecimal(row.strike_price ?? row.strike, strike)
      && field(row, 'option_type', 'right')?.toUpperCase() === query.right.toUpperCase()
      && field(row, 'market')?.toUpperCase() === 'US'
      && field(row, 'currency')?.toUpperCase() === 'USD'
      && equalDecimal(row.multiplier, '100')
      && field(row, 'status')?.toUpperCase() === 'ACTIVE'
    ))
    if (matches.length !== 1) throw new Error('Webull did not return one exact active standard US option contract.')
    const found = matches[0]!
    const instrumentId = field(found, 'instrument_id', 'option_id')
    const providerSymbol = field(found, 'option_symbol', 'ticker', 'instrument_symbol')
    const minimumTick = decimal(found.tick_size ?? found.price_increment)
    const tickRuleType = field(found, 'tick_rule_type')?.toUpperCase()
    if (!instrumentId || !providerSymbol || !minimumTick) throw new Error('Webull option contract omitted exact instrument or tick evidence.')
    if (tickRuleType !== 'CONSTANT') throw new Error('Webull option contract did not prove a constant tick rule across the admitted price range.')
    const resolvedAt = this.now()
    const body = {
      contract_schema_version: OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
      canonical_id: `USOPT:${underlying}:${query.expiration}:${query.right === 'call' ? 'C' : 'P'}:${strike}`,
      underlying,
      expiration: query.expiration,
      strike,
      right: query.right,
      currency: 'USD' as const,
      asset_class: 'US_LISTED_OPTION' as const,
      multiplier: 100 as const,
      standard_deliverable: true as const,
      provider: 'webull',
      provider_instrument_id: instrumentId,
      provider_symbol: providerSymbol,
      listing_eligible: true,
      smart_routing_eligible: true,
      minimum_tick: minimumTick,
      increment_bands: [{ minimum_price: '0', increment: minimumTick }],
      resolved_at: resolvedAt,
    }
    const contract = optionContractIdentitySchema.parse({ ...body, content_checksum: sha256(body) })
    this.contracts.set(contract.canonical_id, contract)
    return contract
  }

  async quote(canonicalContractId: string): Promise<OptionQuoteSnapshot> {
    const contract = this.requireContract(canonicalContractId)
    const matches = rows(await this.get('/market-data/options/snapshots/list', {
      symbols: contract.provider_symbol,
    })).filter((row) => field(row, 'instrument_id') === contract.provider_instrument_id || field(row, 'symbol') === contract.provider_symbol)
    if (matches.length !== 1) throw new Error('Webull did not return one exact option snapshot.')
    const row = matches[0]!
    if (field(row, 'market_data_type', 'quote_type')?.toUpperCase() !== 'REALTIME' || row.is_delayed !== false) {
      throw new Error('Webull OPRA realtime non-display quote permission is not proven.')
    }
    const bid = requiredDecimal(row.bid_price ?? row.bid)
    const ask = requiredDecimal(row.ask_price ?? row.ask)
    const bidSize = nonnegativeInteger(row.bid_size ?? row.bid_quantity)
    const askSize = nonnegativeInteger(row.ask_size ?? row.ask_quantity)
    const providerTimestamp = timestamp(row.quote_time ?? row.timestamp)
    if (row.halted !== false) throw new Error('Webull option snapshot did not explicitly prove the contract is trading.')
    const receivedAt = this.now()
    const body = {
      quote_schema_version: OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
      quote_id: `webull-quote-${sha256({ instrument: contract.provider_instrument_id, providerTimestamp, receivedAt }).slice(0, 24)}`,
      connection_id: this.config.connection_id,
      account_id: this.config.account_id,
      canonical_contract_id: contract.canonical_id,
      provider_instrument_id: contract.provider_instrument_id,
      environment: 'sandbox' as const,
      market_data_mode: 'realtime' as const,
      bid,
      ask,
      bid_size: bidSize,
      ask_size: askSize,
      provider_timestamp: providerTimestamp,
      received_at: receivedAt,
      decision_at: receivedAt,
      quote_age_ms: Math.max(0, Date.parse(receivedAt) - Date.parse(providerTimestamp)),
      delayed: false,
      indicative: false,
      halted: false,
      minimum_tick: contract.minimum_tick,
      provenance: 'webull-openapi:/market-data/options/snapshots/list',
    }
    return optionQuoteSnapshotSchema.parse({ ...body, content_checksum: sha256(body) })
  }

  async preview(request: OptionsProviderOrderRequest): Promise<{ estimated_debit: string; estimated_fees: string; buying_power_impact: string }> {
    this.assertRequest(request)
    const response = object(await this.post('/trading/orders/preview', webullOrderBody(request, this.requireContract(request.canonical_contract_id))))
    const debit = FixedDecimal.from(request.limit_price).multiplyInteger(100).multiplyInteger(request.quantity).toString()
    const fees = requiredDecimal(response.estimated_fees ?? response.commission ?? response.fees)
    const impact = requiredDecimal(response.buying_power_impact ?? response.estimated_total ?? response.total_amount)
    if (FixedDecimal.from(debit).add(fees).compare(impact) !== 0) throw new Error('Webull preview total does not match bounded debit plus fees.')
    return { estimated_debit: debit, estimated_fees: fees, buying_power_impact: impact }
  }

  async submit(_request: OptionsProviderOrderRequest): Promise<OptionsProviderOrder> {
    throw new Error('Webull sandbox submission is blocked until retained certification proves long-open position semantics.')
  }

  async getOrderByClientId(accountId: string, clientOrderId: string): Promise<OptionsProviderOrder | null> {
    if (accountId !== this.config.account_id) throw new Error('Webull order account does not match the configured sandbox account.')
    const response = await this.get('/trading/orders/get', { account_id: accountId, client_order_id: clientOrderId })
    const candidates = rows(response)
    if (candidates.length === 0 && Object.keys(object(response)).length === 0) return null
    const matches = (candidates.length ? candidates : [object(response)]).filter((row) => field(row, 'client_order_id') === clientOrderId)
    if (matches.length !== 1) throw new Error('Webull did not return one exact order for the client order ID.')
    return this.normalizeOrder(matches[0]!, accountId)
  }

  async snapshotAccount(accountId: string): Promise<OptionsProviderAccountSnapshot> {
    if (accountId !== this.config.account_id) throw new Error('Webull snapshot account does not match the configured sandbox account.')
    throw new Error('Webull current account truth is uncertified: its open-order list may lag and no sequenced order-event reconciliation is attached.')
  }

  private normalizeOrder(row: Record<string, unknown>, accountId: string): OptionsProviderOrder {
    const clientOrderId = requiredField(row, 'client_order_id')
    const providerOrderId = requiredField(row, 'order_id')
    const instrumentId = requiredField(row, 'instrument_id')
    const contract = [...this.contracts.values()].find((candidate) => candidate.provider_instrument_id === instrumentId)
    if (field(row, 'side')?.toUpperCase() !== 'BUY' || field(row, 'order_type')?.toUpperCase() !== 'LIMIT' || field(row, 'time_in_force')?.toUpperCase() !== 'DAY'
      || field(row, 'option_strategy')?.toUpperCase() !== 'SINGLE' || field(row, 'combo_type')?.toUpperCase() !== 'NORMAL') {
      throw new Error('Webull order truth is outside the certified long single-leg scope.')
    }
    const quantity = positiveInteger(row.quantity)
    const filled = nonnegativeInteger(row.filled_quantity ?? row.filled_qty ?? 0)
    const averageFillPrice = filled > 0 ? requiredDecimal(row.average_fill_price ?? row.filled_avg_price) : undefined
    return {
      account_id: accountId,
      canonical_contract_id: contract?.canonical_id ?? `UNOWNED:${instrumentId}`,
      provider_instrument_id: instrumentId,
      action: 'BUY_TO_OPEN',
      order_type: 'limit',
      limit_price: requiredDecimal(row.limit_price),
      quantity,
      time_in_force: 'day',
      regular_hours_only: true,
      client_order_id: clientOrderId,
      provider_order_id: providerOrderId,
      status: normalizeWebullStatus(requiredField(row, 'status'), filled, quantity),
      filled_quantity: filled,
      ...(averageFillPrice ? { average_fill_price: averageFillPrice } : {}),
    }
  }

  private assertRequest(request: OptionsProviderOrderRequest): void {
    const contract = this.contracts.get(request.canonical_contract_id)
    if (request.account_id !== this.config.account_id || !contract) {
      throw new Error('Webull request exceeds the certified single-leg sandbox scope.')
    }
    assertWebullRequest(request, contract)
  }

  private requireContract(id: string): OptionContractIdentity {
    const contract = this.contracts.get(id)
    if (!contract) throw new Error('Exact Webull option contract is not registered in this adapter session.')
    return contract
  }

  private get(pathname: string, query: Record<string, string>): Promise<unknown> { return this.request('GET', pathname, query) }
  private post(pathname: string, body: unknown): Promise<unknown> { return this.request('POST', pathname, {}, body) }
  private async request(method: 'GET' | 'POST', pathname: string, query: Record<string, string>, body?: unknown): Promise<unknown> {
    const url = new URL(`${WEBULL_ENDPOINT}${pathname}`)
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
    const bodyText = body === undefined ? undefined : JSON.stringify(body)
    const timestampValue = this.now().replace(/\.\d{3}Z$/, 'Z')
    const nonce = (this.config.nonce ?? (() => randomUUID().replaceAll('-', '')))()
    const signature = createWebullOptionsSignature({ pathname, query, body: bodyText, appKey: this.config.app_key, appSecret: this.config.app_secret, timestamp: timestampValue, nonce })
    const response = await (this.config.fetch ?? fetch)(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        'x-app-key': this.config.app_key,
        'x-timestamp': timestampValue,
        'x-signature': signature,
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-version': '1.0',
        'x-signature-nonce': nonce,
        'x-version': 'v2',
        ...(this.config.access_token ? { 'x-access-token': this.config.access_token } : {}),
        ...(bodyText ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(bodyText ? { body: bodyText } : {}),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Webull sandbox API failed with HTTP ${response.status}.`)
    return response.json()
  }

  private now(): string { return (this.config.now ?? (() => new Date().toISOString()))() }
}

export function webullOrderBody(request: OptionsProviderOrderRequest, contract: OptionContractIdentity): Record<string, unknown> {
  assertWebullRequest(request, contract)
  return {
    account_id: request.account_id,
    new_orders: [{
      client_order_id: request.client_order_id,
      combo_type: 'NORMAL',
      order_type: 'LIMIT',
      limit_price: request.limit_price,
      quantity: String(request.quantity),
      option_strategy: 'SINGLE',
      side: 'BUY',
      time_in_force: 'DAY',
      entrust_type: 'QTY',
      instrument_type: 'OPTION',
      market: 'US',
      symbol: contract.underlying,
      legs: [{
        side: 'BUY',
        quantity: String(request.quantity),
        symbol: contract.underlying,
        strike_price: contract.strike,
        option_expire_date: contract.expiration,
        instrument_type: 'OPTION',
        option_type: contract.right.toUpperCase(),
        market: 'US',
      }],
    }],
  }
}

const assertWebullRequest = (request: OptionsProviderOrderRequest, contract: OptionContractIdentity): void => {
  if (contract.provider !== 'webull' || request.canonical_contract_id !== contract.canonical_id
    || request.provider_instrument_id !== contract.provider_instrument_id || request.action !== 'BUY_TO_OPEN'
    || request.order_type !== 'limit' || request.quantity !== 1 || request.time_in_force !== 'day'
    || request.regular_hours_only !== true || !/^tg(?:opt|cert)-[a-z0-9-]+$/i.test(request.client_order_id)
    || request.client_order_id.length > 32 || !isOptionPriceOnTick(contract, request.limit_price)) {
    throw new Error('Webull request exceeds the certified single-leg sandbox scope.')
  }
}

const encodeRfc3986 = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
export function createWebullOptionsSignature(input: { pathname: string; query?: Record<string, string>; body?: string; appKey: string; appSecret: string; timestamp: string; nonce: string }): string {
  const signing: Record<string, string> = {
    ...(input.query ?? {}),
    host: new URL(WEBULL_ENDPOINT).host,
    'x-app-key': input.appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': input.nonce,
    'x-signature-version': '1.0',
    'x-timestamp': input.timestamp,
  }
  const joined = Object.keys(signing).sort().map((key) => `${key}=${signing[key]}`).join('&')
  const bodyHash = input.body ? `&${createHash('md5').update(input.body).digest('hex').toUpperCase()}` : ''
  return createHmac('sha1', `${input.appSecret}&`).update(encodeRfc3986(`${input.pathname}&${joined}${bodyHash}`)).digest('base64')
}

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const rows = (value: unknown): Record<string, unknown>[] => {
  const direct = Array.isArray(value) ? value : [object(value).data, object(value).items, object(value).orders, object(value).positions].find(Array.isArray)
  return Array.isArray(direct) ? direct.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
}
const field = (row: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}
const requiredField = (row: Record<string, unknown>, ...keys: string[]): string => {
  const value = field(row, ...keys)
  if (!value) throw new Error(`Webull response omitted ${keys[0]}.`)
  return value
}
const decimal = (value: unknown): string | undefined => {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return undefined
  return FixedDecimal.from(raw).toString()
}
const requiredDecimal = (value: unknown): string => {
  const parsed = decimal(value)
  if (!parsed) throw new Error('Webull response omitted exact decimal evidence.')
  return parsed
}
const equalDecimal = (value: unknown, expected: string): boolean => {
  const parsed = decimal(value)
  return parsed ? FixedDecimal.from(parsed).compare(expected) === 0 : false
}
const nonnegativeInteger = (value: unknown): number => {
  const parsed = Number(typeof value === 'string' || typeof value === 'number' ? value : NaN)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Webull response returned an invalid quantity.')
  return parsed
}
const positiveInteger = (value: unknown): number => {
  const parsed = nonnegativeInteger(value)
  if (parsed < 1) throw new Error('Webull response returned a nonpositive quantity.')
  return parsed
}
const timestamp = (value: unknown): string => {
  const milliseconds = typeof value === 'number' ? value : Number(typeof value === 'string' ? value : NaN)
  const parsed = Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : typeof value === 'string' ? new Date(value).toISOString() : ''
  if (!parsed || Number.isNaN(Date.parse(parsed))) throw new Error('Webull response omitted its provider timestamp.')
  return parsed
}
const normalizeWebullStatus = (status: string, filled: number, quantity: number): OptionsProviderOrder['status'] => {
  const normalized = status.toUpperCase()
  if (normalized.includes('CANCEL')) return filled > 0 ? 'partially-filled-canceled' : 'canceled'
  if (filled >= quantity || normalized === 'FILLED') return 'filled'
  if (filled > 0 || normalized === 'PARTIALLY_FILLED') return 'partially-filled'
  if (['SUBMITTED', 'PENDING', 'WORKING', 'NEW'].some((candidate) => normalized.includes(candidate))) return 'working'
  throw new Error(`Webull returned an unsupported order status: ${status}.`)
}
