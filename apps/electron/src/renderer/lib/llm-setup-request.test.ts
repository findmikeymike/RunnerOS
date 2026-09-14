import { afterEach, beforeEach, expect, test } from 'bun:test'
import { onLlmSetupRequest, queueLlmSetupRequest, takeLlmSetupRequest } from './llm-setup-request'
const previousWindow = globalThis.window
beforeEach(() => {
  globalThis.window = new EventTarget() as unknown as Window & typeof globalThis
  takeLlmSetupRequest()
})
afterEach(() => {
  takeLlmSetupRequest()
  globalThis.window = previousWindow
})
test('secure setup request survives navigation before Settings listener mounts', () => {
  const request = { requestId: 'one', sessionId: 'setup-chat', slug: 'saved-model' }
  queueLlmSetupRequest(request)
  expect(takeLlmSetupRequest()).toEqual(request)
  expect(takeLlmSetupRequest()).toBeNull()
})
test('mounted Settings receives each request once and removes listener on unmount', () => {
  const received: unknown[] = []
  const unsubscribe = onLlmSetupRequest(() => { received.push(takeLlmSetupRequest()) })
  queueLlmSetupRequest({ requestId: 'one', sessionId: 'setup-chat', provider: 'chatgpt' })
  expect(received).toHaveLength(1)
  expect(takeLlmSetupRequest()).toBeNull()
  unsubscribe()
  queueLlmSetupRequest({ requestId: 'two', sessionId: 'setup-chat' })
  expect(received).toHaveLength(1)
  expect(takeLlmSetupRequest()?.requestId).toBe('two')
})
