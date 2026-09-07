import { describe, expect, it } from 'bun:test'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import { DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS } from '@craft-agent/shared/config/artist-manager-voice-settings'
import { ArtistManagerVoiceFocusService, resolveSavedVoiceFocusConfig, validateVoiceSettingsRoute, type VoiceFocusDependencies } from './artist-manager-voice-focus'
import { VOICE_FOCUS_LIMITS, type VoiceFocusEvent } from '../shared/artist-manager-voice-focus'

const model = {
  id: 'test-model', name: 'Test', api: 'openai-completions', provider: 'test-provider',
  baseUrl: 'https://voice.example.test/v1', reasoning: true, input: ['text'],
  contextWindow: 32000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>
const connection = { slug: 'configured-connection', name: 'Test', providerType: 'pi', authType: 'api_key', createdAt: 0 } as LlmConnection
const registration = { workspaceId: 'workspace', systemPrompt: 'Authorized current context', model: 'pi/test-model', thinking: 'low' as const }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fixture(overrides: Partial<VoiceFocusDependencies> = {}) {
  const requests: Parameters<VoiceFocusDependencies['stream']>[] = []
  let credentialReads = 0
  const deps: VoiceFocusDependencies = {
    async resolveConfig() { return { connection, model: registration.model } },
    async resolveModel() { return model },
    async getApiKey() { credentialReads++; return 'private-api-key-canary' },
    async stream(...args) {
      requests.push(args)
      return (async function* () { yield { type: 'text_delta', delta: 'A direct answer.' }; yield { type: 'done', reason: 'stop' } })()
    },
    ...overrides,
  }
  return { service: new ArtistManagerVoiceFocusService(deps), requests, credentials: () => credentialReads }
}

describe('focused voice service', () => {
  it('keeps an opening greeting free of artist stats, then restores context and destinations for real work', async () => {
    const { service, requests } = fixture()
    const snapshot = 'Private artist snapshot: Doin Me has 180k streams.'
    const session = await service.register(7, { ...registration, systemPrompt: snapshot,
      handoffTargets: [{ slug: 'creative-director', name: 'Creative Director', description: 'Creative campaigns and video concepts' }],
    })
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'hello', text: 'Um, hey! How are you?' }, () => {})
    expect(requests[0]![1].systemPrompt).not.toContain(snapshot)
    expect(requests[0]![1].systemPrompt).toContain('Artist Manager')
    expect(requests[0]![1].tools).toEqual([])
    expect(requests[0]![2].toolChoice).toBe('none')
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'work', text: "What's a great agent for creative campaigns and video content for a release?" }, () => {})
    expect(requests[1]![1].systemPrompt).toBe(snapshot)
    expect(requests[1]![1].tools?.[0]?.description).toContain('Creative Director')
    expect(requests[1]![1].messages).toHaveLength(3)
    expect(requests[1]![0]).toEqual(requests[0]![0])
    service.close()
  })

  it('does not strip context from substantive first questions beginning with greetings or fillers', async () => {
    for (const text of [
      "Um hey what's a great agent for me to use if i need to work on um like really creative campaigns and ideas for um video content for a release",
      'Hello, what should I do next?', 'How are you helping my release?', 'Hey, show my streaming stats',
    ]) {
      const { service, requests } = fixture()
      const session = await service.register(7, { ...registration,
        handoffTargets: [{ slug: 'creative-director', name: 'Creative Director' }],
      })
      await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text }, () => {})
      expect(requests[0]![1].systemPrompt).toBe(registration.systemPrompt)
      expect(requests[0]![1].tools).toHaveLength(1)
      service.close()
    }
  })

  it('streams without tools/executor, retries, fallback, or credentials in public messages', async () => {
    const { service, requests } = fixture()
    const session = await service.register(7, registration)
    const events: VoiceFocusEvent[] = []
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, event => events.push(event))
    expect(events.map(event => event.type)).toEqual(['text_delta', 'completion', 'done'])
    expect(requests).toHaveLength(1)
    expect(requests[0]![0].id).toBe('test-model')
    expect(requests[0]![1].tools).toEqual([])
    expect(requests[0]![1].messages).toHaveLength(1)
    expect(requests[0]![2]).toMatchObject({ toolChoice: 'none', maxRetries: 0, reasoning: 'low', maxTokens: 2048, apiKey: 'private-api-key-canary' })
    expect(JSON.stringify({ session, events })).not.toContain('private-api-key-canary')
    service.close()
  })

  it('preserves exact model selection and rejects OAuth or unsupported protocols before any provider call', async () => {
    for (const overrides of [
      { resolveConfig: async () => ({ connection: { ...connection, authType: 'oauth' as const }, model: registration.model }) },
      { resolveModel: async () => ({ ...model, id: 'different-model' }) },
      { resolveModel: async () => ({ ...model, api: 'openai-codex-responses' as const }) },
      { resolveModel: async () => ({ ...model, baseUrl: 'https://user:secret@voice.example.test/v1' }) },
    ]) {
      const { service, requests, credentials } = fixture(overrides)
      await expect(service.register(7, registration)).rejects.toThrow()
      expect(requests).toHaveLength(0)
      expect(credentials()).toBe(0)
    }
  })

  it('keeps the non-reasoning budget at 512 tokens', async () => {
    const { service, requests } = fixture()
    const session = await service.register(7, { ...registration, thinking: 'off' })
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, () => {})
    expect(requests[0]![2]).toMatchObject({ maxTokens: 512, reasoning: undefined, maxRetries: 0 })
    service.close()
  })

  it('reports length-truncated speech ending in Can without done, successful history, or replay', async () => {
    const messagesPerRequest: number[] = []
    const { service } = fixture({ async stream(_model, context) {
      messagesPerRequest.push(context.messages.length)
      return (async function* () {
        yield { type: 'text_delta', delta: 'Here is one useful idea. Can' }
        yield { type: 'done', reason: 'length', message: { usage: { output: 512, reasoning: 482 } } }
      })()
    } })
    const session = await service.register(7, registration)
    const events: VoiceFocusEvent[] = []
    const turn = { sessionId: session.sessionId, turnId: 'one', text: 'Content ideas?' }
    await service.startTurn(7, turn, event => events.push(event))
    expect(messagesPerRequest).toEqual([1])
    expect(events).toEqual([
      { sessionId: session.sessionId, turnId: 'one', type: 'text_delta', delta: 'Here is one useful idea. Can' },
      { sessionId: session.sessionId, turnId: 'one', type: 'completion', finishReason: 'length', outputTokens: 512, reasoningTokens: 482 },
      { sessionId: session.sessionId, turnId: 'one', type: 'error', message: 'The voice reply was cut short. Please try again.' },
    ])
    await service.startTurn(7, { ...turn, turnId: 'two' }, () => {})
    expect(messagesPerRequest).toEqual([1, 1])
    service.close()
  })

  it('emits only valid completion scalars and no raw SDK payload', async () => {
    const { service } = fixture({ async stream() {
      return (async function* () {
        yield { type: 'text_delta', delta: 'Answer.' }
        yield { type: 'done', reason: 'private-reason-canary', message: { usage: { output: NaN, reasoning: -1 }, content: 'private-content-canary', errorMessage: 'private-key-canary' } }
      })()
    } })
    const session = await service.register(7, registration)
    const events: VoiceFocusEvent[] = []
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, event => events.push(event))
    expect(events[1]).toEqual({ sessionId: session.sessionId, turnId: 'one', type: 'completion', finishReason: 'other' })
    expect(events.map(event => event.type)).toEqual(['text_delta', 'completion', 'error'])
    expect(JSON.stringify(events)).not.toContain('canary')
    service.close()
  })

  it('enforces window ownership and rejects duplicate turns', async () => {
    const { service, requests } = fixture()
    const session = await service.register(7, registration)
    const turn = { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }
    await expect(service.startTurn(8, turn, () => {})).rejects.toThrow('window')
    expect(() => service.cancel(8, turn)).toThrow('window')
    expect(() => service.stop(8, session.sessionId)).toThrow('window')
    await service.startTurn(7, turn, () => {})
    await expect(service.startTurn(7, turn, () => {})).rejects.toThrow('already submitted')
    expect(requests).toHaveLength(1)
    service.close()
  })

  it('stopOwner invalidates registration that is still loading', async () => {
    const gate = deferred<void>()
    const { service } = fixture({ async resolveModel() { await gate.promise; return model } })
    const pending = service.register(7, registration)
    await tick()
    service.stopOwner(7)
    gate.resolve()
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('cancellation settles promptly, ignores late events, and cannot cancel a different turn', async () => {
    const gate = deferred<void>()
    let providerSignal: AbortSignal | undefined
    const { service } = fixture({ async stream(_model, _context, options) {
      providerSignal = options.signal
      return (async function* () {
        yield { type: 'text_delta', delta: 'First.' }
        await gate.promise
        yield { type: 'text_delta', delta: ' Late.' }
        yield { type: 'done', reason: 'stop' }
      })()
    } })
    const session = await service.register(7, registration)
    const events: VoiceFocusEvent[] = []
    const turn = { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }
    const pending = service.startTurn(7, turn, event => events.push(event))
    await tick()
    service.cancel(7, { ...turn, turnId: 'other' })
    expect(providerSignal?.aborted).toBe(false)
    service.cancel(7, turn)
    await pending
    expect(providerSignal?.aborted).toBe(true)
    gate.resolve()
    await tick()
    expect(events.map(event => event.type)).toEqual(['text_delta'])
    service.close()
  })

  it('timeout aborts a stalled provider and emits one sanitized error', async () => {
    const gate = deferred<void>()
    const { service } = fixture({ timeoutMs: 5, async stream() {
      return (async function* () { await gate.promise; yield { type: 'text_delta', delta: 'Too late' } })()
    } })
    const session = await service.register(7, registration)
    const events: VoiceFocusEvent[] = []
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, event => events.push(event))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', message: 'Voice response timed out. Please try again.' })
    gate.resolve()
    await tick()
    expect(events).toHaveLength(1)
    service.close()
  })

  it('provider failure after partial speech does not replay, substitute, or persist the failed answer', async () => {
    let calls = 0
    const seenHistory: number[] = []
    const { service } = fixture({ async stream(_model, context) {
      calls++
      seenHistory.push(context.messages.length)
      return (async function* () {
        yield { type: 'text_delta', delta: 'Partial answer' }
        throw new Error('private-api-key-canary provider response body')
      })()
    } })
    const session = await service.register(7, registration)
    const events: VoiceFocusEvent[] = []
    for (const turnId of ['one', 'two']) await service.startTurn(7, { sessionId: session.sessionId, turnId, text: 'Hello' }, event => events.push(event))
    expect(calls).toBe(2)
    expect(seenHistory).toEqual([1, 1])
    expect(events.filter(event => event.type === 'error')).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain('canary')
    service.close()
  })

  it('rejects attempted tool output and an iterator ending without completion', async () => {
    for (const type of ['toolcall_start', 'iterator-end']) {
      const { service } = fixture({ async stream() { return (async function* () { yield { type } })() } })
      const session = await service.register(7, registration)
      const events: VoiceFocusEvent[] = []
      await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, event => events.push(event))
      expect(events.map(event => event.type)).toEqual(['error'])
      service.close()
    }
  })

  it('aborts provider work even when the renderer event sink throws', async () => {
    const { service, requests } = fixture()
    const session = await service.register(7, registration)
    await service.startTurn(7, { sessionId: session.sessionId, turnId: 'one', text: 'Hello' }, () => { throw new Error('window destroyed') })
    expect(requests[0]![2].signal!.aborted).toBe(true)
    service.close()
  })

  it('refreshes bounded context while retaining only bounded successful history', async () => {
    const { service, requests } = fixture()
    const session = await service.register(7, registration)
    for (let n = 0; n < 12; n++) await service.startTurn(7, { sessionId: session.sessionId, turnId: String(n), text: 'x'.repeat(1500), systemPrompt: `Context ${n}` }, () => {})
    expect(requests.at(-1)![1].systemPrompt).toBe('Context 11')
    expect(requests.at(-1)![1].messages.length).toBeLessThanOrEqual(17)
    expect(JSON.stringify(requests.at(-1)![1].messages).length).toBeLessThan(18000)
    await expect(service.startTurn(7, { sessionId: session.sessionId, turnId: 'huge', text: 'Hello', systemPrompt: 'x'.repeat(VOICE_FOCUS_LIMITS.promptChars + 1) }, () => {})).rejects.toThrow('context')
    expect(requests).toHaveLength(12)
    service.close()
  })
})


