import { describe, expect, it } from 'bun:test'
import { getBackgroundAgentStatusText } from '../BackgroundAgentNotice'

describe('background agent status text', () => {
  it.each([
    ['running', 'Campaign Critic is working in the background'],
    ['succeeded', 'Campaign Critic finished'],
    ['failed', 'Campaign Critic needs attention'],
    ['cancelled', 'Campaign Critic was stopped'],
    ['timed-out', 'Campaign Critic timed out'],
  ] as const)('renders %s without technical identifiers', (status, expected) => {
    const text = getBackgroundAgentStatusText({
      receiptId: 'receipt-secret',
      childSessionId: 'child-secret',
      targetAgentSlug: 'campaign-critic',
      status,
    })

    expect(text).toBe(expected)
    expect(text).not.toContain('receipt-secret')
    expect(text).not.toContain('child-secret')
  })
})
