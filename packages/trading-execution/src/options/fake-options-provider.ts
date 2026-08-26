import {
  OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
  OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
  optionContractIdentitySchema,
  optionQuoteSnapshotSchema,
  type OptionContractIdentity,
  type OptionQuoteSnapshot,
} from '@trade-god/contracts'

import { FixedDecimal } from './fixed-decimal.ts'
import { isOptionPriceOnTick } from './option-tick.ts'

const CHECKSUM_A = 'a'.repeat(64)
const CHECKSUM_B = 'b'.repeat(64)
const FIXTURE_NOW = '2026-08-26T15:00:00.000Z'

export type FakeOptionsOrderRequest = {
  account_id: string
  canonical_contract_id: string
  provider_instrument_id: string
  action: 'BUY_TO_OPEN'
  limit_price: string
  quantity: number
  client_order_id: string
}

export type FakeOptionsOrderStatus =
  | 'working'
  | 'partially-filled'
  | 'filled'
  | 'canceled'
  | 'partially-filled-canceled'

export type FakeOptionsOrder = FakeOptionsOrderRequest & {
  provider_order_id: string
  status: FakeOptionsOrderStatus
  filled_quantity: number
  average_fill_price?: string
}

export type FakeOptionsAccountSnapshot = {
  account_id: string
  positions: Array<{ canonical_contract_id: string; quantity: number; average_price: string }>
  orders: FakeOptionsOrder[]
}

export class FakeOptionsProviderError extends Error {
  constructor(
    public readonly code: 'OPTIONS_CONTRACT_NOT_FOUND' | 'OPTIONS_CONTRACT_AMBIGUOUS' | 'OPTIONS_PROVIDER_DIVERGENCE',
    message: string,
  ) {
    super(message)
    this.name = 'FakeOptionsProviderError'
  }
}

function requestFingerprint(request: FakeOptionsOrderRequest): string {
  return JSON.stringify([
    request.account_id,
    request.canonical_contract_id,
    request.provider_instrument_id,
    request.action,
    request.limit_price,
    request.quantity,
    request.client_order_id,
  ])
}

function cloneOrder(order: FakeOptionsOrder): FakeOptionsOrder {
  return { ...order }
}

export class FakeOptionsProvider {
  readonly contracts: OptionContractIdentity[] = []
  mutationCount = 0

  private readonly quotes = new Map<string, OptionQuoteSnapshot>()
  private readonly orders = new Map<string, FakeOptionsOrder>()
  private readonly clientOrders = new Map<string, { fingerprint: string; providerOrderId: string }>()
  private orderSequence = 0

  static paperFixture(): FakeOptionsProvider {
    const provider = new FakeOptionsProvider()
    const contract = optionContractIdentitySchema.parse({
      contract_schema_version: OPTION_CONTRACT_IDENTITY_SCHEMA_VERSION,
      canonical_id: 'USOPT:SPY:2026-09-18:C:650',
      underlying: 'SPY',
      expiration: '2026-09-18',
      strike: '650',
      right: 'call',
      currency: 'USD',
      asset_class: 'US_ETF_OPTION',
      multiplier: 100,
      standard_deliverable: true,
      provider: 'fake-options',
      provider_instrument_id: 'fake-spy-20260918-c-650',
      provider_symbol: 'SPY260918C00650000',
      listing_eligible: true,
      smart_routing_eligible: true,
      minimum_tick: '0.01',
      increment_bands: [{ minimum_price: '0', increment: '0.01' }],
      resolved_at: FIXTURE_NOW,
      content_checksum: CHECKSUM_A,
    })
    provider.addContract(contract)
    provider.quotes.set(contract.canonical_id, optionQuoteSnapshotSchema.parse({
      quote_schema_version: OPTION_QUOTE_SNAPSHOT_SCHEMA_VERSION,
      quote_id: 'fake-quote-spy-1',
      connection_id: 'connection-options-paper',
      account_id: 'account-options-paper',
      canonical_contract_id: contract.canonical_id,
      provider_instrument_id: contract.provider_instrument_id,
      environment: 'paper',
      market_data_mode: 'realtime',
      bid: '1.27',
      ask: '1.30',
      bid_size: 30,
      ask_size: 22,
      provider_timestamp: FIXTURE_NOW,
      received_at: '2026-08-26T15:00:00.100Z',
      decision_at: '2026-08-26T15:00:00.150Z',
      quote_age_ms: 50,
      delayed: false,
      indicative: false,
      halted: false,
      minimum_tick: '0.01',
      provenance: 'fake-options:fixture-v1',
      content_checksum: CHECKSUM_B,
    }))
    return provider
  }

