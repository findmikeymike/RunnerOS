import { expect, mock, test } from 'bun:test'
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf.worker.js' }))
mock.module('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => ({}) }))
import { renderToStaticMarkup } from 'react-dom/server'

const {
  default: TradeGodHomePage,
  normalizeWatchTicker,
  readWatchlistPreference,
} = await import('./TradeGodHomePage.tsx')

test('renders a futures-first overview with honest connection states', () => {
  const html = renderToStaticMarkup(<TradeGodHomePage workspaceId="desk-es" workspaceName="Index Futures" />)
  expect(html).toContain('Futures Overview')
  expect(html).toContain('Index Futures')
  expect(html).toContain('Core futures contracts')
  expect(html).toContain('Loading native chart')
  expect(html).toContain('Attention stream')
  expect(html).toContain('Desk priorities')
  expect(html).toContain('Market headlines')
  expect(html).toContain('Desk watchlist')
  expect(html).toContain('Discord alerts')
  expect(html).toContain('TradingView local')
  expect(html).toContain('Market breadth')
  expect(html).toContain('Preview mode')
  expect(html).toContain('market data offline')
  expect(html).not.toContain('Order Flow Engine')
})

test('normalizes watch pad ticker input', () => {
  expect(normalizeWatchTicker('  nvda ')).toBe('NVDA')
  expect(normalizeWatchTicker('$brk.b!')).toBe('BRK.B')
})

test('prefers a workspace-scoped Futures Hub watchlist over the legacy global watchlist', () => {
  const preferences = JSON.stringify({
    tradeGod: {
      watchlist: ['SPY'],
      futuresHubs: {
        'desk-es': {
          watchlist: ['ES', 'NQ'],
        },
      },
    },
  })

  expect(readWatchlistPreference(preferences, 'desk-es')).toEqual(['ES', 'NQ'])
  expect(readWatchlistPreference(preferences, 'desk-rates')).toEqual(['SPY'])
})
