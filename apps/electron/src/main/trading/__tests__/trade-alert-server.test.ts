import { expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { TradeAlertLedger } from '../trade-alert-ledger.ts'
import { startTradeAlertServer, toTradeAlertIngestionStatus } from '../trade-alert-server.ts'

test('accepts authenticated TradingView alerts and rejects invalid secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-alert-server-'))
  const ledger = new TradeAlertLedger(root, () => '2026-07-30T15:30:01.000Z')
  const server = await startTradeAlertServer({
    port: -1,
    ledger,
    token: '1234567890abcdef1234567890abcdef',
  })

  expect(server).toBeNull()
})

test('serves an authenticated alert endpoint on an ephemeral port', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'trade-alert-server-'))
  const ledger = new TradeAlertLedger(root, () => '2026-07-30T15:30:01.000Z')
  const server = await startTradeAlertServer({
    port: 0,
    host: '127.0.0.1',
    ledger,
    token: '1234567890abcdef1234567890abcdef',
  })
  if (!server) throw new Error('server did not start')

  try {
    const rejected = await fetch(server.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong-secret-000', ticker: 'ES1!' }),
    })
    expect(rejected.status).toBe(401)

    for (let index = 1; index < 120; index += 1) {
      const response = await fetch(server.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: 'wrong-secret-000', ticker: 'ES1!' }),
      })
      expect(response.status).toBe(401)
    }
    const rejectedRateLimited = await fetch(server.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: 'wrong-secret-000', ticker: 'ES1!' }),
    })
    expect(rejectedRateLimited.status).toBe(429)

    const accepted = await fetch(server.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        secret: server.token,
        ticker: 'CME_MINI:ES1!',
        action: 'buy',
        message: 'Opening range reclaimed',
      }),
    })
    expect(accepted.status).toBe(201)
    expect((await ledger.list())[0]?.symbol).toBe('CME_MINI:ES1-')
  } finally {
    await server.stop()
  }
})

test('reports a connected public HTTPS relay', () => {
  expect(toTradeAlertIngestionStatus({
    url: 'http://127.0.0.1:9102',
    webhookUrl: 'http://127.0.0.1:9102/v1/trade-god/alerts/tradingview',
    token: 'not-returned-in-status',
    stop: async () => {},
  }, undefined, {
    publicUrl: 'https://trade-god.trycloudflare.com',
    webhookUrl: 'https://trade-god.trycloudflare.com/v1/trade-god/alerts/tradingview',
    isConnected: () => true,
    stop: async () => {},
  })).toEqual({
    state: 'ready',
    local_url: 'http://127.0.0.1:9102/v1/trade-god/alerts/tradingview',
    public_url: 'https://trade-god.trycloudflare.com/v1/trade-god/alerts/tradingview',
    authentication: 'json-body-secret',
    public_relay_connected: true,
    message: 'Public HTTPS receiver is ready for TradingView alerts.',
  })
})