  addContract(contract: OptionContractIdentity): void {
    this.contracts.push(optionContractIdentitySchema.parse(contract))
  }

  async resolveContract(query: {
    underlying: string
    expiration: string
    strike: string
    right: 'call' | 'put'
  }): Promise<OptionContractIdentity> {
    const matches = this.contracts.filter((candidate) => (
      candidate.underlying === query.underlying
      && candidate.expiration === query.expiration
      && candidate.strike === query.strike
      && candidate.right === query.right
    ))
    if (matches.length === 0) {
      throw new FakeOptionsProviderError('OPTIONS_CONTRACT_NOT_FOUND', 'No exact option contract matched')
    }
    if (matches.length !== 1) {
      throw new FakeOptionsProviderError('OPTIONS_CONTRACT_AMBIGUOUS', 'More than one option contract matched')
    }
    return { ...matches[0]! }
  }

  async quote(canonicalContractId: string): Promise<OptionQuoteSnapshot> {
    const quote = this.quotes.get(canonicalContractId)
    if (!quote) throw new FakeOptionsProviderError('OPTIONS_CONTRACT_NOT_FOUND', 'No quote exists for the exact contract')
    return { ...quote }
  }

  async preview(request: FakeOptionsOrderRequest): Promise<{
    estimated_debit: string
    estimated_fees: string
    buying_power_impact: string
  }> {
    this.assertRequestContract(request)
    const estimatedDebit = FixedDecimal.from(request.limit_price).multiplyInteger(100).multiplyInteger(request.quantity)
    const estimatedFees = FixedDecimal.from('0.65').multiplyInteger(request.quantity)
    return {
      estimated_debit: estimatedDebit.toString(),
      estimated_fees: estimatedFees.toString(),
      buying_power_impact: estimatedDebit.add(estimatedFees).toString(),
    }
  }

