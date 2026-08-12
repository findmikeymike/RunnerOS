import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'bun:test'

import TradeGodSignalsPage from './TradeGodSignalsPage'
import TradeGodTradesPage from './TradeGodTradesPage'

test('renders a real execution-ledger trade surface', () => {
  const html = renderToStaticMarkup(<TradeGodTradesPage />)
  expect(html).toContain('Execution ledger')
  expect(html).toContain('active')
  expect(html).toContain('pending')
  expect(html).toContain('closed')
  expect(html).toContain('No active trades')
})

test('renders a focused external signals queue', () => {
  const html = renderToStaticMarkup(<TradeGodSignalsPage />)
  expect(html).toContain('Inbound intelligence')
  expect(html).toContain('Signals')
  expect(html).toContain('No signals yet')
})
