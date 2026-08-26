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

const IBKR_ENDPOINT = 'https://api.ibkr.com/v1/api'
const SNAPSHOT_FIELDS = '84,85,86,88,6070,6509,7184,7768'

type FetchLike = (input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class IbkrOptionsAdapter implements OptionsProviderAdapter {
  readonly descriptor: OptionsProviderAdapter['descriptor']
  private readonly contracts = new Map<string, OptionContractIdentity>()

  constructor(private readonly config: {
    connection_id: string
    account_id: string
    access_token: string
    credential_generation: string
    fetch?: FetchLike
    now?: () => string
  }) {
    if (!/^DU\d+$/i.test(config.account_id)) throw new Error('IBKR options adapter is paper-account only.')
    this.descriptor = {
      adapter_id: 'ibkr-options-api',
      adapter_version: '1.0.0',
      provider_contract_version: 'ibkr-web-api-options-paper-2026-08-26',
      environment: 'paper',
      credential_generation: config.credential_generation,
      preview_supported: true,
    }
  }

  async resolveContract(query: { underlying: string; expiration: string; strike: string; right: 'call' | 'put' }): Promise<OptionContractIdentity> {
    const symbol = query.underlying.trim().toUpperCase()
    const expirationCompact = query.expiration.replaceAll('-', '')
    const search = asObjects(await this.get('/iserver/secdef/search', { symbol, secType: 'STK' }))
    const underliers = search.filter((item) => text(item.symbol) === symbol && text(item.opt)?.split(';').includes(expirationCompact))
    if (underliers.length !== 1) throw new Error('IBKR did not resolve one exact US option underlier and expiration.')
    const underlierConid = integer(underliers[0]!.conid)
    const month = ibkrMonth(query.expiration)
    const strikes = object(await this.get('/iserver/secdef/strikes', { conid: String(underlierConid), sectype: 'OPT', month, exchange: 'SMART' }))
    const sideStrikes = Array.isArray(strikes[query.right]) ? strikes[query.right] as unknown[] : []
    if (!sideStrikes.some((value) => decimal(value) === normalizeDecimal(query.strike))) throw new Error('IBKR did not list the exact requested option strike.')
    const contracts = asObjects(await this.get('/iserver/secdef/info', {
      conid: String(underlierConid), sectype: 'OPT', month, exchange: 'SMART',
      strike: normalizeDecimal(query.strike), right: query.right === 'call' ? 'C' : 'P',
    })).filter((item) => (
      text(item.symbol) === symbol
      && String(item.maturityDate ?? '').replaceAll('-', '') === expirationCompact
      && decimal(item.strike) === normalizeDecimal(query.strike)
      && text(item.right) === (query.right === 'call' ? 'C' : 'P')
      && text(item.currency) === 'USD'
      && decimal(item.multiplier) === '100'
      && (text(item.validExchanges) ?? '').split(',').includes('SMART')
    ))
    if (contracts.length !== 1) throw new Error('IBKR did not return one exact standard SMART option contract.')
    const found = contracts[0]!
    const conid = String(integer(found.conid))
    const rules = object(await this.get(`/iserver/contract/${conid}/info-and-rules`))
    const increments = parseIncrementRules(rules)
    const resolvedAt = this.now()
    const body = {
      contract_schema_version: OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
      canonical_id: `USOPT:${symbol}:${query.expiration}:${query.right === 'call' ? 'C' : 'P'}:${normalizeDecimal(query.strike)}`,
      underlying: symbol,
      expiration: query.expiration,
      strike: normalizeDecimal(query.strike),
      right: query.right,
      currency: 'USD' as const,
      asset_class: 'US_LISTED_OPTION' as const,
      multiplier: 100 as const,
      standard_deliverable: true as const,
      provider: 'ibkr',
      provider_instrument_id: conid,
      provider_symbol: text(found.localSymbol) ?? text(found.ticker) ?? `${symbol}-${conid}`,
      listing_eligible: true,
      smart_routing_eligible: true,
      minimum_tick: increments[0]!.increment,
      increment_bands: increments,
      resolved_at: resolvedAt,
    }
    const contract = optionContractIdentitySchema.parse({ ...body, content_checksum: sha256(body) })
    this.contracts.set(contract.canonical_id, contract)
    return contract
  }

  async quote(canonicalContractId: string): Promise<OptionQuoteSnapshot> {
    const contract = this.requireContract(canonicalContractId)
    const accounts = await this.get('/iserver/accounts')
    if (!accountIds(accounts).includes(this.config.account_id)) {
      throw new Error('IBKR session does not expose the configured paper account.')
    }
    await this.get('/iserver/marketdata/snapshot', { conids: contract.provider_instrument_id, fields: SNAPSHOT_FIELDS })
    const rows = asObjects(await this.get('/iserver/marketdata/snapshot', { conids: contract.provider_instrument_id, fields: SNAPSHOT_FIELDS }))
    const row = rows.find((item) => String(item.conid) === contract.provider_instrument_id)
    if (!row || text(row['6070']) !== 'OPT' || text(row['7184']) !== '1' || !text(row['6509'])?.startsWith('R')) {
      throw new Error('IBKR realtime option quote permission is not proven.')
    }
    const bid = decimal(row['84'])
    const ask = decimal(row['86'])
    const bidSize = integer(row['88'])
    const askSize = integer(row['85'])
    if (!bid || !ask || bidSize < 0 || askSize < 0) throw new Error('IBKR option quote is incomplete.')
    const receivedAt = this.now()
    const providerMs = integer(row._updated)
    const providerTimestamp = new Date(providerMs < 10_000_000_000 ? providerMs * 1000 : providerMs).toISOString()
    const body = {
      quote_schema_version: OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
      quote_id: `ibkr-quote-${sha256({ conid: contract.provider_instrument_id, providerTimestamp, receivedAt }).slice(0, 24)}`,
      connection_id: this.config.connection_id,
      account_id: this.config.account_id,
      canonical_contract_id: contract.canonical_id,
      provider_instrument_id: contract.provider_instrument_id,
      environment: 'paper' as const,
      market_data_mode: 'realtime' as const,
      bid, ask, bid_size: bidSize, ask_size: askSize,
      provider_timestamp: providerTimestamp,
      received_at: receivedAt,
      decision_at: receivedAt,
      quote_age_ms: 0,
      delayed: false,
      indicative: false,
      halted: false,
      minimum_tick: contract.minimum_tick,
      provenance: 'ibkr-web-api-snapshot:84,85,86,88,6070,6509,7184',
    }
    return optionQuoteSnapshotSchema.parse({ ...body, content_checksum: sha256(body) })
  }

  async preview(request: OptionsProviderOrderRequest): Promise<{ estimated_debit: string; estimated_fees: string; buying_power_impact: string }> {
    this.assertRequest(request)
    const response = object(await this.post(`/iserver/account/${encodeURIComponent(request.account_id)}/orders/whatif`, [ibkrOrder(request)]))
    const amount = object(response.amount)
    const fees = money(amount.commission)
    const debit = FixedDecimal.from(request.limit_price).multiplyInteger(100).multiplyInteger(request.quantity).toString()
    const impact = FixedDecimal.from(debit).add(fees).toString()
    const providerTotal = money(amount.total)
    if (FixedDecimal.from(providerTotal).compare(impact) !== 0) throw new Error('IBKR preview total does not match bounded debit plus commission.')
    return { estimated_debit: debit, estimated_fees: fees, buying_power_impact: impact }
  }

  async submit(request: OptionsProviderOrderRequest): Promise<OptionsProviderOrder> {
    this.assertRequest(request)
    const existing = await this.getOrderByClientId(request.account_id, request.client_order_id)
    if (existing) {
      this.assertExactOrder(existing, request)
      return existing
    }
    if (request.action === 'SELL_TO_CLOSE') {
      const snapshot = await this.snapshotAccount(request.account_id)
      const position = snapshot.positions.find((item) => item.canonical_contract_id === request.canonical_contract_id)
      const working = snapshot.orders.filter((item) => item.status === 'working' || item.status === 'partially-filled')
      if (position?.quantity !== request.quantity || snapshot.positions.length !== 1 || working.length !== 0) {
        throw new Error('IBKR close request does not match one exact unencumbered long option position.')
      }
    }
    const response = await this.post(`/iserver/account/${encodeURIComponent(request.account_id)}/orders`, [ibkrOrder(request)])
    const rows = Array.isArray(response) ? response : [response]
    const first = object(rows[0])
    if (typeof first.id === 'string' && Array.isArray(first.message)) {
      throw new Error('IBKR order requires an explicit broker reply confirmation; certification refuses automatic confirmation.')
    }
    const providerOrderId = text(first.order_id)
    if (!providerOrderId) throw new Error('IBKR order response has no exact provider order ID.')
    const exact = await this.getOrderByClientId(request.account_id, request.client_order_id)
    if (!exact || exact.provider_order_id !== providerOrderId) {
      throw new Error('IBKR accepted the order but exact provider truth is not yet available.')
    }
    return exact
  }

  async cancelOrder(accountId: string, providerOrderId: string, clientOrderId: string): Promise<OptionsProviderOrder> {
    if (accountId !== this.config.account_id || !providerOrderId || !clientOrderId) {
      throw new Error('IBKR cancel does not identify the exact configured paper order.')
    }
    const prior = await this.getOrderByClientId(accountId, clientOrderId)
    if (!prior || prior.provider_order_id !== providerOrderId) throw new Error('IBKR cancel target is not exact.')
    if (prior.status === 'canceled' || prior.status === 'partially-filled-canceled') return prior
    if (prior.status !== 'working' && prior.status !== 'partially-filled') throw new Error('IBKR order is not cancelable.')
    await this.request('DELETE', `/iserver/account/${encodeURIComponent(accountId)}/order/${encodeURIComponent(providerOrderId)}`)
    const exact = await this.getOrderByClientId(accountId, clientOrderId)
    if (!exact || exact.provider_order_id !== providerOrderId
      || (exact.status !== 'canceled' && exact.status !== 'partially-filled-canceled')) {
      throw new Error('IBKR cancel outcome is unknown until exact provider truth is available.')
    }
    return exact
  }

  async getOrderByClientId(accountId: string, clientOrderId: string): Promise<OptionsProviderOrder | null> {
    const rows = asObjects(object(await this.get('/iserver/account/orders', { force: 'true', accountId })).orders)
    const matches = rows.filter((row) => text(row.order_ref) === clientOrderId || text(row.cOID) === clientOrderId)
    if (matches.length === 0) return null
    if (matches.length !== 1) throw new Error('IBKR returned duplicate orders for one client order ID.')
    return this.normalizeOrder(matches[0]!, accountId, clientOrderId)
  }

  async snapshotAccount(accountId: string): Promise<OptionsProviderAccountSnapshot> {
    if (accountId !== this.config.account_id) throw new Error('IBKR snapshot account does not match the configured paper account.')
    const [positionsRaw, ordersRaw] = await Promise.all([
      this.get(`/portfolio/${encodeURIComponent(accountId)}/positions/0`),
      this.get('/iserver/account/orders', { force: 'true', accountId }),
    ])
    const positions = asObjects(positionsRaw).filter((row) => text(row.assetClass) === 'OPT').map((row) => {
      const conid = String(integer(row.conid))
      const contract = [...this.contracts.values()].find((item) => item.provider_instrument_id === conid)
      return {
        canonical_contract_id: contract?.canonical_id ?? `UNOWNED:${conid}`,
        quantity: integer(row.position),
        average_price: decimal(row.avgCost) ?? '0',
      }
    }).filter((position) => position.quantity !== 0)
    const orders = asObjects(object(ordersRaw).orders).flatMap((row) => {
      const securityType = text(row.secType)?.toUpperCase()
      const conid = text(row.conid)
      const knownOption = conid !== undefined
        && [...this.contracts.values()].some((item) => item.provider_instrument_id === conid)
      if (securityType && securityType !== 'OPT') return []
      if (!securityType && !knownOption) {
        if (ibkrStatusAppearsWorking(text(row.status ?? row.order_status))) {
          throw new Error('IBKR working order omitted asset-class evidence; close preflight is blocked.')
        }
        return []
      }
      return [this.normalizeOrder(row, accountId, text(row.order_ref) ?? text(row.cOID) ?? `unowned-${String(row.orderId)}`)]
    })
    return { account_id: accountId, positions, orders }
  }

  private normalizeOrder(row: Record<string, unknown>, accountId: string, clientOrderId: string): OptionsProviderOrder {
    const conid = String(integer(row.conid))
    const contract = [...this.contracts.values()].find((item) => item.provider_instrument_id === conid)
    const quantity = integer(row.totalSize ?? row.quantity)
    const filled = integer(row.filledQuantity ?? row.filled)
    const limitPrice = decimal(row.price ?? row.limitPrice)
    const providerOrderId = text(row.orderId ?? row.order_id)
    const side = text(row.side)?.toUpperCase()
    const orderType = text(row.orderType ?? row.order_type)?.toUpperCase()
    const tif = text(row.tif)?.toUpperCase()
    if (!limitPrice || !providerOrderId || (side !== 'BUY' && side !== 'SELL') || orderType !== 'LMT' || tif !== 'DAY') {
      throw new Error('IBKR order truth is incomplete or outside the certified long-call/put scope.')
    }
    const averageFillPrice = filled > 0 ? decimal(row.avgPrice ?? row.avg_fill_price) : undefined
    if (filled > 0 && !averageFillPrice) throw new Error('IBKR filled order omitted its exact average fill price.')
    return {
      account_id: accountId,
      canonical_contract_id: contract?.canonical_id ?? `UNOWNED:${conid}`,
      provider_instrument_id: conid,
      action: side === 'BUY' ? 'BUY_TO_OPEN' : 'SELL_TO_CLOSE', order_type: 'limit',
      limit_price: limitPrice,
      quantity, time_in_force: 'day', regular_hours_only: true,
      client_order_id: clientOrderId,
      provider_order_id: providerOrderId,
      status: normalizeIbkrStatus(text(row.status ?? row.order_status), filled, quantity),
      filled_quantity: filled,
      ...(averageFillPrice ? { average_fill_price: averageFillPrice } : {}),
    }
  }

  private assertRequest(request: OptionsProviderOrderRequest): void {
    const contract = this.contracts.get(request.canonical_contract_id)
    if (request.account_id !== this.config.account_id || !contract
      || contract.provider_instrument_id !== request.provider_instrument_id
      || (request.action !== 'BUY_TO_OPEN' && request.action !== 'SELL_TO_CLOSE') || request.order_type !== 'limit' || request.time_in_force !== 'day'
      || request.regular_hours_only !== true || request.quantity !== 1
      || !/^tg(?:opt|cert)-[a-z0-9-]+$/i.test(request.client_order_id) || request.client_order_id.length > 32
      || !isOptionPriceOnTick(contract, request.limit_price)) {
      throw new Error('IBKR request exceeds the certified single-leg paper scope.')
    }
  }

  private assertExactOrder(order: OptionsProviderOrder, request: OptionsProviderOrderRequest): void {
    if (order.account_id !== request.account_id
      || order.canonical_contract_id !== request.canonical_contract_id
      || order.provider_instrument_id !== request.provider_instrument_id
      || order.action !== request.action
      || order.order_type !== request.order_type
      || FixedDecimal.from(order.limit_price).compare(request.limit_price) !== 0
      || order.quantity !== request.quantity
      || order.time_in_force !== request.time_in_force
      || order.regular_hours_only !== request.regular_hours_only
      || order.client_order_id !== request.client_order_id) {
      throw new Error('IBKR client order ID was reused with different economics.')
    }
  }

  private requireContract(id: string): OptionContractIdentity {
    const contract = this.contracts.get(id)
    if (!contract) throw new Error('Exact IBKR option contract is not registered in this adapter session.')
    return contract
  }

  private get(pathname: string, query: Record<string, string> = {}): Promise<unknown> { return this.request('GET', pathname, undefined, query) }
  private post(pathname: string, body: unknown): Promise<unknown> { return this.request('POST', pathname, body) }
  private async request(method: string, pathname: string, body?: unknown, query: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${IBKR_ENDPOINT}${pathname}`)
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value))
    const response = await (this.config.fetch ?? fetch)(url.toString(), {
      method,
      headers: { Authorization: `Bearer ${this.config.access_token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`IBKR paper API failed with HTTP ${response.status}.`)
    return response.json()
  }

  private now(): string { return (this.config.now ?? (() => new Date().toISOString()))() }
}

const ibkrOrder = (request: OptionsProviderOrderRequest) => ({
  conid: Number(request.provider_instrument_id), side: request.action === 'BUY_TO_OPEN' ? 'BUY' : 'SELL', orderType: 'LMT', price: Number(request.limit_price),
  quantity: request.quantity, tif: 'DAY', outsideRTH: false, cOID: request.client_order_id, referrer: 'TradeGodOptions',
})
const ibkrMonth = (date: string): string => `${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(date.slice(5, 7)) - 1]}${date.slice(2, 4)}`
const normalizeDecimal = (value: string): string => FixedDecimal.from(value).toString()
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const asObjects = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []
const accountIds = (value: unknown): string[] => Array.isArray(value)
  ? value.map((item) => typeof item === 'string' ? item : text(object(item).accountId ?? object(item).id)).filter((item): item is string => Boolean(item))
  : []
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined
const integer = (value: unknown): number => { const parsed = Number(text(value)); if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('IBKR returned an invalid integer field.'); return parsed }
const decimal = (value: unknown): string | undefined => { const parsed = text(value)?.replace(/[^0-9.-]/g, ''); if (!parsed || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(parsed)) return undefined; return normalizeDecimal(parsed) }
const money = (value: unknown): string => { const parsed = decimal(value); if (!parsed) throw new Error('IBKR preview omitted exact monetary evidence.'); return parsed }
const parseIncrementRules = (rules: Record<string, unknown>): Array<{ minimum_price: string; increment: string }> => {
  const raw = Array.isArray(rules.increment_rules) ? rules.increment_rules : Array.isArray(rules.incrementRules) ? rules.incrementRules : []
  const parsed = raw.map((value) => object(value)).map((rule) => ({ minimum_price: decimal(rule.lowerEdge ?? rule.minimum_price) ?? '', increment: decimal(rule.increment) ?? '' }))
    .filter((rule) => rule.minimum_price && rule.increment).sort((a, b) => FixedDecimal.from(a.minimum_price).compare(b.minimum_price))
  if (parsed.length === 0 || parsed[0]!.minimum_price !== '0') throw new Error('IBKR option tick rules are unavailable.')
  return parsed
}
const normalizeIbkrStatus = (status?: string, filled = 0, quantity = 1): OptionsProviderOrder['status'] => {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('cancel')) return filled > 0 ? 'partially-filled-canceled' : 'canceled'
  if (filled >= quantity) return 'filled'
  if (filled > 0) return 'partially-filled'
  if (['submitted', 'presubmitted', 'pending submit', 'working'].some((value) => normalized.includes(value))) return 'working'
  throw new Error(`IBKR returned an unsupported order status: ${status ?? 'missing'}.`)
}
const ibkrStatusAppearsWorking = (status?: string): boolean => {
  const normalized = status?.toLowerCase() ?? ''
  return ['submitted', 'presubmitted', 'pending submit', 'working', 'pending cancel'].some((value) => normalized.includes(value))
}
