import { describe, expect, test } from 'bun:test'
import { beginPromptAutomation, uniqueWebhookSlug } from './automations'

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

  test('returns a prompt automation start without waiting for the model turn', async () => {
    let finish!: () => void
    const launch = beginPromptAutomation(async (onSessionCreated) => {
      onSessionCreated('session-spotify')
      await new Promise<void>((resolve) => { finish = resolve })
      return { sessionId: 'session-spotify' }
    })

    await expect(launch.started).resolves.toEqual({ sessionId: 'session-spotify' })
    let completed = false
    void launch.completion.then(() => { completed = true })
    await Promise.resolve()
    expect(completed).toBe(false)

    finish()
    await expect(launch.completion).resolves.toEqual({ sessionId: 'session-spotify' })
  })

  test('surfaces a prompt automation failure that occurs before session creation', async () => {
    const launch = beginPromptAutomation(async () => {
      throw new Error('agent unavailable')
    })

    await expect(launch.started).rejects.toThrow('agent unavailable')
    await expect(launch.completion).rejects.toThrow('agent unavailable')
  })
})
