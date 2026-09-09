import { expect, test } from 'bun:test'
import { getModels, streamSimple } from '@earendil-works/pi-ai/compat'
import { ArtistManagerVoiceFocusService } from './artist-manager-voice-focus'
import type { VoiceFocusEvent } from '../shared/artist-manager-voice-focus'

// Exercise the installed SDK, including JWT account routing and wire event decoding.
// No network or real credentials: fetch is injected per request, not globally mocked.
test('Conversation reaches the Codex subscription wire protocol and streams its response', async () => {
  const model = getModels('openai-codex').find(candidate => candidate.id === 'gpt-5.4-mini')!
  expect(model).toBeDefined()
  const token = `e30.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64')}.signature`
  let calls = 0
  const service = new ArtistManagerVoiceFocusService({
    resolveConfig: async () => ({ connection: { slug: 'chatgpt-test', name: 'ChatGPT', providerType: 'pi', piAuthProvider: 'openai-codex', authType: 'oauth', createdAt: 0 }, model: model.id }),
    resolveModel: async () => model,
    getApiKey: async () => token,
    stream: (selected, context, options) => streamSimple(selected, context, {
      ...options,
      fetch: (async (url, init) => {
        calls++
        expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`)
        expect(new Headers(init?.headers).get('chatgpt-account-id')).toBe('test-account')
        expect(options.transport).toBe('sse')
        expect(options.maxRetries).toBe(0)
        const events = [
          { type: 'response.created', response: { id: 'resp_test' } },
          { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_test', role: 'assistant', content: [] } },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Subscription voice works.' },
          { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [], usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } } },
        ]
        return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
      }) as typeof fetch,
    }),
  })
  try {
    const session = await service.register(1, { workspaceId: 'test', systemPrompt: 'Talk briefly.' })
    const events: VoiceFocusEvent[] = []
    await service.startTurn(1, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, event => events.push(event))
    expect(calls).toBe(1)
    expect(events).toContainEqual({ type: 'text_delta', delta: 'Subscription voice works.', sessionId: session.sessionId, turnId: 'one' })
    expect(events.some(event => event.type === 'done')).toBe(true)
    expect(JSON.stringify(events)).not.toContain(token)
  } finally { service.close() }
})
