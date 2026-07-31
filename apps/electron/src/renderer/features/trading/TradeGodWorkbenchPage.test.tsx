import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import TradeGodWorkbenchPage from './TradeGodWorkbenchPage.tsx'

test('renders the diagnostic shell before runtime health resolves', () => {
  const html = renderToStaticMarkup(<TradeGodWorkbenchPage />)
  expect(html).toContain('Trade God')
  expect(html).toContain('Order Flow Engine')
  expect(html).toContain('Checking runtime')
  expect(html).toContain('Run ES fixture')
  expect(html).toContain('Run GPT specialist')
})
