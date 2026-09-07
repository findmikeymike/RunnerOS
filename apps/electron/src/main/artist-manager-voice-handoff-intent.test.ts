import { describe, expect, it } from 'bun:test'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { VoiceFocusDependencies } from './artist-manager-voice-focus'
import { resolveVoiceHandoffIntent } from './artist-manager-voice-handoff-intent'

const model = { id: 'exact-voice-model', provider: 'test', api: 'openai-completions' } as Model<Api>
const proposal = { id: 'offer', agentSlug: 'brand-manager', agentName: 'Brand Manager', taskTitle: 'Plan the release identity', brief: 'Private detailed snapshot must not be sent to classifier.' }
type Event = Awaited<ReturnType<VoiceFocusDependencies['stream']>> extends AsyncIterable<infer T> ? T : never
const events = (...items: Event[]): VoiceFocusDependencies['stream'] => async function* () { yield* items }
const input = (stream: VoiceFocusDependencies['stream'], extra: Partial<Parameters<typeof resolveVoiceHandoffIntent>[0]> = {}) => ({
  model, proposal, stream, apiKey: 'private-key-canary', text: 'Yeah that would be great', signal: new AbortController().signal, ...extra,
})

describe('voice handoff contextual intent', () => {
  it('uses the exact voice route with minimal offer context, no tools/reasoning/retries and bounded output', async () => {
    let request!: Parameters<VoiceFocusDependencies['stream']>
    const stream: VoiceFocusDependencies['stream'] = (...args) => {
      request = args
      return events({ type: 'text_delta', delta: 'con' }, { type: 'text_delta', delta: 'firm' }, { type: 'done', reason: 'stop' })(...args)
    }
    expect(await resolveVoiceHandoffIntent(input(stream))).toBe('confirm')
    expect(request[0]).toBe(model)
    expect(request[1].tools).toEqual([])
    expect(request[1].messages).toHaveLength(1)
    expect(JSON.parse(request[1].messages[0]!.content as string)).toEqual({ offer: { agent: proposal.agentName, task: proposal.taskTitle }, reply: 'Yeah that would be great' })
    expect(JSON.stringify(request[1])).not.toContain(proposal.brief)
    expect(JSON.stringify(request[1])).not.toContain('private-key-canary')
    expect(request[2]).toMatchObject({ maxTokens: 128, maxRetries: 0, toolChoice: 'none', apiKey: 'private-key-canary' })
    expect(request[2].reasoning).toBeUndefined()
    expect(request[2].signal?.aborted).toBe(true)
  })

  it('accepts each exact completed classifier decision', async () => {
    for (const decision of ['confirm', 'continue', 'clarify'] as const) {
      expect(await resolveVoiceHandoffIntent(input(events({ type: 'text_delta', delta: ` ${decision}\n` }, { type: 'done', reason: 'stop' })))).toBe(decision)
    }
  })

  it('requires a successful completed decision, never a partial or malformed confirmation', async () => {
    for (const sequence of [
      [{ type: 'text_delta', delta: 'confirm' }],
      [{ type: 'text_delta', delta: 'confirm' }, { type: 'done', reason: 'length' }],
      [{ type: 'text_delta', delta: 'confirm' }, { type: 'error', reason: 'failed' }],
      [{ type: 'text_delta', delta: 'confirm and execute it' }, { type: 'done', reason: 'stop' }],
      [{ type: 'text_delta', delta: '{"intent":"confirm"}' }, { type: 'done', reason: 'stop' }],
      [{ type: 'text_delta', delta: 'confirm'.repeat(20) }, { type: 'done', reason: 'stop' }],
    ]) expect(await resolveVoiceHandoffIntent(input(events(...sequence)))).toBe('clarify')
  })

  it('rejects tool output even when accompanied by a valid confirmation', async () => {
    for (const toolEvent of [{ type: 'toolcall_start' }, { type: 'toolcall_end', toolCall: { name: 'open', arguments: {} } }]) {
      expect(await resolveVoiceHandoffIntent(input(events(toolEvent, { type: 'text_delta', delta: 'confirm' }, { type: 'done', reason: 'stop' })))).toBe('clarify')
    }
  })

  it('returns clarification on provider failure without retrying', async () => {
    let calls = 0
    expect(await resolveVoiceHandoffIntent(input(async () => { calls++; throw Error('private-key-canary') }))).toBe('clarify')
    expect(calls).toBe(1)
  })

  it('does not dispatch a previously cancelled request', async () => {
    const controller = new AbortController(); controller.abort()
    let calls = 0
    expect(await resolveVoiceHandoffIntent(input(async function* () { calls++ }, { signal: controller.signal }))).toBe('clarify')
    expect(calls).toBe(0)
  })

  it('honors an explicit refusal or keep-talking request without needing the provider', async () => {
    let calls = 0
    for (const text of ['No, thanks!', 'Not now.', "Let's keep talking."]) {
      expect(await resolveVoiceHandoffIntent(input(async () => { calls++; throw Error('offline') }, { text }))).toBe('continue')
    }
    expect(calls).toBe(0)
  })

  it('parent cancellation settles even if a provider ignores abort and returns confirmation later', async () => {
    const controller = new AbortController()
    let release!: (value: IteratorResult<Event>) => void
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const stream: VoiceFocusDependencies['stream'] = () => ({ [Symbol.asyncIterator]: () => ({ next: () => { started(); return new Promise(resolve => { release = resolve }) } }) })
    const result = resolveVoiceHandoffIntent(input(stream, { signal: controller.signal }))
    await ready; controller.abort()
    expect(await result).toBe('clarify')
    release({ done: false, value: { type: 'text_delta', delta: 'confirm' } })
    expect(await result).toBe('clarify')
  })

  it('hard deadline bounds both a hung stream factory and an iterator whose cleanup also hangs', async () => {
    const streams: VoiceFocusDependencies['stream'][] = [
      () => new Promise(() => {}),
      () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: () => new Promise(() => {}) }) }),
    ]
    for (const stream of streams) {
      const started = performance.now()
      expect(await resolveVoiceHandoffIntent(input(stream, { timeoutMs: 20 }))).toBe('clarify')
      expect(performance.now() - started).toBeLessThan(500)
    }
  })
})
