import { expect, test } from 'bun:test'
import type { VoiceTaskBridge } from '@craft-agent/server-core/voice-tasks'
import { ArtistManagerVoiceWorkService } from './artist-manager-voice-work'
function fixture() {
  let workspace = 'workspace'; const detached: unknown[] = [], launches: unknown[] = [], listeners: ((e: never) => void)[] = []
  const host = {
    bind: async () => ({ bindingId: 'binding', generation: 1, managerParentSessionId: 'parent', capabilities: { nativeTasks: true } }),
    reserveIntent: async (...args: unknown[]) => { launches.push(args); return { intentId: 'intent' } },
    launch: async (...args: unknown[]) => { launches.push(args); return { taskId: 'task', state: 'running' } },
    snapshot: async () => ({ tasks: [], intents: [], cursor: 0 }),
    detach: async (...args: unknown[]) => { detached.push(args) },
    subscribe: async (_a: unknown, _b: string, _c: number, listener: (e: never) => void) => { listeners.push(listener); return () => { detached.push('listener') } },
  }
  const service = new ArtistManagerVoiceWorkService({ bridge: () => host as unknown as VoiceTaskBridge, enabled: () => true,
    workspace: (owner, session) => { if (owner !== 1 || (session !== undefined && session !== 'focus')) throw new Error('forbidden'); return workspace } })
  return { service, host, detached, launches, listeners, switchWorkspace: () => { workspace = 'other' } }
}
test('adapter forwards only host-derived authority and rejects forged focus ownership', async () => {
  const f = fixture(); await expect(f.service.invoke(2, { sessionId: 'focus', method: 'snapshot', args: ['binding'] })).rejects.toThrow('forbidden')
  await expect(f.service.invoke(1, { sessionId: 'foreign', method: 'snapshot', args: ['binding'] })).rejects.toThrow('forbidden')
  await f.service.launch({ ownerId: 1, workspaceId: 'workspace', sessionId: 'focus', turnId: 'turn', proposal: { id: 'stable', agentSlug: 'scriptwriter', agentName: 'Scriptwriter', taskTitle: 'Teaser', brief: 'Draft teaser' } })
  expect(f.launches[0]).toMatchObject([{ ownerId: '1', workspaceId: 'workspace' }, 'binding', { clientRequestId: 'stable', invocationId: 'stable' }])
})
test('detach uses original workspace after switch and cannot emit old workspace events', async () => {
  const f = fixture(); const events: unknown[] = []
  await f.service.invoke(1, { sessionId: 'focus', method: 'bind', args: [{ voiceSessionId: 'focus', callId: 'call' }] })
  await f.service.subscribe(1, { sessionId: 'focus', bindingId: 'binding' }, e => events.push(e))
  f.switchWorkspace(); f.listeners[0]!({} as never); expect(events).toHaveLength(0)
  f.service.detachOwner(1); expect(f.detached).toContainEqual([{ ownerId: '1', workspaceId: 'workspace' }, 'binding'])
})
test('late bind after owner detach is cleaned up without attaching', async () => {
  const f = fixture(); let release!: () => void; const wait = new Promise<void>(r => release = r); const bind = f.host.bind
  f.host.bind = async () => { await wait; return bind() }
  const pending = f.service.invoke(1, { sessionId: 'focus', method: 'bind', args: [{ voiceSessionId: 'focus', callId: 'call' }] })
  f.service.detachOwner(1); release(); await expect(pending).rejects.toThrow('detached'); expect(f.detached).toHaveLength(1)
})
test('replacement subscriptions discard events from the previous listener', async () => {
  const f = fixture(); const events: unknown[] = []
  await f.service.subscribe(1, { sessionId: 'focus', bindingId: 'binding' }, e => events.push(e))
  await f.service.subscribe(1, { sessionId: 'focus', bindingId: 'binding' }, e => events.push(e))
  f.listeners[0]!({} as never); f.listeners[1]!({} as never); expect(events).toHaveLength(1)
  f.service.detachOwner(1); f.listeners[1]!({} as never); expect(events).toHaveLength(1)
})

const draftLaunch = { ownerId: 1, workspaceId: 'workspace', sessionId: 'focus', turnId: 'turn', proposal: { id: 'stable', agentSlug: 'scriptwriter', agentName: 'Scriptwriter', taskTitle: 'Teaser', brief: 'Draft teaser' } }
for (const detach of [false, true]) test(`workspace change during bind stops reservation and dispatch; detach=${detach}`, async () => {
  const f = fixture(); let release!: () => void; const wait = new Promise<void>(r => release = r); const bind = f.host.bind
  f.host.bind = async () => { await wait; return bind() }
  const pending = f.service.launch(draftLaunch)
  f.switchWorkspace(); if (detach) f.service.detachOwner(1); release()
  await expect(pending).rejects.toThrow('workspace changed')
  expect(f.launches).toHaveLength(0); expect(f.detached).toHaveLength(1)
})
test('owner detach during reservation stops dispatch and preserves the reserved identity', async () => {
  const f = fixture(); let release!: () => void; const wait = new Promise<void>(r => release = r); const reserve = f.host.reserveIntent
  f.host.reserveIntent = async (...args) => { const result = await reserve(...args); await wait; return result }
  const pending = f.service.launch(draftLaunch)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  f.service.detachOwner(1); release()
  await expect(pending).rejects.toThrow('detached')
  expect(f.launches).toHaveLength(1)
  expect(f.launches[0]).toMatchObject([{ workspaceId: 'workspace' }, 'binding', { clientRequestId: 'stable' }])
})
test('workspace change during reservation stops dispatch even without owner detach', async () => {
  const f = fixture(); let release!: () => void; const wait = new Promise<void>(r => release = r); const reserve = f.host.reserveIntent
  f.host.reserveIntent = async (...args) => { const result = await reserve(...args); await wait; return result }
  const pending = f.service.launch(draftLaunch)
  for (let i = 0; i < 10; i++) await Promise.resolve()
  f.switchWorkspace(); release()
  await expect(pending).rejects.toThrow('workspace changed')
  expect(f.launches).toHaveLength(1); expect(f.detached).toHaveLength(1)
})
test('reservation failure detaches its attachment and does not dispatch', async () => {
  const f = fixture(); f.host.reserveIntent = async () => { throw new Error('persistence failed') }
  await expect(f.service.launch(draftLaunch)).rejects.toThrow('persistence failed')
  expect(f.launches).toHaveLength(0); expect(f.detached).toHaveLength(1)
  f.service.detachOwner(1); expect(f.detached).toHaveLength(1)
})

test('adapter preserves the confirmed focus mode in durable intent request and retry', async () => {
  const f = fixture()
  const input = { ...draftLaunch, proposal: { ...draftLaunch.proposal, taskModeId: 'short-form', taskModeLabel: 'Reels / TikTok' } }
  await f.service.launch(input)
  await f.service.launch({ ...input, turnId: 'retry-turn' })
  for (const index of [0, 2]) expect(f.launches[index]).toMatchObject([{ workspaceId: 'workspace' }, 'binding', { clientRequestId: 'stable', request: { taskModeId: 'short-form' } }])
})
