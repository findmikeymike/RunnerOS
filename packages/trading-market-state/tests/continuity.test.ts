import { describe, expect, test } from 'bun:test'

import type { MarketTradeEvent } from '@trade-god/contracts'

import { MarketFeedContinuityGuard, buildReplayContinuity } from '../src/index.ts'

const options = {
  provider: 'test-feed',
  instrumentId: 'CME:ESU6',
  staleAfterNs: '5',
}

describe('market feed continuity guard', () => {
  test('requires explicit resynchronization after connect and reconnect', () => {
    const guard = new MarketFeedContinuityGuard(options)

    expect(guard.connect('100').state).toBe('recovering')
    expect(guard.observe({ sequence: '1', eventNs: '100', observedAtNs: '100' }).state).toBe('recovering')
    expect(guard.resynchronize({ sequence: '1', eventNs: '100', observedAtNs: '100' }).state).toBe('healthy')
    expect(guard.connect('110')).toMatchObject({ state: 'recovering', connection_epoch: 2 })
  })

  test('keeps a sequence gap closed to analysis until an explicit resync', () => {
    const guard = new MarketFeedContinuityGuard(options)
    guard.connect('100')
    guard.resynchronize({ sequence: '10', eventNs: '100', observedAtNs: '100' })

    expect(guard.observe({ sequence: '13', eventNs: '101', observedAtNs: '101' })).toMatchObject({
      state: 'gapped',
      missing_ranges: [{ start_sequence: '11', end_sequence: '12' }],
    })
    expect(guard.observe({ sequence: '14', eventNs: '102', observedAtNs: '102' }).state).toBe('gapped')
    expect(guard.resynchronize({ sequence: '14', eventNs: '102', observedAtNs: '102' })).toMatchObject({
      state: 'healthy',
      missing_ranges: [],
    })
  })

  test('marks a quiet feed stale and recovers only on a contiguous fresh event', () => {
    const guard = new MarketFeedContinuityGuard(options)
    guard.connect('100')
    guard.resynchronize({ sequence: '1', eventNs: '100', observedAtNs: '100' })

    expect(guard.status('106').state).toBe('stale')
    expect(guard.observe({ sequence: '2', eventNs: '107', observedAtNs: '107' }).state).toBe('healthy')
  })

  test('detects missing provider sequences in replay evidence', () => {
    const event = {
      ts_event_ns: '100',
      source: { provider: 'test-feed' },
    } as MarketTradeEvent
    expect(buildReplayContinuity([event], {
      ...options,
      observedAtNs: '100',
    })).toMatchObject({
      state: 'recovering',
      faults: ['missing-provider-sequence'],
    })
  })
})
