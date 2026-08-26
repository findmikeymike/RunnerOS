import { describe, expect, it } from 'bun:test'

import { IbkrOptionsAdapter } from '../src/options/ibkr-options-adapter.ts'

const now = '2026-08-26T15:00:00.000Z'

describe('IbkrOptionsAdapter', () => {
  it('resolves one exact standard option and accepts only a realtime top-of-book quote', async () => {
    const requests: Array<{ method: string; url: URL }> = []
    const adapter = new IbkrOptionsAdapter({
      connection_id: 'ibkr-one', account_id: 'DU1234567', access_token: 'secret-token', credential_generation: 'a'.repeat(64), now: () => now,
      fetch: async (input, init) => {
        const url = new URL(input); requests.push({ method: init?.method ?? 'GET', url })
        const response = url.pathname.endsWith('/secdef/search')
          ? [{ conid: 756733, symbol: 'SPY', opt: '20260918' }]
          : url.pathname.endsWith('/secdef/strikes')
            ? { call: [650], put: [650] }
            : url.pathname.endsWith('/secdef/info')
              ? [{ conid: 999001, symbol: 'SPY', maturityDate: '20260918', strike: 650, right: 'C', currency: 'USD', multiplier: '100', validExchanges: 'SMART,CBOE', localSymbol: 'SPY   260918C00650000' }]
              : url.pathname.endsWith('/info-and-rules')
                ? { increment_rules: [{ lowerEdge: 0, increment: 0.01 }] }
                : url.pathname.endsWith('/accounts') ? ['DU1234567']
                  : [{ conid: 999001, '6070': 'OPT', '7184': '1', '6509': 'RpB', '84': '1.27', '85': 22, '86': '1.30', '88': 30, _updated: 1787756400000 }]
        return { ok: true, status: 200, json: async () => response }
      },
    })
    const contract = await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
    const quote = await adapter.quote(contract.canonical_id)
    expect(contract.provider_instrument_id).toBe('999001')
    expect(contract.minimum_tick).toBe('0.01')
    expect(quote).toMatchObject({ bid: '1.27', ask: '1.30', bid_size: 30, ask_size: 22, market_data_mode: 'realtime' })
    expect(requests.every(({ url }) => url.origin === 'https://api.ibkr.com')).toBe(true)
  })

  it('builds a bounded what-if request and refuses broker reply auto-confirmation', async () => {
    const bodies: unknown[] = []
    const adapter = await preparedAdapter(async (input, init) => {
      const url = new URL(input)
      if (init?.body) bodies.push(JSON.parse(String(init.body)))
      const response = url.pathname.endsWith('/orders/whatif')
        ? { amount: { commission: '0.65 USD', total: '130.65 USD' } }
        : [{ id: 'reply-one', message: ['Confirm price'], messageIds: ['o163'] }]
      return { ok: true, status: 200, json: async () => response }
    })
    const request = {
      account_id: 'DU1234567', canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', provider_instrument_id: '999001',
      action: 'BUY_TO_OPEN' as const, order_type: 'limit' as const, limit_price: '1.30', quantity: 1,
      time_in_force: 'day' as const, regular_hours_only: true as const, client_order_id: 'tgcert-ibkr-1',
    }
    expect(await adapter.preview(request)).toEqual({ estimated_debit: '130.00', estimated_fees: '0.65', buying_power_impact: '130.65' })
    await expect(adapter.submit(request)).rejects.toThrow('refuses automatic confirmation')
    expect(bodies[0]).toEqual([{ conid: 999001, side: 'BUY', orderType: 'LMT', price: 1.3, quantity: 1, tif: 'DAY', outsideRTH: false, cOID: 'tgcert-ibkr-1', referrer: 'TradeGodOptions' }])
  })

  it('returns only exact order truth re-read after a successful submission', async () => {
    const adapter = await preparedAdapter(async (input) => {
      const url = new URL(input)
      const response = url.pathname.endsWith('/account/orders')
        ? { orders: [{ conid: 999001, order_ref: 'tgcert-ibkr-2', orderId: 4488, side: 'BUY', orderType: 'LMT', price: 1.3, totalSize: 1, filledQuantity: 1, avgPrice: 1.29, tif: 'DAY', status: 'Filled' }] }
        : [{ order_id: '4488', order_status: 'Submitted' }]
      return { ok: true, status: 200, json: async () => response }
    })
    const order = await adapter.submit(request('tgcert-ibkr-2'))
    expect(order).toMatchObject({ provider_order_id: '4488', status: 'filled', filled_quantity: 1, average_fill_price: '1.29' })
  })

  it('fails closed on incomplete provider order truth and off-tick requests', async () => {
    const adapter = await preparedAdapter(async (input) => {
      const url = new URL(input)
      const response = url.pathname.endsWith('/account/orders')
        ? { orders: [{ conid: 999001, order_ref: 'tgcert-ibkr-3', orderId: 4489, side: 'BUY', orderType: 'LMT', totalSize: 1, filledQuantity: 0, tif: 'DAY', status: 'Submitted' }] }
        : [{ order_id: '4489', order_status: 'Submitted' }]
      return { ok: true, status: 200, json: async () => response }
    })
    await expect(adapter.submit(request('tgcert-ibkr-3'))).rejects.toThrow('truth is incomplete')
    await expect(adapter.preview({ ...request('tgcert-ibkr-4'), limit_price: '1.305' })).rejects.toThrow('exceeds the certified')
  })

  it('suppresses duplicate delivery and proves an exact cancellation', async () => {
    let orderReads = 0
    let submits = 0
    let cancels = 0
    const adapter = await preparedAdapter(async (input, init) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/account/orders')) {
        orderReads += 1
        if (orderReads === 1) return response({ orders: [] })
        const canceled = orderReads >= 5
        return response({ orders: [ibkrOrderRow('tgcert-idem', 4490, canceled ? 'Cancelled' : 'Submitted')] })
      }
      if (init?.method === 'DELETE') { cancels += 1; return response({ order_id: '4490' }) }
      submits += 1
      return response([{ order_id: '4490', order_status: 'Submitted' }])
    })
    const placed = await adapter.submit(request('tgcert-idem'))
    const duplicate = await adapter.submit(request('tgcert-idem'))
    expect(duplicate.provider_order_id).toBe(placed.provider_order_id)
    expect(submits).toBe(1)
    expect(await adapter.cancelOrder('DU1234567', '4490', 'tgcert-idem')).toMatchObject({ status: 'canceled' })
    expect(cancels).toBe(1)
  })

  it('allows a sell-to-close only against one exact unencumbered long position', async () => {
    let orderReads = 0
    const bodies: unknown[] = []
    const adapter = await preparedAdapter(async (input, init) => {
      const url = new URL(input)
      if (init?.body) bodies.push(JSON.parse(String(init.body)))
      if (url.pathname.includes('/portfolio/') && url.pathname.endsWith('/positions/0')) {
        return response([{ conid: 999001, assetClass: 'OPT', position: 1, avgCost: 130 }])
      }
      if (url.pathname.endsWith('/account/orders')) {
        orderReads += 1
        if (orderReads <= 2) return response({ orders: [] })
        return response({ orders: [{ ...ibkrOrderRow('tgcert-close', 4492, 'Filled'), side: 'SELL', filledQuantity: 1, avgPrice: 1.27 }] })
      }
      return response([{ order_id: '4492', order_status: 'Submitted' }])
    })
    const close = { ...request('tgcert-close'), action: 'SELL_TO_CLOSE' as const, limit_price: '1.27' }
    expect(await adapter.submit(close)).toMatchObject({ action: 'SELL_TO_CLOSE', status: 'filled' })
    expect(bodies).toContainEqual([{ conid: 999001, side: 'SELL', orderType: 'LMT', price: 1.27, quantity: 1, tif: 'DAY', outsideRTH: false, cOID: 'tgcert-close', referrer: 'TradeGodOptions' }])
  })

  it('blocks close when a working order has ambiguous asset-class evidence', async () => {
    let orderReads = 0
    const adapter = await preparedAdapter(async (input) => {
      const url = new URL(input)
      if (url.pathname.includes('/portfolio/') && url.pathname.endsWith('/positions/0')) {
        return response([{ conid: 999001, assetClass: 'OPT', position: 1, avgCost: 130 }])
      }
      if (url.pathname.endsWith('/account/orders')) {
        orderReads += 1
        return response(orderReads === 1
          ? { orders: [] }
          : { orders: [{ conid: 123, order_ref: 'manual-unknown', orderId: 7, side: 'BUY', orderType: 'LMT', price: 1, totalSize: 1, filledQuantity: 0, tif: 'DAY', status: 'Submitted' }] })
      }
      return response([])
    })
    await expect(adapter.submit({ ...request('tgcert-close-blocked'), action: 'SELL_TO_CLOSE', limit_price: '1.27' }))
      .rejects.toThrow('asset-class evidence')
  })
})

