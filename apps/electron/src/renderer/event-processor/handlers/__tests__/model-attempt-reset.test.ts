import { describe, expect, it } from 'bun:test'
import { handleModelAttemptReset } from '../text'
import type { ModelAttemptResetEvent, SessionState } from '../../types'

function makeState(messages: any[]): SessionState {
  return {
    session: {
      id: 'session-1',
      messages,
      lastMessageAt: Date.now(),
      isProcessing: true,
    } as any,
    streaming: { content: 'partial', turnId: 'failed-stream' },
  }
}

describe('handleModelAttemptReset', () => {
  it('removes failed assistant text but preserves prior messages and tool receipts', () => {
    const state = makeState([
      { id: 'prior', role: 'assistant', content: 'Earlier answer', turnId: 'prior-turn' },
      { id: 'failed-complete', role: 'assistant', content: 'Checking', turnId: 'failed-complete' },
      { id: 'tool-1', role: 'tool', toolUseId: 'write-1', toolResult: 'sent' },
      { id: 'failed-stream-local', role: 'assistant', content: 'Partial', turnId: 'failed-stream', isStreaming: true, isPending: true },
    ])
    const event: ModelAttemptResetEvent = {
      type: 'model_attempt_reset',
      sessionId: 'session-1',
      messageIds: ['failed-complete'],
      turnIds: ['failed-complete', 'failed-stream'],
    }

    const next = handleModelAttemptReset(state, event)

    expect(next.session.messages.map(message => message.id)).toEqual(['prior', 'tool-1'])
    expect(next.streaming).toBeNull()
  })

  it('clears an unkeyed streaming bubble without deleting completed history', () => {
    const state = makeState([
      { id: 'prior', role: 'assistant', content: 'Earlier answer' },
      { id: 'failed-stream-local', role: 'assistant', content: 'Partial', isStreaming: true, isPending: true },
    ])

    const next = handleModelAttemptReset(state, {
      type: 'model_attempt_reset',
      sessionId: 'session-1',
      messageIds: [],
    })

    expect(next.session.messages.map(message => message.id)).toEqual(['prior'])
    expect(next.streaming).toBeNull()
  })
})
