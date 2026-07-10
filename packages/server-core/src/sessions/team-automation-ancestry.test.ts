import { describe, expect, it } from 'bun:test'
import type { SessionLaunchReceipt } from '@craft-agent/shared/sessions'
import { hasAutomatedSessionAncestry } from './SessionManager'

function receipt(origin: SessionLaunchReceipt['origin'], automatedAncestry?: boolean): SessionLaunchReceipt {
  return {
    createdAt: 1,
    origin,
    automatedAncestry,
    config: {},
    injected: { skills: [], sources: [], contextDocs: [] },
  }
}

describe('Team automation ancestry', () => {
  it.each(['automation', 'workflow', 'deep-research'] as const)('backfills legacy %s receipts', (origin) => {
    expect(hasAutomatedSessionAncestry(receipt(origin))).toBe(true)
    expect(hasAutomatedSessionAncestry(receipt(origin, false))).toBe(true)
  })

  it('does not classify manual or ordinary agent sessions as automated', () => {
    expect(hasAutomatedSessionAncestry(receipt('manual'))).toBe(false)
    expect(hasAutomatedSessionAncestry(receipt('agent'))).toBe(false)
  })

  it('preserves ancestry on spawned and delegated child receipts', () => {
    expect(hasAutomatedSessionAncestry(receipt('spawned-session', true))).toBe(true)
    expect(hasAutomatedSessionAncestry(receipt('agent', true))).toBe(true)
  })
})
