import { describe, expect, it } from 'bun:test'

import { WebullOptionsAdapter, webullOrderBody } from '../src/options/webull-options-adapter.ts'
import type { WebullTradeEventSubscription, WebullTradeEventTransport } from '../src/options/webull-trade-event-stream.ts'

const now = '2026-08-26T15:00:00.000Z'
const contractRow = {
  symbol: 'SPY260918C00650000', underlying_symbol: 'SPY', expiration_date: '2026-09-18',
  strike_price: '650.00', option_type: 'CALL', currency: 'USD', multiplier: '100', status: 'LISTING',
  tradable_status: 'OC', def_type: 'STANDARD', settlement_method: 'PHYSICAL', ppind: true,
  instrument_id: 'webull-opt-991',
}

describe('WebullOptionsAdapter', () => {
  it('signs only official sandbox requests and resolves exact contract plus realtime OPRA quote', async () => {
    const requests: Array<{ url: URL; headers: Headers }> = []
    const adapter = makeAdapter(async (input, init) => {
      const url = new URL(input)
      requests.push({ url, headers: new Headers(init?.headers) })
      const response = url.pathname.endsWith('/contracts/list')
        ? [contractRow]
        : [{ instrument_id: 'webull-opt-991', symbol: 'SPY260918C00650000', bid: '4.07', ask: '4.11', bid_size: '30', ask_size: '22', quote_time: 1787756400000 }]
      return ok(response)
    })
    const contract = await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    const quote = await adapter.quote(contract.canonical_id)
    expect(contract).toMatchObject({ provider: 'webull', provider_instrument_id: 'webull-opt-991', minimum_tick: '0.01' })
    expect(quote).toMatchObject({ environment: 'sandbox', market_data_mode: 'realtime', bid: '4.07', ask: '4.11', bid_size: 30, ask_size: 22, minimum_tick: '0.01' })
    expect(requests[0]?.url.searchParams.get('category')).toBe('US_OPTION')
    expect(requests[0]?.url.searchParams.get('underlying_symbols')).toBe('SPY')
    expect(requests[0]?.url.searchParams.get('start_date')).toBe('2026-09-18')
    expect(requests[1]?.url.searchParams.get('category')).toBe('US_OPTION')
    expect(requests.every(({ url }) => url.origin === 'https://api.sandbox.webull.com')).toBe(true)
    expect(requests.every(({ headers }) => headers.get('x-signature') && headers.get('x-app-key') === 'app-key-123')).toBe(true)
  })

  it('accepts exact Webull decimals padded beyond the internal six-place scale', async () => {
    const adapter = makeAdapter(async () => ok([{
      ...contractRow,
      strike_price: '650.00000000',
      multiplier: '100.00000000',
    }]))

    const contract = await adapter.resolveContract({
      underlying: 'SPY',
      expiration: '2026-09-18',
      strike: '650',
      right: 'call',
    })

    expect(contract).toMatchObject({ strike: '650', multiplier: 100 })
  })

  it('still rejects Webull decimals with meaningful precision beyond six places', async () => {
    const adapter = makeAdapter(async () => ok([{
      ...contractRow,
      strike_price: '650.00000001',
    }]))

    await expect(adapter.resolveContract({
      underlying: 'SPY',
      expiration: '2026-09-18',
      strike: '650',
      right: 'call',
    })).rejects.toThrow('Decimal precision exceeds 6 places')
  })

  it('builds the exact one-leg preview body with opening intent', async () => {
    const bodies: unknown[] = []
    let orderMode = false
    const adapter = makeAdapter(async (input, init) => {
      const url = new URL(input)
      if (init?.body) bodies.push(JSON.parse(String(init.body)))
      if (!orderMode) return ok([contractRow])
      if (url.pathname.endsWith('/preview')) return ok({ estimated_fees: '0.65', buying_power_impact: '130.65' })
      throw new Error('Unexpected provider mutation')
    })
    const contract = await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    orderMode = true
    const order = request()
    expect(await adapter.preview(order)).toEqual({ estimated_debit: '130.00', estimated_fees: '0.65', buying_power_impact: '130.65' })
    expect(bodies[0]).toEqual(webullOrderBody(order, contract))
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({
      account_id: 'sandbox-account-1',
      new_orders: [{
        client_order_id: 'tgcert-webull-1', combo_type: 'NORMAL', order_type: 'LIMIT', limit_price: '1.30', quantity: '1',
        option_strategy: 'SINGLE', side: 'BUY', position_intent: 'BUY_TO_OPEN', time_in_force: 'DAY', entrust_type: 'QTY', instrument_type: 'OPTION', market: 'US', symbol: 'SPY',
        legs: [{ side: 'BUY', position_intent: 'BUY_TO_OPEN', quantity: '1', symbol: 'SPY', strike_price: '650', option_expire_date: '2026-09-18', instrument_type: 'OPTION', option_type: 'CALL', market: 'US' }],
      }],
    })
  })

  it('places, deduplicates, cancels, snapshots, and sells to close only from exact sandbox truth', async () => {
    const orders = new Map<string, Record<string, unknown>>()
    let position = 0
    let orderCounter = 0
    const adapter = makeAdapter(async (input, init) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/contracts/list')) return ok([contractRow])
      if (url.pathname.endsWith('/orders/place')) {
        const body = JSON.parse(String(init?.body)) as { new_orders: Array<Record<string, unknown>> }
        const submitted = body.new_orders[0]!
        const id = `order-${++orderCounter}`
        const passive = submitted.limit_price === '0.01'
        const side = String(submitted.side)
        const row = {
          ...submitted, order_id: id, instrument_id: 'webull-opt-991', status: passive ? 'WORKING' : 'FILLED',
          filled_quantity: passive ? '0' : '1', average_fill_price: passive ? undefined : submitted.limit_price,
        }
        orders.set(String(submitted.client_order_id), row)
        if (!passive) position += side === 'BUY' ? 1 : -1
        return ok({ order_id: id })
      }
      if (url.pathname.endsWith('/orders/cancel')) {
        const body = JSON.parse(String(init?.body)) as { client_order_id: string }
        orders.get(body.client_order_id)!.status = 'CANCELED'
        return ok({ success: true })
      }
      if (url.pathname.endsWith('/orders/get')) {
        const row = orders.get(url.searchParams.get('client_order_id') ?? '')
        return ok(row ? row : {})
      }
      if (url.pathname.endsWith('/assets/positions/list')) return ok(position ? [{ instrument_id: 'webull-opt-991', instrument_type: 'OPTION', quantity: String(position), average_price: '1.30' }] : [])
      if (url.pathname.endsWith('/orders/open-orders/list')) return ok([...orders.values()].filter((row) => row.status === 'WORKING'))
      throw new Error(`Unexpected ${url.pathname}`)
    })
    await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    const passive = { ...request(), limit_price: '0.01' }
    const working = await adapter.submit(passive)
    expect(working.status).toBe('working')
    expect((await adapter.submit(passive)).provider_order_id).toBe(working.provider_order_id)
    expect((await adapter.snapshotAccount('sandbox-account-1')).orders).toHaveLength(1)
    expect((await adapter.cancelOrder('sandbox-account-1', working.provider_order_id, working.client_order_id)).status).toBe('canceled')
    const entry = await adapter.submit({ ...request(), client_order_id: 'tgcert-webull-entry' })
    expect(entry.status).toBe('filled')
    expect((await adapter.snapshotAccount('sandbox-account-1')).positions[0]?.quantity).toBe(1)
    const close = await adapter.submit({ ...request(), action: 'SELL_TO_CLOSE', client_order_id: 'tgcert-webull-close' })
    expect(close).toMatchObject({ action: 'SELL_TO_CLOSE', status: 'filled' })
    expect((await adapter.snapshotAccount('sandbox-account-1')).positions).toHaveLength(0)
  })

  it('rejects stale quotes and client-order IDs beyond the provider limit', async () => {
    let orderMode = false
    const adapter = makeAdapter(async (input) => {
      const url = new URL(input)
      if (!orderMode || url.pathname.endsWith('/contracts/list')) return ok([contractRow])
      return ok([{ instrument_id: 'webull-opt-991', symbol: 'SPY260918C00650000', bid: '1.27', ask: '1.30', bid_size: '2', ask_size: '2', quote_time: 1 }])
    })
    const contract = await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    orderMode = true
    await expect(adapter.quote(contract.canonical_id)).rejects.toThrow('quote is 1787756399999 ms old (maximum 1000 ms)')
    await expect(adapter.preview({ ...request(), client_order_id: `tgcert-${'a'.repeat(40)}` })).rejects.toThrow('exceeds the certified')
  })
})