const response = (value: unknown) => ({ ok: true, status: 200, json: async () => value })
const ibkrOrderRow = (clientOrderId: string, orderId: number, status: string) => ({
  conid: 999001, order_ref: clientOrderId, orderId, side: 'BUY', orderType: 'LMT', price: 1.3,
  totalSize: 1, filledQuantity: 0, tif: 'DAY', status,
})

const request = (clientOrderId: string) => ({
  account_id: 'DU1234567', canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650', provider_instrument_id: '999001',
  action: 'BUY_TO_OPEN' as const, order_type: 'limit' as const, limit_price: '1.30', quantity: 1,
  time_in_force: 'day' as const, regular_hours_only: true as const, client_order_id: clientOrderId,
})

const preparedAdapter = async (orderFetch: ConstructorParameters<typeof IbkrOptionsAdapter>[0]['fetch']) => {
  let orderMode = false
  const adapter = new IbkrOptionsAdapter({
    connection_id: 'ibkr-one', account_id: 'DU1234567', access_token: 'secret-token', credential_generation: 'a'.repeat(64), now: () => now,
    fetch: async (input, init) => {
      if (orderMode) return orderFetch!(input, init)
      const pathname = new URL(input).pathname
      const response = pathname.endsWith('/secdef/search') ? [{ conid: 756733, symbol: 'SPY', opt: '20260918' }]
        : pathname.endsWith('/secdef/strikes') ? { call: [650], put: [] }
          : pathname.endsWith('/secdef/info') ? [{ conid: 999001, symbol: 'SPY', maturityDate: '20260918', strike: 650, right: 'C', currency: 'USD', multiplier: '100', validExchanges: 'SMART', localSymbol: 'SPY260918C00650000' }]
            : { increment_rules: [{ lowerEdge: 0, increment: 0.01 }] }
      return { ok: true, status: 200, json: async () => response }
    },
  })
  await adapter.resolveContract({ underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call' })
  orderMode = true
  return adapter
}
