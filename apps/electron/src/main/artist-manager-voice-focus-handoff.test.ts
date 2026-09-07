import { describe, expect, test } from 'bun:test'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import { ArtistManagerVoiceFocusService, type VoiceFocusDependencies, type VoiceFocusDiagnostic } from './artist-manager-voice-focus'
import type { VoiceFocusEvent } from '../shared/artist-manager-voice-focus'

type ProviderEvent = Awaited<ReturnType<VoiceFocusDependencies['stream']>> extends AsyncIterable<infer E> ? E : never
const model = {
  id: 'deepseek-v4-flash', name: 'Test', api: 'openai-completions', provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com', reasoning: true, input: ['text'],
  contextWindow: 32000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<Api>
const connection = { slug: 'configured-connection', name: 'Test', providerType: 'pi', authType: 'api_key', createdAt: 0 } as LlmConnection
const registration = {
  workspaceId: 'workspace', systemPrompt: 'Authorized current context', model: 'pi/deepseek-v4-flash', thinking: 'off' as const,
  handoffTargets: [{ slug: 'release-manager', name: 'Release Manager', description: 'Release planning' }],
}
const argumentsForHandoff = { agentSlug: 'release-manager', taskTitle: 'Prepare release checklist', brief: 'Use our agreed release date. Artwork remains missing; draft a checklist for review.' }
const toolEnd: ProviderEvent = { type: 'toolcall_end', toolCall: { name: 'open_command_chat', arguments: argumentsForHandoff } }
const toolDone: ProviderEvent = { type: 'done', reason: 'toolUse' }
const ordinary: ProviderEvent[] = [{ type: 'text_delta', delta: 'What would you like to work on?' }, { type: 'done', reason: 'stop' }]

async function fixture(firstResponse: ProviderEvent[] | (() => AsyncIterable<ProviderEvent>) = [toolEnd, toolDone], intent: string | (() => AsyncIterable<ProviderEvent>) = 'continue', route: { model?: Partial<Model<Api>>; thinking?: 'off' | 'low'; handoffTargets?: typeof registration.handoffTargets } = {}) {
  const selectedModel = { ...model, ...route.model } as Model<Api>
  const selectedRegistration = { ...registration, model: `pi/${selectedModel.id}`, thinking: route.thinking ?? registration.thinking, handoffTargets: route.handoffTargets ?? registration.handoffTargets }
  const requests: Parameters<VoiceFocusDependencies['stream']>[] = []
  let credentials = 0
  const diagnostics: VoiceFocusDiagnostic[] = []
  const service = new ArtistManagerVoiceFocusService({
    async resolveConfig() { return { connection, model: selectedRegistration.model } },
    async resolveModel() { return selectedModel },
    async getApiKey() { credentials++; return 'credential-canary' },
    async stream(...args) {
      requests.push(args)
      if (args[2].maxTokens === 128 && typeof intent === 'function') return intent()
      if (args[2].maxTokens === 128) return (async function* () {
        yield { type: 'text_delta', delta: intent as string }; yield { type: 'done', reason: 'stop' }
      })()
      if (requests.length === 1 && typeof firstResponse === 'function') return firstResponse()
      const events = requests.length === 1 ? firstResponse as ProviderEvent[] : ordinary
      return (async function* () { yield* events })()
    },
  }, event => diagnostics.push(event))
  const session = await service.register(7, selectedRegistration)
  async function turn(turnId: string, text: string) {
    const events: VoiceFocusEvent[] = []
    await service.startTurn(7, { sessionId: session.sessionId, turnId, text }, event => events.push(event))
    return events
  }
  return { service, session, turn, requests, diagnostics, credentials: () => credentials }
}

function assertNoHandoff(events: VoiceFocusEvent[]) {
  expect(events.some(event => event.type === 'handoff_ready')).toBe(false)
}

describe('focused voice confirmation-gated handoff', () => {
  test('interrupting intent classification preserves the spoken offer without allowing late navigation', async () => {
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>(resolve => { started = resolve })
    const f = await fixture(undefined, async function* () {
      started()
      await gate
      yield { type: 'text_delta', delta: 'confirm' }
      yield { type: 'done', reason: 'stop' }
    })
    try {
      await f.turn('offer', 'Prepare a release checklist')
      const pending = f.turn('interrupted', 'That would be lovely, take me there')
      await ready
      f.service.cancel(7, { sessionId: f.session.sessionId, turnId: 'interrupted' })
      const interrupted = await pending
      assertNoHandoff(interrupted)
      const confirmed = await f.turn('confirm', 'Yes go')
      expect(confirmed.find(event => event.type === 'handoff_ready')).toMatchObject({ proposal: argumentsForHandoff })
      release()
      await new Promise(resolve => setTimeout(resolve, 0))
      assertNoHandoff(interrupted)
      expect(f.requests).toHaveLength(2)
    } finally { release(); f.service.close() }
  })

  test('natural agreement outside the fast phrase list confirms the existing destination and brief', async () => {
    const f = await fixture(undefined, 'confirm')
    try {
      await f.turn('offer', 'Prepare the release checklist')
      const confirmed = await f.turn('confirm', "That would be perfect, take me over there when you're ready")
      expect(confirmed.find(event => event.type === 'handoff_ready')).toMatchObject({ proposal: argumentsForHandoff })
      expect(f.requests).toHaveLength(2)
      expect(f.requests[1]![1].tools).toEqual([])
      expect(f.requests[1]![1].systemPrompt).not.toContain(registration.systemPrompt)
      expect(confirmed.filter(event => event.type === 'text_delta').map(event => event.delta).join('')).not.toContain('How about')
    } finally { f.service.close() }
  })

  test('unclear reply asks a short follow-up and retains the offer for the next yes', async () => {
    const f = await fixture(undefined, 'clarify')
    try {
      await f.turn('offer', 'Prepare the release checklist')
      const unclear = await f.turn('unclear', 'Hmm, maybe that thing we talked about')
      assertNoHandoff(unclear)
      const reply = unclear.filter(event => event.type === 'text_delta').map(event => event.delta).join('')
      expect(reply).toContain('keep talking')
      expect(reply).not.toContain('How about')
      const yes = await f.turn('yes', 'Yeah')
      expect(yes.some(event => event.type === 'handoff_ready')).toBe(true)
      expect(f.requests).toHaveLength(2)
    } finally { f.service.close() }
  })

  test('continuing the conversation drops the old offer and prevents the same immediate offer loop', async () => {
    const f = await fixture(undefined, 'continue')
    try {
      await f.turn('offer', 'Prepare the release checklist')
      assertNoHandoff(await f.turn('discuss', 'Before that, what should I prioritize?'))
      expect(f.requests.at(-1)![1].systemPrompt).toContain('Do not repeat the previous handoff offer')
      expect(f.requests.at(-1)![1].tools).toEqual([])
      assertNoHandoff(await f.turn('later', 'Yes'))
    } finally { f.service.close() }
  })
  test('yes go consumes the existing offer without asking the model to offer it again', async () => {
    const f = await fixture()
    try {
      await f.turn('offer', 'Prepare a release checklist')
      const confirmed = await f.turn('confirm', 'Yes, go.')
      expect(confirmed.some(event => event.type === 'handoff_ready')).toBe(true)
      expect(f.requests).toHaveLength(1)
      expect(f.diagnostics).toContainEqual(expect.objectContaining({ stage: 'turn', pendingOffer: true, confirmation: true }))
      expect(f.diagnostics.at(-1)?.stage).toBe('confirmed')
      const log = JSON.stringify(f.diagnostics)
      expect(log).not.toContain(argumentsForHandoff.brief)
      expect(log).not.toContain('Yes, go.')
      expect(log).not.toContain('credential-canary')
    } finally { f.service.close() }
  })

  test('known proposal offers trusted task and agent; separate confirmation consumes it without another provider or credential read', async () => {
    const f = await fixture()
    try {
      const offer = await f.turn('offer', 'Help prepare my release checklist')
      expect(offer.map(event => event.type)).toEqual(['completion', 'text_delta', 'done'])
      assertNoHandoff(offer)
      const offerText = offer.filter(event => event.type === 'text_delta').map(event => event.delta).join('')
      expect(offerText).toContain('Release Manager')
      expect(offerText).toContain(argumentsForHandoff.taskTitle)
      expect(f.requests[0]![1].tools?.map(tool => tool.name)).toEqual(['voice_reply', 'open_command_chat'])
      expect(f.requests[0]![2]).toMatchObject({ toolChoice: 'auto', maxRetries: 0 })
      await expect(f.turn('offer', 'Yes')).rejects.toThrow('already submitted')
      const confirmed = await f.turn('confirm', 'Yes, sounds good.')
      expect(confirmed.map(event => event.type)).toEqual(['text_delta', 'handoff_ready', 'done'])
      const ready = confirmed.find(event => event.type === 'handoff_ready')
      expect(ready).toMatchObject({ proposal: { ...argumentsForHandoff, agentName: 'Release Manager', id: expect.any(String) } })
      expect(confirmed[0]).toMatchObject({ delta: expect.stringContaining('draft for you to review and send') })
      expect(f.requests).toHaveLength(1)
      expect(f.credentials()).toBe(1)
      await expect(f.turn('confirm', 'Yes')).rejects.toThrow('handed off')
      await expect(f.turn('another-confirm', 'Yes')).rejects.toThrow('handed off')
      expect(f.requests).toHaveLength(1)
      expect(JSON.stringify([...offer, ...confirmed])).not.toContain('credential-canary')
    } finally { f.service.close() }
  })

  test('discards an execution claim before a valid tool proposal from speech and subsequent history', async () => {
    const f = await fixture([{ type: 'text_delta', delta: 'Opening the draft now.' }, toolEnd, toolDone])
    try {
      const offer = await f.turn('offer', 'Prepare the release checklist')
      expect(offer.map(event => event.type)).toEqual(['completion', 'text_delta', 'done'])
      expect(JSON.stringify(offer)).not.toContain('Opening the draft now.')
      expect(offer.filter(event => event.type === 'text_delta').map(event => event.delta).join('')).toStartWith('How about I open Command')
      assertNoHandoff(offer)
      await f.turn('decline', 'Not now')
      expect(JSON.stringify(f.requests[1]![1].messages)).not.toContain('Opening the draft now.')
    } finally { f.service.close() }
  })

  test('holds ordinary text until successful provider completion when the handoff tool is available', async () => {
    let release!: () => void
    let reachedText!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const textReached = new Promise<void>(resolve => { reachedText = resolve })
    const f = await fixture(async function* () {
      yield { type: 'text_delta', delta: 'Keep a consistent palette. ' }
      reachedText()
      await gate
      yield { type: 'text_delta', delta: 'Repeat it across your artwork.' }
      yield { type: 'done', reason: 'stop' }
    })
    const events: VoiceFocusEvent[] = []
    try {
      const pending = f.service.startTurn(7, { sessionId: f.session.sessionId, turnId: 'ordinary', text: 'Brand advice?' }, event => events.push(event))
      await textReached
      expect(events).toEqual([])
      release()
      await pending
      expect(events.map(event => event.type)).toEqual(['completion', 'text_delta', 'done'])
      expect(events[1]).toMatchObject({ delta: 'Keep a consistent palette. Repeat it across your artwork.' })
      assertNoHandoff(events)
    } finally { release(); f.service.close() }
  })

  test('generic yes without a pending proposal uses the provider and cannot hand off', async () => {
    const f = await fixture(ordinary)
    try {
      assertNoHandoff(await f.turn('yes', 'Yes, sounds good'))
      expect(f.requests).toHaveLength(1)
      expect(f.credentials()).toBe(1)
    } finally { f.service.close() }
  })

  test('qualified assent clears the offer so a later yes cannot revive it', async () => {
    const f = await fixture()
    try {
      await f.turn('offer', 'Prepare a checklist')
      assertNoHandoff(await f.turn('decline', 'Yes, but not now'))
      assertNoHandoff(await f.turn('later', 'Yes'))
      expect(f.requests).toHaveLength(4)
      expect(f.credentials()).toBe(3)
    } finally { f.service.close() }
  })

  const invalidResponses: Record<string, ProviderEvent[]> = {
    'unknown agent': [{ ...toolEnd, toolCall: { name: 'open_command_chat', arguments: { ...argumentsForHandoff, agentSlug: 'untrusted-agent' } } }, toolDone],
    'extra arguments': [{ ...toolEnd, toolCall: { name: 'open_command_chat', arguments: { ...argumentsForHandoff, autoSend: true } } }, toolDone],
    'missing arguments': [{ ...toolEnd, toolCall: { name: 'open_command_chat', arguments: { agentSlug: 'release-manager' } } }, toolDone],
    'unknown tool': [{ ...toolEnd, toolCall: { name: 'execute_work', arguments: argumentsForHandoff } }, toolDone],
    'multiple completed tool calls': [toolEnd, toolEnd, toolDone],
    'multiple started tool calls': [{ type: 'toolcall_start' }, { type: 'toolcall_start' }, toolEnd, toolDone],
    'length completion': [toolEnd, { type: 'done', reason: 'length' }],
    'incorrect stop completion': [toolEnd, { type: 'done', reason: 'stop' }],
    'provider error': [toolEnd, { type: 'error' }],
    'missing completion': [toolEnd],
  }
  for (const [name, response] of Object.entries(invalidResponses)) {
    test(`${name} cannot create a pending or confirmed handoff`, async () => {
      const f = await fixture(response)
      try {
        const failed = await f.turn('offer', 'Open a release checklist')
        assertNoHandoff(failed)
        expect(failed.some(event => event.type === 'error')).toBe(true)
        expect(failed.some(event => event.type === 'done')).toBe(false)
        assertNoHandoff(await f.turn('confirm', 'Yes please'))
        expect(f.requests).toHaveLength(2)
        expect(f.credentials()).toBe(2)
      } finally { f.service.close() }
    })
  }

  test('interrupted proposal cannot become pending even when its completion arrives late', async () => {
    let release!: () => void
    let sawTool!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const reachedTool = new Promise<void>(resolve => { sawTool = resolve })
    const f = await fixture(async function* () {
      yield toolEnd
      sawTool()
      await gate
      yield toolDone
    })
    try {
      const pending = f.turn('interrupted', 'Prepare a release checklist')
      await reachedTool
      f.service.cancel(7, { sessionId: f.session.sessionId, turnId: 'interrupted' })
      const events = await pending
      assertNoHandoff(events)
      expect(events.some(event => event.type === 'done')).toBe(false)
      release()
      await new Promise(resolve => setTimeout(resolve, 0))
      assertNoHandoff(await f.turn('confirm', 'Yes'))
      expect(f.requests).toHaveLength(2)
    } finally { release(); f.service.close() }
  })
})

function spokenText(events: VoiceFocusEvent[]): string {
  return events.filter(event => event.type === 'text_delta').map(event => event.delta).join('')
}

function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

function speechPartial(text: string, type = 'toolcall_delta'): ProviderEvent {
  return { type, contentIndex: 0, partial: { content: [{ type: 'toolCall', name: 'voice_reply', arguments: { text } }] } }
}
function speechEnd(text: string): ProviderEvent {
  return { type: 'toolcall_end', toolCall: { name: 'voice_reply', arguments: { text } } }
}

describe('focused voice structural speech response', () => {
  test('streams parsed speech arguments before completion without duplicate text or tool data in history', async () => {
    const earlyText = barrier(), finish = barrier()
    const first = 'Keep the palette consistent. '
    const complete = first + 'Repeat it across the artwork.'
    const f = await fixture(async function* () {
      yield speechPartial(first, 'toolcall_start')
      earlyText.release()
      await finish.promise
      yield speechPartial(first)
      yield speechPartial(complete)
      yield speechEnd(complete)
      yield { type: 'done', reason: 'toolUse' }
      yield { type: 'done', reason: 'toolUse' }
    })
    const events: VoiceFocusEvent[] = []
    try {
      const pending = f.service.startTurn(7, { sessionId: f.session.sessionId, turnId: 'speak', text: 'Brand advice?' }, event => events.push(event))
      await earlyText.promise
      expect(spokenText(events)).toBe(first)
      expect(events.some(event => event.type === 'completion' || event.type === 'done')).toBe(false)
      finish.release()
      await pending
      expect(spokenText(events)).toBe(complete)
      expect(events.filter(event => event.type === 'done')).toHaveLength(1)
      assertNoHandoff(events)
      await f.turn('follow-up', 'Tell me more')
      const messages = f.requests[1]![1].messages
      expect(messages).toHaveLength(3)
      expect(messages[1]!.content).toEqual([{ type: 'text', text: complete }])
      expect(JSON.stringify(messages)).not.toContain('voice_reply')
      expect(JSON.stringify(events)).not.toContain('arguments')
    } finally { finish.release(); f.service.close() }
  })

  test('a speech envelope first received complete delivers once without a second provider call', async () => {
    const f = await fixture([speechEnd('Keep it simple.'), toolDone])
    try {
      const events = await f.turn('speak', 'Brand advice?')
      expect(spokenText(events)).toBe('Keep it simple.')
      expect(events.filter(event => event.type === 'done')).toHaveLength(1)
      expect(f.requests).toHaveLength(1)
      assertNoHandoff(events)
    } finally { f.service.close() }
  })

  const invalidSpeech: Record<string, ProviderEvent[]> = {
    'empty speech': [speechEnd(''), toolDone],
    'missing text': [{ type: 'toolcall_end', toolCall: { name: 'voice_reply', arguments: {} } }, toolDone],
    'non-string text': [{ type: 'toolcall_end', toolCall: { name: 'voice_reply', arguments: { text: 42 } } }, toolDone],
    'extra final arguments': [{ type: 'toolcall_end', toolCall: { name: 'voice_reply', arguments: { text: 'Advice', execute: true } } }, toolDone],
    'wrong completion reason': [speechEnd('Advice'), { type: 'done', reason: 'stop' }],
  }
  for (const [name, response] of Object.entries(invalidSpeech)) {
    test(`${name} cannot complete a response or enter history`, async () => {
      const f = await fixture(response)
      try {
        const events = await f.turn('failed', 'Brand advice?')
        expect(events.some(event => event.type === 'error')).toBe(true)
        expect(events.some(event => event.type === 'done')).toBe(false)
        assertNoHandoff(events)
        await f.turn('next', 'Try again')
        expect(f.requests[1]![1].messages).toHaveLength(1)
      } finally { f.service.close() }
    })
  }

  const failedTails: Record<string, ProviderEvent[]> = {
    'text rollback': [speechPartial('Keep'), speechEnd('Keep'), toolDone],
    'text replacement': [speechPartial('Change it entirely.'), speechEnd('Change it entirely.'), toolDone],
    'final text contradicts the streamed prefix': [speechEnd('A different answer.'), toolDone],
    'late handoff': [{ type: 'toolcall_start' }, toolEnd, toolDone],
    'late handoff without start': [toolEnd, toolDone],
    'second speech tool': [speechEnd('Keep the artwork simple.'), { type: 'toolcall_start', contentIndex: 1, partial: { content: [{ type: 'toolCall', name: 'voice_reply', arguments: { text: 'Keep the artwork simple.' } }, { type: 'toolCall', name: 'voice_reply', arguments: { text: 'Second answer.' } }] } }, speechEnd('Second answer.'), toolDone],
    'invalid final after partial': [{ type: 'toolcall_end', toolCall: { name: 'voice_reply', arguments: { wrongkey: 'Keep the artwork simple.' } } }, toolDone],
    'provider error': [{ type: 'error' }],
    'truncated completion': [speechEnd('Keep the artwork simple.'), { type: 'done', reason: 'length' }],
    'missing completion': [],
  }
  for (const [name, tail] of Object.entries(failedTails)) {
    test(`${name} after early speech cannot hand off, succeed, or enter history`, async () => {
      const f = await fixture([speechPartial('Keep the artwork simple.', 'toolcall_start'), ...tail])
      try {
        const events = await f.turn('failed', 'Brand advice?')
        expect(spokenText(events)).toBe('Keep the artwork simple.')
        expect(events.some(event => event.type === 'error')).toBe(true)
        expect(events.some(event => event.type === 'done')).toBe(false)
        assertNoHandoff(events)
        assertNoHandoff(await f.turn('after', 'Yes go'))
        expect(f.requests[1]![1].messages).toHaveLength(1)
      } finally { f.service.close() }
    })
  }

  test('handoff followed by a speech tool cannot produce an offer or speech', async () => {
    const f = await fixture([{ type: 'toolcall_start' }, toolEnd, speechPartial('Opening it now.', 'toolcall_start'), speechEnd('Opening it now.'), toolDone])
    try {
      const events = await f.turn('mixed', 'Prepare a checklist')
      expect(spokenText(events)).toBe('')
      expect(events.some(event => event.type === 'error')).toBe(true)
      expect(events.some(event => event.type === 'done')).toBe(false)
      assertNoHandoff(events)
      assertNoHandoff(await f.turn('after', 'Yes go'))
      expect(f.requests[1]![1].messages).toHaveLength(1)
    } finally { f.service.close() }
  })

  test('cancellation after early speech rejects late arguments and leaves no successful history', async () => {
    const earlyText = barrier(), finish = barrier()
    const f = await fixture(async function* () {
      yield speechPartial('Keep the artwork simple.', 'toolcall_start')
      earlyText.release()
      await finish.promise
      yield speechPartial('Keep the artwork simple. This should never arrive.')
      yield speechEnd('Keep the artwork simple. This should never arrive.')
      yield toolDone
    })
    const events: VoiceFocusEvent[] = []
    try {
      const pending = f.service.startTurn(7, { sessionId: f.session.sessionId, turnId: 'cancelled', text: 'Brand advice?' }, event => events.push(event))
      await earlyText.promise
      expect(spokenText(events)).toBe('Keep the artwork simple.')
      f.service.cancel(7, { sessionId: f.session.sessionId, turnId: 'cancelled' })
      await pending
      const count = events.length
      finish.release()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(events).toHaveLength(count)
      expect(events.some(event => event.type === 'done')).toBe(false)
      assertNoHandoff(events)
      assertNoHandoff(await f.turn('after', 'Yes go'))
      expect(f.requests[1]![1].messages).toHaveLength(1)
    } finally { finish.release(); f.service.close() }
  })
})

describe('structural voice tested-route gate', () => {
  test('only the tested route receives a required single-tool payload without mutating the SDK payload', async () => {
    const f = await fixture(ordinary)
    try {
      await f.turn('speak', 'Brand advice?')
      const [selected, context, options] = f.requests[0]!
      expect(context.tools?.map(tool => tool.name)).toEqual(['voice_reply', 'open_command_chat'])
      expect(options.toolChoice).toBe('auto')
      expect(options.reasoning).toBeUndefined()
      expect(options.onPayload).toBeFunction()
      const payload = { model: selected.id, thinking: { type: 'disabled' }, stream: true, max_tokens: 512, tool_choice: 'auto', tools: context.tools!.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) }
      const original = structuredClone(payload)
      const adjusted = await options.onPayload!(payload, selected)
      expect(adjusted).toEqual({ ...original, tool_choice: 'required', parallel_tool_calls: false })
      expect(payload).toEqual(original)
    } finally { f.service.close() }
  })

  const untestedRoutes: Record<string, Parameters<typeof fixture>[2]> = {
    'reasoning low': { thinking: 'low' },
    'custom endpoint': { model: { baseUrl: 'https://proxy.example.test/v1' } },
    'untested official endpoint path': { model: { baseUrl: 'https://api.deepseek.com/custom' } },
    'other model': { model: { id: 'deepseek-v4-pro' } },
    'other provider': { model: { provider: 'openrouter' } },
    'other API': { model: { api: 'openai-responses' } },
    'Anthropic reasoning': { model: { api: 'anthropic-messages', provider: 'anthropic', id: 'claude-haiku-4-5', baseUrl: 'https://api.anthropic.com' }, thinking: 'low' },
  }
  for (const [name, route] of Object.entries(untestedRoutes)) {
    test(`${name} keeps the existing single handoff tool and SDK reasoning settings`, async () => {
      const f = await fixture(ordinary, 'continue', route)
      try {
        await f.turn('speak', 'Brand advice?')
        const [, context, options] = f.requests[0]!
        expect(context.tools?.map(tool => tool.name)).toEqual(['open_command_chat'])
        expect(options.toolChoice).toBe('auto')
        expect(options.onPayload).toBeUndefined()
        expect(options.reasoning).toBe(route?.thinking === 'low' ? 'low' : undefined)
      } finally { f.service.close() }
    })
  }

  test('no handoff destinations means no speech envelope or required override', async () => {
    const f = await fixture(ordinary, 'continue', { handoffTargets: [] })
    try {
      await f.turn('speak', 'Brand advice?')
      expect(f.requests[0]![1].tools).toEqual([])
      expect(f.requests[0]![2].toolChoice).toBe('none')
      expect(f.requests[0]![2].onPayload).toBeUndefined()
    } finally { f.service.close() }
  })

  test('payload override rejects malformed or changed tool surfaces', async () => {
    const f = await fixture(ordinary)
    try {
      await f.turn('speak', 'Brand advice?')
      const [selected, , options] = f.requests[0]!
      const speech = { type: 'function', function: { name: 'voice_reply' } }
      const handoff = { type: 'function', function: { name: 'open_command_chat' } }
      for (const payload of [null, [], 'payload', {}, { tools: null }, { tools: [] }, { tools: [speech] }, { tools: [speech, speech] }, { tools: [speech, handoff, { type: 'function', function: { name: 'execute_work' } }] }, { tools: [speech, { type: 'function', function: { name: 'execute_work' } }] }, { tools: [speech, null] }]) {
        await expect(Promise.resolve().then(() => options.onPayload!(payload, selected))).rejects.toThrow()
      }
    } finally { f.service.close() }
  })

  test('Yeah, do it consumes the existing offer without another provider request', async () => {
    const f = await fixture()
    try {
      await f.turn('offer', 'Prepare a checklist')
      const events = await f.turn('confirm', 'Yeah, do it.')
      expect(events.find(event => event.type === 'handoff_ready')).toMatchObject({ proposal: argumentsForHandoff })
      expect(f.requests).toHaveLength(1)
      expect(f.credentials()).toBe(1)
    } finally { f.service.close() }
  })
})