describe('independent saved conversation voice route', () => {
  const saved = { ...DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS, connectionSlug: connection.slug, model: 'pi/test-model', thinking: 'off' as const }

  it('resolves only the saved voice connection/model/reasoning without Manager or global fallback', async () => {
    const seen: string[] = []
    const deps = { getSettings: () => saved, getConnection: (slug: string) => { seen.push(slug); return connection } }
    expect(await resolveSavedVoiceFocusConfig({}, deps)).toEqual({ connection, model: saved.model, thinking: 'off' })
    expect(await resolveSavedVoiceFocusConfig({ model: 'pi/another-model', thinking: 'low' }, deps)).toEqual({ connection, model: 'pi/another-model', thinking: 'low' })
    expect(seen).toEqual([connection.slug, connection.slug])
    expect(saved.model).toBe('pi/test-model')
    expect(saved.thinking).toBe('off')
    const { service } = fixture({ resolveConfig: request => resolveSavedVoiceFocusConfig(request, deps) })
    const session = await service.register(7, { workspaceId: 'workspace', systemPrompt: 'Context' })
    expect(session).toMatchObject({ model: saved.model, connection: connection.slug, thinking: 'off' })
    service.close()
  })

  it('unconfigured, deleted or mismatched connection cannot fall back even with a diagnostic model', async () => {
    let lookups = 0
    await expect(resolveSavedVoiceFocusConfig({ model: saved.model }, { getSettings: () => ({ ...DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS }), getConnection: () => { lookups++; return connection } })).rejects.toThrow('Settings')
    expect(lookups).toBe(0)
    for (const found of [null, { ...connection, slug: 'command-connection' }]) {
      await expect(resolveSavedVoiceFocusConfig({}, { getSettings: () => saved, getConnection: () => found })).rejects.toThrow('no longer exists')
    }
  })

  it('validates settings against the exact connection and SDK model without credentials or a provider call', async () => {
    let credentialReads = 0
    let providerCalls = 0
    const resolved: string[] = []
    const routeDeps = {
      getConnection: (slug: string) => slug === connection.slug ? connection : null,
      resolveModel: async (selected: LlmConnection, requested: string) => { resolved.push(selected.slug + ':' + requested); return model },
      getApiKey: async () => { credentialReads++; return 'must-not-read' },
      stream: async () => { providerCalls++; throw new Error('must-not-call') },
    }
    expect(await validateVoiceSettingsRoute(saved, routeDeps)).toEqual(saved)
    expect(resolved).toEqual([connection.slug + ':pi/test-model'])
    await expect(validateVoiceSettingsRoute({ ...saved, connectionSlug: 'deleted' }, routeDeps)).rejects.toThrow('no longer exists')
    await expect(validateVoiceSettingsRoute({ ...saved, model: 'pi/other-provider-model' }, routeDeps)).rejects.toThrow('exact voice model')
    expect(providerCalls).toBe(0)
    expect(credentialReads).toBe(0)
    resolved.length = 0
    expect(await validateVoiceSettingsRoute({ ...DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS }, routeDeps)).toEqual(DEFAULT_ARTIST_MANAGER_VOICE_SETTINGS)
    expect(resolved).toEqual([])
  })

  it('rejects unsupported auth, protocol and unsafe endpoint during settings validation', async () => {
    for (const candidate of [
      { connection: { ...connection, authType: 'oauth' as const }, model },
      { connection, model: { ...model, api: 'openai-codex-responses' as const } },
      { connection, model: { ...model, baseUrl: 'https://name:secret@voice.example.test/v1' } },
    ]) {
      await expect(validateVoiceSettingsRoute(saved, {
        getConnection: () => candidate.connection, resolveModel: async () => candidate.model,
      })).rejects.toThrow()
    }
  })
})
