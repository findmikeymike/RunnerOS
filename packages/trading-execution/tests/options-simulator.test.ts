import { describe, expect, test } from 'bun:test'

import {
  FixedDecimal,
  FakeOptionsProvider,
  resolveExactOptionContract,
} from '../src/index.ts'

describe('fixed option-premium arithmetic', () => {
  test('never uses floating point for tick rounding or maximum debit', () => {
    expect(FixedDecimal.from('1.305').roundDownToTick('0.01').toString()).toBe('1.30')
    expect(FixedDecimal.from('1.30').multiplyInteger(100).multiplyInteger(2).add('1.30').toString())
      .toBe('261.30')
  })

  test('rejects excess precision and nonpositive ticks', () => {
    expect(() => FixedDecimal.from('1.1234567')).toThrow('precision')
    expect(() => FixedDecimal.from('1.2').roundDownToTick('0')).toThrow('positive')
    expect(FixedDecimal.from('3').toCanonicalString(2)).toBe('3.00')
  })
})

describe('fake options provider', () => {
  const provider = () => FakeOptionsProvider.paperFixture()

  test('resolves exactly one contract and returns deterministic realtime quote evidence', async () => {
    const fake = provider()
    const contract = await fake.resolveContract({
      underlying: 'SPY',
      expiration: '2026-09-18',
      strike: '650',
      right: 'call',
    })
    const quote = await fake.quote(contract.canonical_id)
    expect(contract.provider_instrument_id).toBe('fake-spy-20260918-c-650')
    expect(quote).toMatchObject({ bid: '1.27', ask: '1.30', delayed: false })
  })

  test('refuses zero-match and ambiguous contract resolution', async () => {
    const fake = provider()
    await expect(fake.resolveContract({
      underlying: 'SPY', expiration: '2026-09-18', strike: '999', right: 'call',
    })).rejects.toMatchObject({ code: 'OPTIONS_CONTRACT_NOT_FOUND' })
    fake.addContract({ ...fake.contracts[0]!, provider_instrument_id: 'duplicate-provider-id' })
    await expect(fake.resolveContract({
      underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call',
    })).rejects.toMatchObject({ code: 'OPTIONS_CONTRACT_AMBIGUOUS' })
  })

  test('refuses a resolver response that substitutes a different contract', async () => {
    const fake = provider()
    const exact = fake.contracts[0]!
    await expect(resolveExactOptionContract({
      resolveContract: async () => ({
        ...exact,
        canonical_id: 'USOPT:SPY:2026-09-18:P:650',
        right: 'put',
      }),
    }, {
      underlying: 'SPY', expiration: '2026-09-18', strike: '650', right: 'call',
    })).rejects.toMatchObject({ code: 'OPTIONS_PROVIDER_DIVERGENCE' })
  })

  test('previews, submits once by client ID, fills, cancels, and exposes exact account truth', async () => {
    const fake = provider()
    const request = {
      account_id: 'account-options-paper',
      canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650',
      provider_instrument_id: 'fake-spy-20260918-c-650',
      action: 'BUY_TO_OPEN' as const,
      order_type: 'limit' as const,
      limit_price: '1.30',
      quantity: 2,
      time_in_force: 'day' as const,
      regular_hours_only: true as const,
      client_order_id: 'tg-options-order-1',
    }
    expect((await fake.preview(request)).buying_power_impact).toBe('261.30')
    const first = await fake.submit(request)
    const duplicate = await fake.submit(request)
    expect(duplicate.provider_order_id).toBe(first.provider_order_id)
    expect(fake.mutationCount).toBe(1)

    await fake.fill(first.provider_order_id, 1, '1.29')
    await fake.cancel(first.provider_order_id)
    const truth = await fake.snapshotAccount('account-options-paper')
    expect(truth.positions).toEqual([{
      canonical_contract_id: request.canonical_contract_id,
      quantity: 1,
      average_price: '1.29',
    }])
    expect(truth.orders[0]).toMatchObject({ status: 'partially-filled-canceled', filled_quantity: 1 })
  })

  test('rejects a client-order-ID collision with different economics', async () => {
    const fake = provider()
    const request = {
      account_id: 'account-options-paper',
      canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650',
      provider_instrument_id: 'fake-spy-20260918-c-650',
      action: 'BUY_TO_OPEN' as const,
      order_type: 'limit' as const,
      limit_price: '1.30',
      quantity: 1,
      time_in_force: 'day' as const,
      regular_hours_only: true as const,
      client_order_id: 'tg-options-order-1',
    }
    await fake.submit(request)
    await expect(fake.submit({ ...request, limit_price: '1.31' }))
      .rejects.toMatchObject({ code: 'OPTIONS_PROVIDER_DIVERGENCE' })
    expect(fake.mutationCount).toBe(1)
  })

  test('rejects nonpositive request and fill economics before mutation', async () => {
    const fake = provider()
    const request = {
      account_id: 'account-options-paper',
      canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650',
      provider_instrument_id: 'fake-spy-20260918-c-650',
      action: 'BUY_TO_OPEN' as const,
      order_type: 'limit' as const,
      limit_price: '0',
      quantity: 1,
      time_in_force: 'day' as const,
      regular_hours_only: true as const,
      client_order_id: 'tg-options-invalid-price',
    }
    await expect(fake.submit(request)).rejects.toMatchObject({ code: 'OPTIONS_PROVIDER_DIVERGENCE' })
    expect(fake.mutationCount).toBe(0)
    await expect(fake.submit({ ...request, limit_price: '1.305' }))
      .rejects.toMatchObject({ code: 'OPTIONS_PROVIDER_DIVERGENCE' })
    expect(fake.mutationCount).toBe(0)

    const order = await fake.submit({ ...request, limit_price: '1.30', client_order_id: 'tg-options-valid-price' })
    await expect(fake.fill(order.provider_order_id, 1, '-1')).rejects.toMatchObject({ code: 'OPTIONS_PROVIDER_DIVERGENCE' })
    expect(fake.mutationCount).toBe(1)
  })

  test('keeps weighted fill arithmetic exact without binary floats', async () => {
    const fake = provider()
    const order = await fake.submit({
      account_id: 'account-options-paper',
      canonical_contract_id: 'USOPT:SPY:2026-09-18:C:650',
      provider_instrument_id: 'fake-spy-20260918-c-650',
      action: 'BUY_TO_OPEN',
      order_type: 'limit',
      limit_price: '1.30',
      quantity: 2,
      time_in_force: 'day',
      regular_hours_only: true,
      client_order_id: 'tg-options-weighted-fill',
    })
    await fake.fill(order.provider_order_id, 1, '1.29')
    await fake.fill(order.provider_order_id, 1, '1.31')
    expect((await fake.snapshotAccount('account-options-paper')).positions[0]?.average_price).toBe('1.30')
  })
})
