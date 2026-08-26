import { describe, expect, it } from 'bun:test'

import { WebullOptionsAdapter, webullOrderBody } from '../src/options/webull-options-adapter.ts'

const now = '2026-08-26T15:00:00.000Z'
const contractRow = {
  symbol: 'SPY', option_expire_date: '2026-09-18', strike_price: '650.00', option_type: 'CALL',
  market: 'US', currency: 'USD', multiplier: '100', status: 'ACTIVE', instrument_id: 'webull-opt-991',
  option_symbol: 'SPY260918C00650000', tick_size: '0.01', tick_rule_type: 'CONSTANT',
}

describe('WebullOptionsAdapter', () => {
  it('signs only official sandbox requests and resolves exact contract plus realtime OPRA quote', async () => {
    const requests: Array<{ url: URL; headers: Headers }> = []
    const adapter = makeAdapter(async (input, init) => {
      const url = new URL(input)
      requests.push({ url, headers: new Headers(init?.headers) })
      const response = url.pathname.endsWith('/contracts/list')
        ? [contractRow]
        : [{ instrument_id: 'webull-opt-991', symbol: 'SPY260918C00650000', market_data_type: 'REALTIME', is_delayed: false, bid_price: '1.27', ask_price: '1.30', bid_size: '30', ask_size: '22', quote_time: 1787756400000, halted: false }]
      return ok(response)
    })
    const contract = await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    const quote = await adapter.quote(contract.canonical_id)
    expect(contract).toMatchObject({ provider: 'webull', provider_instrument_id: 'webull-opt-991', minimum_tick: '0.01' })
    expect(quote).toMatchObject({ environment: 'sandbox', market_data_mode: 'realtime', bid: '1.27', ask: '1.30', bid_size: 30, ask_size: 22 })
    expect(requests.every(({ url }) => url.origin === 'https://api.sandbox.webull.com')).toBe(true)
    expect(requests.every(({ headers }) => headers.get('x-signature') && headers.get('x-app-key') === 'app-key-123')).toBe(true)
  })

  it('builds the current exact one-leg preview body but refuses all order mutation', async () => {
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
    await expect(adapter.submit(order)).rejects.toThrow('submission is blocked')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toEqual({
      account_id: 'sandbox-account-1',
      new_orders: [{
        client_order_id: 'tgcert-webull-1', combo_type: 'NORMAL', order_type: 'LIMIT', limit_price: '1.30', quantity: '1',
        option_strategy: 'SINGLE', side: 'BUY', time_in_force: 'DAY', entrust_type: 'QTY', instrument_type: 'OPTION', market: 'US', symbol: 'SPY',
        legs: [{ side: 'BUY', quantity: '1', symbol: 'SPY', strike_price: '650', option_expire_date: '2026-09-18', instrument_type: 'OPTION', option_type: 'CALL', market: 'US' }],
      }],
    })
  })

  it('rejects delayed quotes and client-order IDs beyond the provider limit', async () => {
    let orderMode = false
    const adapter = makeAdapter(async (input) => {
      const url = new URL(input)
      if (!orderMode || url.pathname.endsWith('/contracts/list')) return ok([contractRow])
      return ok([{ instrument_id: 'webull-opt-991', symbol: 'SPY260918C00650000', market_data_type: 'DELAYED', is_delayed: true }])
    })
    const contract = await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    orderMode = true
    await expect(adapter.quote(contract.canonical_id)).rejects.toThrow('realtime non-display')
    await expect(adapter.preview({ ...request(), client_order_id: `tgcert-${'a'.repeat(40)}` })).rejects.toThrow('exceeds the certified')
    await expect(adapter.snapshotAccount('sandbox-account-1')).rejects.toThrow('open-order list may lag')
  })
})

const request = () => ({
  account_id: 'sandbox-account-1', canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', provider_instrument_id: 'webull-opt-991',
  action: 'BUY_TO_OPEN' as const, order_type: 'limit' as const, limit_price: '1.30', quantity: 1,
  time_in_force: 'day' as const, regular_hours_only: true as const, client_order_id: 'tgcert-webull-1',
})
const makeAdapter = (fetch: NonNullable<ConstructorParameters<typeof WebullOptionsAdapter>[0]['fetch']>) => new WebullOptionsAdapter({
  connection_id: 'webull-one', account_id: 'sandbox-account-1', app_key: 'app-key-123', app_secret: 'app-secret-value-123456',
  credential_generation: 'b'.repeat(64), now: () => now, nonce: () => 'nonce-one', fetch,
})
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => value })