const request = () => ({
  account_id: 'sandbox-account-1', canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', provider_instrument_id: 'webull-opt-991',
  action: 'BUY_TO_OPEN' as const, order_type: 'limit' as const, limit_price: '1.30', quantity: 1,
  time_in_force: 'day' as const, regular_hours_only: true as const, client_order_id: 'tgcert-webull-1',
})
const makeAdapter = (fetch: NonNullable<ConstructorParameters<typeof WebullOptionsAdapter>[0]['fetch']>) => new WebullOptionsAdapter({
  connection_id: 'webull-one', account_id: 'sandbox-account-1', app_key: 'app-key-123', app_secret: 'app-secret-value-123456',
  credential_generation: 'b'.repeat(64), now: () => now, nonce: () => 'nonce-one', fetch, event_transport: eventTransport(),
})
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value })

const eventTransport = (): WebullTradeEventTransport => ({
  subscribe: () => {
    const listeners = new Map<string, Array<(value?: unknown) => void>>()
    const stream: WebullTradeEventSubscription = {
      on: (event, listener) => { const values = listeners.get(event) ?? []; values.push(listener as (value?: unknown) => void); listeners.set(event, values) },
      cancel: () => undefined,
    }
    queueMicrotask(() => listeners.get('data')?.forEach((listener) => listener({ eventType: 0, subscribeType: 1, contentType: '', payload: '', requestId: 'ok', timestamp: 1 })))
    return stream
  },
  close: () => undefined,
})
