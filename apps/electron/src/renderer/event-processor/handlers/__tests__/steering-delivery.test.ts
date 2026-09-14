import { describe, expect, test } from 'bun:test'
import { processEvent } from '../../processor'
import { handleComplete, handleInterrupted, handleUserMessage } from '../session'
import type { SessionState, UserMessageEvent } from '../../types'

function state(messages: SessionState['session']['messages'] = []): SessionState {
  return { session: { id: 'session', messages, isProcessing: true, lastMessageAt: 1 } as SessionState['session'], streaming: null }
}
function event(id: string, status: UserMessageEvent['status'], isQueued?: boolean): UserMessageEvent {
  return { type: 'user_message', sessionId: 'session', status, optimisticMessageId: id,
    message: { id, role: 'user', content: 'use the new version', timestamp: 1000, isQueued } }
}

describe('steering delivery receipts', () => {
  test('persisted acceptance and turn completion retain pending steering until delivery', () => {
    let current = handleUserMessage(state(), event('steer', 'accepted', true)).state
    expect(current.session.messages[0]?.isQueued).toBe(true)
    current = handleComplete(current, { type: 'complete', sessionId: 'session' }).state
    expect(current.session.messages[0]?.isQueued).toBe(true)
    current = handleUserMessage(current, event('steer', 'queued', true)).state
    expect(current.session.isProcessing).toBe(false)
    current = handleUserMessage(current, event('steer', 'processing', false)).state
    expect(current.session.messages).toHaveLength(1)
    expect(current.session.messages[0]?.isQueued).toBe(false)
    expect(current.session.isProcessing).toBe(true)
    // An old queue notification cannot regress delivery.
    expect(handleUserMessage(current, event('steer', 'queued', true)).state).toBe(current)
    expect(handleUserMessage(current, event('steer', 'accepted', true)).state).toBe(current)
  })

  test('queued update does not turn off a still-running response', () => {
    const next = handleUserMessage(state(), event('steer', 'queued', true)).state
    expect(next.session.isProcessing).toBe(true)
  })

  test('identical corrections keep distinct IDs and targeted receipts update only one', () => {
    let current = handleUserMessage(state(), event('one', 'accepted', true)).state
    current = handleUserMessage(current, event('two', 'accepted', true)).state
    current = handleUserMessage(current, event('two', 'processing', false)).state
    expect(current.session.messages.map((m) => [m.id, m.isQueued])).toEqual([['one', true], ['two', false]])
  })

  test('backend-only identical messages are not collapsed by a timestamp heuristic', () => {
    const first = { ...event('one', 'queued', true), optimisticMessageId: undefined }
    const second = { ...event('two', 'queued', true), optimisticMessageId: undefined }
    const current = handleUserMessage(handleUserMessage(state(), first).state, second).state
    expect(current.session.messages.map((m) => m.id)).toEqual(['one', 'two'])
  })

  test('Stop restores persisted pending text after complete instead of leaving duplicate bubbles', () => {
    let current = handleUserMessage(state(), event('steer', 'accepted', true)).state
    current = handleComplete(current, { type: 'complete', sessionId: 'session' }).state
    const stopped = handleInterrupted(current, {
      type: 'interrupted', sessionId: 'session', queuedMessages: ['use the new version'],
      message: { id: 'stop', role: 'info', content: 'Response interrupted', timestamp: 2000 },
    })
    expect(stopped.state.session.messages.map((m) => m.id)).toEqual(['stop'])
    expect(stopped.effects).toEqual([{ type: 'restore_input', text: 'use the new version' }])
  })

  test('ordinary accepted messages remain unqueued', () => {
    expect(handleUserMessage(state(), event('initial', 'accepted', false)).state.session.messages[0]?.isQueued).toBe(false)
  })
})


test('queue edit and remove reconcile canonical ids without duplicating optimistic messages', () => {
  const initial = state([{ id: 'ui', role: 'user', content: 'YouTube', timestamp: 1, isQueued: true }])
  const edited = processEvent(initial, { type: 'queued_message_changed', sessionId: 'session', messageId: 'host', optimisticMessageId: 'ui', message: { id: 'host', role: 'user', content: 'TikTok', timestamp: 1, isQueued: true } }).state
  expect(edited.session.messages).toHaveLength(1)
  expect(edited.session.messages[0]?.content).toBe('TikTok')
  expect(edited.session.messages[0]?.id).toBe('ui')
  const removed = processEvent(edited, { type: 'queued_message_changed', sessionId: 'session', messageId: 'host', optimisticMessageId: 'ui' }).state
  expect(removed.session.messages).toHaveLength(0)
})

test('late queue changes cannot remove a message already processing', () => {
  const initial = state([{ id: 'ui', role: 'user', content: 'TikTok', timestamp: 1, isQueued: false }])
  const next = processEvent(initial, { type: 'queued_message_changed', sessionId: 'session', messageId: 'host', optimisticMessageId: 'ui' }).state
  expect(next.session.messages).toEqual(initial.session.messages)
})


test('a queued message enters the transcript after the response it waited for', () => {
  const initial = state([
    { id: 'ui', role: 'user', content: 'TikTok', timestamp: 1, isQueued: true },
    { id: 'reply', role: 'assistant', content: 'Original answer', timestamp: 2 },
  ])
  const next = handleUserMessage(initial, { type: 'user_message', sessionId: 'session', status: 'processing', optimisticMessageId: 'ui', message: { id: 'host', role: 'user', content: 'TikTok', timestamp: 1, isQueued: false } }).state
  expect(next.session.messages.map(message => message.id)).toEqual(['reply', 'ui'])
})
