import { describe, expect, test } from 'bun:test'

import {
  TRADE_ALERT_SCHEMA_VERSION,
  tradeAlertIngestionStatusSchema,
  tradeAlertSchema,
  tradeAlertWebhookSetupSchema,
  tradingViewAlertPayloadSchema,
} from '../src/trade-alert.ts'

describe('trade alert contracts', () => {
  test('accepts a bounded canonical alert', () => {
    const alert = tradeAlertSchema.parse({
      schema_version: TRADE_ALERT_SCHEMA_VERSION,
      id: 'tv-abc123',
      source: 'tradingview',
      source_ref: 'alert-123',
      received_at: '2026-07-30T18:00:00.000Z',
      occurred_at: '2026-07-30T17:59:59.000Z',
      symbol: 'NASDAQ:NVDA',
      title: 'NVDA crossed 120',
      severity: 'watch',
      direction: 'long',
      status: 'new',
      price: '120.50',
      interval: '5',
    })

    expect(alert.symbol).toBe('NASDAQ:NVDA')
  })

  test('requires authentication material and a ticker identity', () => {
    expect(() => tradingViewAlertPayloadSchema.parse({
      secret: '1234567890abcdef',
      message: 'missing ticker',
    })).toThrow()
    expect(() => tradingViewAlertPayloadSchema.parse({
      ticker: 'ES1!',
      message: 'missing secret',
    })).toThrow()
  })

  test('accepts a connected public relay and delivery URL', () => {
    expect(tradeAlertIngestionStatusSchema.parse({
      state: 'ready',
      local_url: 'http://127.0.0.1:9102/v1/trade-god/alerts/tradingview',
      public_url: 'https://trade-god.trycloudflare.com/v1/trade-god/alerts/tradingview',
      authentication: 'json-body-secret',
      public_relay_connected: true,
    }).public_relay_connected).toBe(true)

    expect(tradeAlertWebhookSetupSchema.parse({
      delivery_url: 'https://trade-god.trycloudflare.com/v1/trade-god/alerts/tradingview',
      local_url: 'http://127.0.0.1:9102/v1/trade-god/alerts/tradingview',
      public_url: 'https://trade-god.trycloudflare.com/v1/trade-god/alerts/tradingview',
      json_body_template: '{"secret":"replace-me"}',
    }).delivery_url).toStartWith('https://')
  })
})
