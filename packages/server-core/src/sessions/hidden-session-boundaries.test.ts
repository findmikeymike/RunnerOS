import { describe, expect, test } from 'bun:test'
import {
  assertCanSendAgentMessageToSession,
  isAgentMessageLineageReply,
  shouldExposeSessionInLists,
} from './SessionManager.ts'

describe('hidden session boundaries', () => {
  test('hides hidden sessions from default session lists', () => {
    expect(shouldExposeSessionInLists({ hidden: true })).toBe(false)
    expect(shouldExposeSessionInLists({ hidden: false })).toBe(true)
    expect(shouldExposeSessionInLists({})).toBe(true)
  })

  test('allows explicit internal hidden-session listing', () => {
    expect(shouldExposeSessionInLists({ hidden: true }, { includeHidden: true })).toBe(true)
  })

  test('blocks send_agent_message traffic to hidden sessions', () => {
    expect(() => assertCanSendAgentMessageToSession({ id: 'hidden-child', hidden: true }))
      .toThrow('cannot receive send_agent_message')
    expect(() => assertCanSendAgentMessageToSession({ id: 'visible-session' })).not.toThrow()
  })

  test('allows hidden session sends only with explicit boundary exception', () => {
    expect(() => assertCanSendAgentMessageToSession(
      { id: 'hidden-parent', hidden: true },
      { allowHiddenTarget: true },
    )).not.toThrow()
  })

  test('recognizes agent-message child to parent lineage', () => {
    const receipts = [
      { parentSessionId: 'hidden-parent', childSessionId: 'child-session' },
      { parentSessionId: 'other-parent', childSessionId: 'other-child' },
    ]

    expect(isAgentMessageLineageReply(receipts, 'child-session', 'hidden-parent')).toBe(true)
    expect(isAgentMessageLineageReply(receipts, 'child-session', 'other-parent')).toBe(false)
    expect(isAgentMessageLineageReply(receipts, 'other-child', 'hidden-parent')).toBe(false)
  })
})
