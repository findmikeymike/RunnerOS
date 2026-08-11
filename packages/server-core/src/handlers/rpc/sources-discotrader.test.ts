import { describe, expect, test } from 'bun:test'

import type { LoadedSource } from '@craft-agent/shared/sources'

import { assertDiscoTraderCatalogSource } from './sources'

const config = (overrides: Record<string, unknown> = {}): LoadedSource['config'] => ({
  id: 'discotrader-test',
  name: 'DiscoTrader',
  slug: 'discotrader',
  enabled: true,
  provider: 'discotrader',
  type: 'mcp',
  connectionStatus: 'connected',
  mcp: {
    transport: 'http',
    url: 'http://127.0.0.1:8788/mcp',
    authType: 'bearer',
  },
  ...overrides,
} as LoadedSource['config'])

describe('DiscoTrader source catalog guard', () => {
  test('accepts only the enabled connected audited loopback bearer source', () => {
    expect(() => assertDiscoTraderCatalogSource(config())).not.toThrow()
    expect(() => assertDiscoTraderCatalogSource(config({ enabled: false }))).toThrow('disabled')
    expect(() => assertDiscoTraderCatalogSource(config({ connectionStatus: 'needs_auth' }))).toThrow('requires authentication')
    expect(() => assertDiscoTraderCatalogSource(config({ connectionStatus: 'failed' }))).toThrow('connection failed')
    expect(() => assertDiscoTraderCatalogSource(config({ connectionStatus: 'untested' }))).toThrow('has not been tested')
    expect(() => assertDiscoTraderCatalogSource(config({
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'bearer' },
    }))).toThrow('audited local connection')
  })
})
