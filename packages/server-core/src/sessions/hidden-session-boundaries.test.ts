import { describe, expect, test } from 'bun:test'
import { SessionManager, createManagedSession } from './SessionManager'
import { assertCanSendAgentMessageToSession, shouldExposeSessionInLists } from './hidden-session-boundaries'

describe('hidden job boundaries', () => {
  test('normal lists hide jobs while explicit internal access includes them', () => {
    expect(shouldExposeSessionInLists({ hidden: true })).toBe(false)
    expect(shouldExposeSessionInLists({ hidden: false })).toBe(true)
    expect(shouldExposeSessionInLists({})).toBe(true)
    expect(shouldExposeSessionInLists({ hidden: true }, { includeHidden: true })).toBe(true)
  })
  test('visible conversations remain addressable', () => {
    expect(() => assertCanSendAgentMessageToSession({ id: 'user' }, 'sender', 'normal', [])).not.toThrow()
  })
  test('only a receipt-bound passive child reply may reach a hidden parent', () => {
    const target = { id: 'parent', hidden: true }
    const receipts = [{ parentSessionId: 'parent', childSessionId: 'child' }]
    expect(() => assertCanSendAgentMessageToSession(target, 'child', 'passive', receipts)).not.toThrow()
    expect(() => assertCanSendAgentMessageToSession(target, 'child', 'normal', receipts)).toThrow('hidden')
    expect(() => assertCanSendAgentMessageToSession(target, 'stranger', 'passive', receipts)).toThrow('hidden')
    expect(() => assertCanSendAgentMessageToSession(target, 'child', 'passive', [])).toThrow('hidden')
    expect(() => assertCanSendAgentMessageToSession(target, 'child', 'passive', [{ parentSessionId: 'other', childSessionId: 'child' }])).toThrow('hidden')
  })
})

test('SessionManager filters public lists without losing internal metadata access', () => {
  const manager = new SessionManager()
  const sessions = (manager as unknown as { sessions: Map<string, unknown> }).sessions
  for (const [id, workspaceId, hidden] of [['visible', 'ws', false], ['job', 'ws', true], ['other', 'other-ws', false]] as const) {
    sessions.set(id, createManagedSession({ id, hidden }, {
      id: workspaceId, name: workspaceId, slug: workspaceId, rootPath: '/tmp/hidden-session-test', createdAt: 1,
    }, { messagesLoaded: true }))
  }
  expect(manager.getSessions('ws').map(session => session.id)).toEqual(['visible'])
  expect(manager.getSessions('ws', { includeHidden: true }).map(session => session.id).sort()).toEqual(['job', 'visible'])
  expect(manager.getSessions().map(session => session.id).sort()).toEqual(['other', 'visible'])
})
