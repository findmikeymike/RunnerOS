import { describe, expect, test } from 'bun:test'
import { uniqueWebhookSlug } from './automations'

describe('automation RPC helpers', () => {
  test('gives duplicated webhook automations a valid unique slug', () => {
    const matchers = [
      { slug: 'campaign-ready' },
      { slug: 'campaign-ready-copy' },
    ]
    expect(uniqueWebhookSlug('campaign-ready', matchers, true)).toBe('campaign-ready-copy-2')
  })

  test('keeps generated webhook slugs within the schema limit', () => {
    const base = 'a'.repeat(64)
    const duplicate = uniqueWebhookSlug(base, [{ slug: base }], true)
    expect(duplicate.length).toBeLessThanOrEqual(64)
    expect(duplicate).toMatch(/-copy$/)
  })
})
