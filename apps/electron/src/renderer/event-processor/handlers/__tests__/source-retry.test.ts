import { expect, test } from 'bun:test'
import { processEvent } from '../../processor'
import type { SessionState } from '../../types'

test('source activation forwards host retry token without creating a user message', () => {
  const state = { session: { id: 'session-1', messages: [] }, streaming: { content: '' } } as unknown as SessionState
  const result = processEvent(state, { type: 'source_activated', sessionId: 'session-1', sourceSlug: 'source-1', originalMessage: 'Original ask', retryToken: 'host-token' })
  expect(result.state).toBe(state)
  expect(result.effects).toEqual([{ type: 'auto_retry', sessionId: 'session-1', sourceSlug: 'source-1', originalMessage: 'Original ask', retryToken: 'host-token' }])
})
