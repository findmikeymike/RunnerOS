import { expect, test } from 'bun:test'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { LlmConnection } from '@craft-agent/shared/config/llm-connections'
import { ArtistManagerVoiceFocusService, type VoiceFocusDependencies, type VoiceFocusWorkHost } from './artist-manager-voice-focus'
import type { VoiceFocusEvent } from '../shared/artist-manager-voice-focus'
const model = { id: 'deepseek-v4-flash', name: 'fixture', api: 'openai-completions', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', reasoning: true, input: ['text'], contextWindow: 32000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<Api>
async function fixture(enabled = true, launch?: VoiceFocusWorkHost['launch'], handshake = true, focus?: { modes: Array<{ id: string; label: string }>; selected?: string }, proposalTool = 'propose_background_draft') {
  const launched: Parameters<VoiceFocusWorkHost['launch']>[0][] = [], requests: Parameters<VoiceFocusDependencies['stream']>[] = []
  const service = new ArtistManagerVoiceFocusService({
    resolveConfig: async () => ({ connection: { slug: 'test', providerType: 'pi', authType: 'api_key' } as LlmConnection, model: model.id, thinking: 'off' }),
    resolveModel: async () => model, getApiKey: async () => 'fixture',
    stream: async (...args) => { requests.push(args); return (async function* () {
      if (requests.length === 1) {
        yield { type: 'toolcall_end', toolCall: { name: proposalTool, arguments: { agentSlug: 'scriptwriter', taskTitle: 'a teaser', brief: 'Draft a short teaser for the agreed track.', ...(focus?.selected ? { taskModeId: focus.selected } : {}) } } }
        yield { type: 'done', reason: 'toolUse' }
      } else { yield { type: 'toolcall_end', toolCall: { name: 'voice_reply', arguments: { text: 'Rhythm gives music its sense of motion.' } } }; yield { type: 'done', reason: 'toolUse' } }
    })() },
  }, undefined, { enabled: () => enabled, launch: async input => { launched.push(input); return launch ? launch(input) : { taskId: 'task-1', state: 'running' } } })
  const session = await service.register(1, { workspaceId: 'workspace', systemPrompt: 'Current artist context', thinking: 'off', ...(handshake ? { workBridgeVersion: 1 as const } : {}), handoffTargets: [{ slug: 'scriptwriter', name: 'Scriptwriter', ...(focus ? { taskModes: focus.modes } : {}) }] })
  async function turn(id: string, text: string) { const events: VoiceFocusEvent[] = []; await service.startTurn(1, { sessionId: session.sessionId, turnId: id, text }, e => events.push(e)); return events }
  return { service, session, launched, requests, turn }
}
test('draft proposal needs explicit confirmation; admission keeps the call open for unrelated exchange', async () => {
  const f = await fixture(); const offer = await f.turn('1', 'Have the scriptwriter draft a teaser')
  expect(f.launched).toHaveLength(0); expect(offer.some(e => e.type === 'handoff_ready')).toBe(false)
  const admitted = await f.turn('2', 'Yes please'); expect(f.launched).toHaveLength(1)
  expect(admitted.some(e => e.type === 'work_admitted')).toBe(true); expect(admitted.some(e => e.type === 'handoff_ready')).toBe(false)
  const unrelated = await f.turn('3', 'Tell me about rhythm'); expect(unrelated.some(e => e.type === 'done')).toBe(true)
  const options = f.requests[0]![2]; expect(options.onPayload?.({ thinking: { type: 'disabled' }, tools: ['voice_reply', 'open_command_chat', 'propose_background_draft'].map(name => ({ type: 'function', function: { name } })) }, model)).toMatchObject({ tool_choice: 'required' })
})
for (const handshake of [true, false]) test(`disabled capability cannot dispatch; handshake=${handshake}`, async () => {
  const f = await fixture(!handshake, undefined, handshake); expect(f.session.nativeTasks).toBeUndefined()
  const offer = await f.turn('1', 'Draft something'); expect(offer.some(e => e.type === 'error')).toBe(true)
  await f.turn('2', 'yes'); expect(f.launched).toHaveLength(0)
})
test('lost admission outcome retains original retry identity and never claims started', async () => {
  const f = await fixture(true, async () => { throw new Error('reply lost') }); await f.turn('1', 'Draft a teaser')
  const failed = await f.turn('2', 'yes'); expect(failed.some(e => e.type === 'work_admitted')).toBe(false)
  await f.turn('3', 'yes'); expect(f.launched[1]!.proposal.id).toBe(f.launched[0]!.proposal.id)
})
test('cancelling speech while admission is pending does not abort background admission', async () => {
  let finish!: () => void; let completed = false
  const wait = new Promise<void>(resolve => finish = resolve)
  const f = await fixture(true, async () => { await wait; completed = true; return { taskId: 'task-1', state: 'running' } })
  await f.turn('1', 'Draft a teaser'); const confirming = f.turn('2', 'yes')
  for (let i = 0; i < 10; i++) await Promise.resolve()
  f.service.cancel(1, { sessionId: f.session.sessionId, turnId: '2' }); finish()
  const events = await confirming; expect(completed).toBe(true); expect(events.some(e => e.type === 'handoff_ready')).toBe(false)
})

test('speech prompt describes the available draft tool without a contradictory two-tool choice', async () => {
  const f = await fixture(); await f.turn('offer', 'Draft teaser')
  expect(f.requests[0]![1].systemPrompt).toContain('propose_background_draft only when that tool is available')
})
test('timed-out admission preserves the existing outcome through unrelated speech and later confirmation', async () => {
  let resolve!: () => void; const pending = new Promise<void>(r => resolve = r)
  const f = await fixture(true, async () => { await pending; return { taskId: 'task-1', state: 'running' } })
  ;(f.service as any).deps.timeoutMs = 5
  await f.turn('offer', 'Draft teaser')
  const timedOut = await f.turn('confirm', 'yes')
  expect(timedOut.some(e => e.type === 'error' && e.message.includes('existing task status'))).toBe(true)
  expect(timedOut.some(e => e.type === 'error' && e.message.includes('Please try again'))).toBe(false)
  resolve(); for (let i = 0; i < 10; i++) await Promise.resolve()
  await f.turn('unrelated', 'Tell me about rhythm')
  expect(f.requests.at(-1)![1].tools?.map(t => t.name)).not.toContain('propose_background_draft')
  const reconciled = await f.turn('retry', 'yes')
  expect(f.launched).toHaveLength(1)
  expect(reconciled.some(e => e.type === 'work_admitted' && e.taskId === 'task-1')).toBe(true)
})
test('late admission failure after timeout retries only its original identity', async () => {
  let reject!: () => void; const pending = new Promise<void>((_r, fail) => reject = () => fail(new Error('lost result')))
  let calls = 0
  const f = await fixture(true, async () => { if (++calls === 1) await pending; return { taskId: 'task-1', state: 'running' } })
  ;(f.service as any).deps.timeoutMs = 5
  await f.turn('offer', 'Draft teaser'); await f.turn('confirm', 'yes')
  reject(); for (let i = 0; i < 10; i++) await Promise.resolve()
  const retry = await f.turn('retry', 'yes')
  expect(f.launched).toHaveLength(2)
  expect(f.launched[1]!.proposal.id).toBe(f.launched[0]!.proposal.id)
  expect(retry.some(e => e.type === 'work_admitted')).toBe(true)
})
test('barge-in during admission shares the in-flight attempt with subsequent confirmation', async () => {
  let resolve!: () => void; const pending = new Promise<void>(r => resolve = r)
  const f = await fixture(true, async () => { await pending; return { taskId: 'task-1', state: 'running' } })
  await f.turn('offer', 'Draft teaser'); const interrupted = f.turn('confirm', 'yes')
  for (let i = 0; i < 10; i++) await Promise.resolve()
  f.service.cancel(1, { sessionId: f.session.sessionId, turnId: 'confirm' }); await interrupted
  const reconfirming = f.turn('retry', 'yes')
  for (let i = 0; i < 10; i++) await Promise.resolve()
  expect(f.launched).toHaveLength(1)
  resolve(); const events = await reconfirming
  expect(f.launched).toHaveLength(1)
  expect(events.some(e => e.type === 'work_admitted')).toBe(true)
})

test('native multi-focus proposal names the selected mode in confirmation and carries its exact id', async () => {
  const f = await fixture(true, undefined, true, { modes: [{ id: 'youtube', label: 'YouTube' }, { id: 'short-form', label: 'Reels / TikTok' }], selected: 'short-form' })
  const offer = await f.turn('offer', 'Draft a Reels teaser')
  expect(offer.some(e => e.type === 'text_delta' && e.delta.includes('using Reels / TikTok'))).toBe(true)
  await f.turn('confirm', 'yes')
  expect(f.launched[0]!.proposal).toMatchObject({ taskModeId: 'short-form', taskModeLabel: 'Reels / TikTok' })
})
for (const selected of [undefined, 'other-mode']) test(`multi-focus draft cannot launch without an exact captured selection: ${selected}`, async () => {
  const f = await fixture(true, undefined, true, { modes: [{ id: 'youtube', label: 'YouTube' }, { id: 'short-form', label: 'Reels / TikTok' }], selected })
  const offer = await f.turn('offer', 'Draft a teaser')
  expect(offer.some(e => e.type === 'error')).toBe(true)
  await f.turn('confirm', 'yes'); expect(f.launched).toHaveLength(0)
})

test('verified result enters focused model history once as assistant, never fake user speech', async () => {
  const f = await fixture()
  f.service.recordWorkDelivery(1, f.session.sessionId, 'delivery', 'Your teaser draft is saved.')
  f.service.recordWorkDelivery(1, f.session.sessionId, 'delivery', 'Your teaser draft is saved.')
  await f.turn('ordinary', 'Tell me about rhythm')
  const messages = f.requests[0]![1].messages
  expect(messages.filter(m => m.role === 'assistant')).toHaveLength(1)
  expect(messages.filter(m => m.role === 'user')).toEqual([expect.objectContaining({content:'Tell me about rhythm'})])
  expect(() => f.service.recordWorkDelivery(2, f.session.sessionId, 'foreign', 'Wrong workspace')).toThrow()
})

test('unresolved persisted requests suppress replacement draft proposals on a new focus', async () => {
  const f = await fixture()
  ;(f.service as any).work.context = async () => ({text:'Host facts: prior request needs reconciliation.',unresolved:true})
  await f.turn('new-call', 'Please retry the draft')
  expect(f.requests[0]![1].tools?.map(t=>t.name)).not.toContain('propose_background_draft')
  expect(f.requests[0]![1].systemPrompt).toContain('prior request needs reconciliation')
  expect(f.launched).toHaveLength(0)
})

for (const assent of ['confirm', 'Confirm.', 'I confirm', 'confirm it']) test(`explicit ${assent} admits the offered draft once without closing the call`, async () => {
  const f = await fixture()
  await f.turn('offer', 'Have Scriptwriter draft a teaser')
  const admitted = await f.turn('confirm', assent)
  expect(f.launched).toHaveLength(1)
  expect(admitted.some(e => e.type === 'work_admitted')).toBe(true)
  expect(admitted.some(e => e.type === 'handoff_ready')).toBe(false)
  await f.turn('repeat', assent)
  expect(f.launched).toHaveLength(1)
})
for (const text of ['do not confirm', 'confirm?', 'confirm after I review it']) test(`qualified confirmation does not admit work: ${text}`, async () => {
  const f = await fixture()
  await f.turn('offer', 'Have Scriptwriter draft a teaser')
  await f.turn('reply', text)
  expect(f.launched).toHaveLength(0)
})

for (const route of ['background', 'command']) test(`native-capable call preserves distinct ${route} confirmation effects`, async () => {
  const f = await fixture(true, undefined, true, undefined, route === 'background' ? 'propose_background_draft' : 'open_command_chat')
  const offered = await f.turn('offer', route === 'background' ? 'Ask Scriptwriter to draft a short-form script' : 'Open Scriptwriter so I can work with him')
  expect(offered.some(e => e.type === 'text_delta' && e.delta.includes(route === 'background' ? 'while we keep talking' : 'open Command'))).toBe(true)
  const context = f.requests[0]![1]
  expect(context.systemPrompt).toContain('local draft requests default to propose_background_draft')
  expect(context.tools?.find(t => t.name === 'open_command_chat')?.description).toContain('only when the artist explicitly requests Command')
  const confirmed = await f.turn('confirm', 'confirm')
  expect(confirmed.some(e => e.type === 'handoff_ready')).toBe(route === 'command')
  expect(confirmed.some(e => e.type === 'work_admitted')).toBe(route === 'background')
  expect(f.launched).toHaveLength(route === 'background' ? 1 : 0)
})
