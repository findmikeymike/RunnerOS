import { expect, test } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { TradeAlertLedger, normalizeTradingViewAlert } from '../trade-alert-ledger.ts'

test('normalizes TradingView payloads without persisting the secret', () => {
  const alert = normalizeTradingViewAlert({
    secret: '1234567890abcdef',
    ticker: 'CME_MINI:ES1!',
    action: 'buy',
    message: 'Opening range reclaimed',
    price: '5592.25',
    time: '2026-07-30T15:30:00Z',
  }, '2026-07-30T15:30:01.000Z')

  expect(alert.symbol).toBe('CME_MINI:ES1-')
  expect(alert.direction).toBe('long')
  expect(alert.price).toBe('5592.25')
  expect(JSON.stringify(alert)).not.toContain('1234567890abcdef')
})

test('persists, deduplicates, lists, and acknowledges alerts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-alert-ledger-'))
  const ledger = new TradeAlertLedger(root, () => '2026-07-30T15:30:01.000Z')
  const payload = {
    secret: '1234567890abcdef',
    ticker: 'NASDAQ:NVDA',
    alert_id: 'tv-alert-1',
    message: 'NVDA breakout',
  }

  const first = await ledger.ingestTradingView(payload)
  const duplicate = await ledger.ingestTradingView(payload)
  expect(first.created).toBe(true)
  expect(duplicate.created).toBe(false)
  expect((await ledger.list())[0]?.symbol).toBe('NASDAQ:NVDA')

  const acknowledged = await ledger.acknowledge(first.alert.id)
  expect(acknowledged?.status).toBe('acknowledged')
  expect(await readFile(path.join(root, 'alerts.json'), 'utf8')).not.toContain(payload.secret)
})