  async submit(request: FakeOptionsOrderRequest): Promise<FakeOptionsOrder> {
    this.assertRequestContract(request)
    const fingerprint = requestFingerprint(request)
    const existing = this.clientOrders.get(request.client_order_id)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Client order ID was reused with different economics')
      }
      return cloneOrder(this.orders.get(existing.providerOrderId)!)
    }

    this.orderSequence += 1
    const providerOrderId = `fake-options-order-${this.orderSequence}`
    const order: FakeOptionsOrder = {
      ...request,
      provider_order_id: providerOrderId,
      status: 'working',
      filled_quantity: 0,
    }
    this.orders.set(providerOrderId, order)
    this.clientOrders.set(request.client_order_id, { fingerprint, providerOrderId })
    this.mutationCount += 1
    return cloneOrder(order)
  }

  async fill(providerOrderId: string, quantity: number, price: string): Promise<FakeOptionsOrder> {
    const order = this.requireOrder(providerOrderId)
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > order.quantity - order.filled_quantity) {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Fill quantity exceeds the working remainder')
    }
    if (FixedDecimal.from(price).compare('0') <= 0) {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Fill price must be positive')
    }
    if (order.status !== 'working' && order.status !== 'partially-filled') {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Order cannot fill from its current state')
    }
    const priorDebit = order.average_fill_price === undefined
      ? FixedDecimal.from('0')
      : FixedDecimal.from(order.average_fill_price).multiplyInteger(order.filled_quantity)
    const totalQuantity = order.filled_quantity + quantity
    const totalDebit = priorDebit.add(FixedDecimal.from(price).multiplyInteger(quantity))
    const average = divideExact(totalDebit, totalQuantity, 6)
    order.filled_quantity = totalQuantity
    order.average_fill_price = average
    order.status = totalQuantity === order.quantity ? 'filled' : 'partially-filled'
    this.mutationCount += 1
    return cloneOrder(order)
  }

  async cancel(providerOrderId: string): Promise<FakeOptionsOrder> {
    const order = this.requireOrder(providerOrderId)
    if (order.status !== 'working' && order.status !== 'partially-filled') {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Order is not cancelable')
    }
    order.status = order.filled_quantity > 0 ? 'partially-filled-canceled' : 'canceled'
    this.mutationCount += 1
    return cloneOrder(order)
  }

  async snapshotAccount(accountId: string): Promise<FakeOptionsAccountSnapshot> {
    const accountOrders = [...this.orders.values()].filter((order) => order.account_id === accountId)
    const positions = new Map<string, { quantity: number; debit: FixedDecimal }>()
    for (const order of accountOrders) {
      if (order.filled_quantity === 0 || order.average_fill_price === undefined) continue
      const current = positions.get(order.canonical_contract_id) ?? { quantity: 0, debit: FixedDecimal.from('0') }
      current.quantity += order.filled_quantity
      current.debit = current.debit.add(FixedDecimal.from(order.average_fill_price).multiplyInteger(order.filled_quantity))
      positions.set(order.canonical_contract_id, current)
    }
    return {
      account_id: accountId,
      positions: [...positions.entries()].map(([canonical_contract_id, position]) => ({
        canonical_contract_id,
        quantity: position.quantity,
        average_price: divideExact(position.debit, position.quantity, 6),
      })),
      orders: accountOrders.map(cloneOrder),
    }
  }

  private assertRequestContract(request: FakeOptionsOrderRequest): void {
    if (!Number.isSafeInteger(request.quantity) || request.quantity <= 0) {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Quantity must be a positive integer')
    }
    if (FixedDecimal.from(request.limit_price).compare('0') <= 0) {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Limit price must be positive')
    }
    const contract = this.contracts.find((candidate) => candidate.canonical_id === request.canonical_contract_id)
    if (!contract || contract.provider_instrument_id !== request.provider_instrument_id) {
      throw new FakeOptionsProviderError('OPTIONS_CONTRACT_NOT_FOUND', 'Order does not identify an exact known contract')
    }
    if (!isOptionPriceOnTick(contract, request.limit_price)) {
      throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Limit price is not on the provider tick')
    }
  }

  private requireOrder(providerOrderId: string): FakeOptionsOrder {
    const order = this.orders.get(providerOrderId)
    if (!order) throw new FakeOptionsProviderError('OPTIONS_PROVIDER_DIVERGENCE', 'Unknown provider order ID')
    return order
  }
}

function divideExact(value: FixedDecimal, divisor: number, precision: number): string {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new Error('Divisor must be a positive safe integer')
  const raw = value.toString()
  const [whole, fraction = ''] = raw.split('.')
  const scaled = BigInt(`${whole}${fraction.padEnd(6, '0')}`)
  const quotient = scaled / BigInt(divisor)
  const quotientString = quotient.toString().padStart(7, '0')
  const result = `${quotientString.slice(0, -6)}.${quotientString.slice(-6)}`
  const rounded = FixedDecimal.from(result).roundDownToTick(`0.${'0'.repeat(precision - 1)}1`).toString()
  const canonical = rounded.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1')
  if (!canonical.includes('.')) return `${canonical}.00`
  if (canonical.split('.')[1]!.length === 1) return `${canonical}0`
  return canonical
}
