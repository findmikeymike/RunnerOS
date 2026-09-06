import { afterEach, expect, test } from 'bun:test'

import {
  openTradingConnections,
  readTradingConnectionsMarket,
  TRADING_CONNECTIONS_MARKET_KEY,
} from './trading-connections-navigation'

const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
})

test('preserves the selected Connections market while keeping the stable accounts view key', () => {
  const values = new Map<string, string>()
  let event: Event | null = null
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: (next: Event) => { event = next; return true },
    },
  })

  expect(readTradingConnectionsMarket()).toBe('futures')
  openTradingConnections('options')
  expect(values.get(TRADING_CONNECTIONS_MARKET_KEY)).toBe('options')
  expect(readTradingConnectionsMarket()).toBe('options')
  expect(event).not.toBeNull()
  expect((event as unknown as CustomEvent<string>).detail).toBe('accounts')
})
