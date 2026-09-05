import { describe, expect, test } from 'bun:test'
import { ArtistManagerMoonshine } from './artist-manager-moonshine'

const modelId = 'moonshine-small-streaming-en'
const sessionId = 'test-session-00001'
const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
function fixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const tier = { modelId, registered: true, installState: 'ready', hasError: false }
  const host = {
    ensureAvailable: async () => {}, listTiers: async () => [tier], getTierStatus: async () => tier,
    capabilities: async () => ({ moonshineCompiled: true, moonshineRuntimeAvailable: true, localStt: true }),
    startRuntime: async () => { calls.push('start'); return { modelId, generation: 1, preparationState: 'ready' } },
    feedRuntimeAudio: async () => { calls.push('feed') }, pollRuntime: async () => ({ tokens: [] }),
    requestRuntimeFinalization: async () => { calls.push('finalize') }, finishRuntimeTurn: async () => { calls.push('finish') },
    cancelRuntime: async () => {}, stopRuntime: async () => { calls.push('stop') },
    installBundled: async () => tier, shutdownAndWait: async () => { calls.push('shutdown') },
    ...overrides,
  }
  const bridge = new ArtistManagerMoonshine(host as never)
  const invoke = (method: string, extra = {}, owner = 1) => bridge.invoke(owner, { method, sessionId, modelId, ...extra })
  return { bridge, invoke, calls }
}

describe('Artist OS Moonshine lease', () => {
  test('missing native resources is an explicit status, not fallback transcription', async () => {
    const { invoke } = fixture({ ensureAvailable: async () => { throw new Error('missing') } })
    expect(await invoke('status')).toMatchObject({ available: false, tiers: [] })
  })
  test('requires the exact ready registered tier', async () => {
    const { invoke, calls } = fixture({ getTierStatus: async () => ({ modelId, registered: false, installState: 'ready' }) })
    await expect(invoke('start')).rejects.toThrow('not installed')
    expect(calls).not.toContain('start')
    await invoke('cancel')
    await invoke('stop')
    expect(calls.filter(x => x === 'stop')).toHaveLength(1)
  })
  test('asset-only helper is unavailable while runtime without installed models is available', async () => {
    const assetOnly = fixture({ capabilities: async () => ({ moonshineCompiled: false, moonshineRuntimeAvailable: false }) })
    expect(await assetOnly.invoke('status')).toMatchObject({ available: false, error: 'This Moonshine helper does not include the native speech runtime.' })
    const uninstalled = fixture({ capabilities: async () => ({ moonshineCompiled: true, moonshineRuntimeAvailable: true, localStt: false }) })
    expect(await uninstalled.invoke('status')).toMatchObject({ available: true })
  })
  test('double teardown is harmless only while no replacement lease exists', async () => {
    const { invoke, calls } = fixture()
    await invoke('start')
    await invoke('cancel')
    await invoke('stop')
    await invoke('cancel')
    expect(calls.filter(x => x === 'stop')).toHaveLength(1)
    await expect(invoke('stop', { sessionId: 'bad' })).rejects.toThrow('session ID')
    await invoke('start', { sessionId: 'next-session-00001' })
    await expect(invoke('cancel')).rejects.toThrow('not owned')
    await expect(invoke('stop')).rejects.toThrow('not owned')
    expect(calls.filter(x => x === 'stop')).toHaveLength(1)
    await invoke('poll', { sessionId: 'next-session-00001' })
  })
  test('rejects another window and old same-window session IDs', async () => {
    const { invoke } = fixture()
    await invoke('start')
    await expect(invoke('stop', {}, 2)).rejects.toThrow('not owned')
    await expect(invoke('poll', { sessionId: 'stale-session-0001' })).rejects.toThrow('not owned')
    await invoke('stop')
    await invoke('start', { sessionId: 'next-session-00001' })
    await expect(invoke('stop')).rejects.toThrow('not owned')
  })
  test('owner disappearance during readiness cannot start a ghost runtime', async () => {
    const gate = deferred()
    const { bridge, invoke, calls } = fixture({ ensureAvailable: () => gate.promise })
    const start = invoke('start')
    await bridge.releaseOwner(1)
    gate.resolve()
    await expect(start).rejects.toThrow('ended')
    expect(calls).not.toContain('start')
  })
  test('closing lease blocks replacement until native stop has completed', async () => {
    const gate = deferred()
    const { bridge, invoke } = fixture({ stopRuntime: () => gate.promise })
    await invoke('start')
    const closing = bridge.releaseOwner(1)
    await expect(invoke('start', { sessionId: 'next-session-00001' })).rejects.toThrow('in use')
    gate.resolve()
    await closing
    await invoke('start', { sessionId: 'next-session-00001' })
  })
  test('old cold start completion cannot stop a replacement lease', async () => {
    const gate = deferred<unknown>()
    let starts = 0
    const { bridge, invoke, calls } = fixture({ startRuntime: () => ++starts === 1 ? gate.promise : Promise.resolve({ generation: 2 }) })
    const start = invoke('start')
    // Let preflight finish and enter the deferred native start.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    await bridge.releaseOwner(1)
    await invoke('start', { sessionId: 'next-session-00001' })
    gate.resolve({ generation: 1 })
    await expect(start).rejects.toThrow('ended')
    expect(calls.filter(x => x === 'stop')).toHaveLength(1)
    await invoke('poll', { sessionId: 'next-session-00001' })
  })
  test('late native reply from an ended session is rejected', async () => {
    const gate = deferred<unknown>()
    const { invoke } = fixture({ pollRuntime: () => gate.promise })
    await invoke('start')
    const poll = invoke('poll')
    await invoke('stop')
    await invoke('start', { sessionId: 'next-session-00001' })
    gate.resolve({ tokens: [{ text: 'old' }] })
    await expect(poll).rejects.toThrow('ended')
  })
  test('validates PCM bounds and positive safe turn numbers', async () => {
    const { invoke, calls } = fixture()
    await invoke('start')
    for (const extra of [
      { audio: new Uint8Array(9602), sampleRateHz: 48000, channels: 1 },
      { audio: new Uint8Array(2), sampleRateHz: 96000, channels: 1 },
      { audio: new Uint8Array(3), sampleRateHz: 16000, channels: 1 },
      { audio: new Uint8Array(2), sampleRateHz: 16000, channels: 2 },
    ]) await expect(invoke('feed', extra)).rejects.toThrow('PCM16')
    await invoke('feed', { audio: new Uint8Array(3200), sampleRateHz: 16000, channels: 1 })
    await expect(invoke('finalize', { turn: -1 })).rejects.toThrow('turn')
    expect(calls.filter(x => x === 'feed')).toHaveLength(1)
  })
  test('install and runtime start exclude each other', async () => {
    const gate = deferred()
    const { invoke } = fixture({ installBundled: () => gate.promise })
    const install = invoke('install')
    await expect(invoke('start')).rejects.toThrow('in use')
    await expect(invoke('install')).rejects.toThrow('Stop voice')
    gate.resolve()
    await install
    await invoke('start')
    await expect(invoke('install')).rejects.toThrow('Stop voice')
  })
  test('bounds concurrent audio and permits only one outstanding poll', async () => {
    const gate = deferred()
    const { invoke } = fixture({ feedRuntimeAudio: () => gate.promise, pollRuntime: () => gate.promise })
    await invoke('start')
    const frames = Array.from({ length: 20 }, () => invoke('feed', { audio: new Uint8Array(3200), sampleRateHz: 16000, channels: 1 }))
    await expect(invoke('feed', { audio: new Uint8Array(3200), sampleRateHz: 16000, channels: 1 })).rejects.toThrow('backlogged')
    const poll = invoke('poll')
    await expect(invoke('poll')).rejects.toThrow('already pending')
    gate.resolve()
    await Promise.all([...frames, poll])
  })
  test('shutdown prevents relaunch and waits for helper shutdown', async () => {
    const { bridge, invoke, calls } = fixture()
    await bridge.close()
    await expect(invoke('start')).rejects.toThrow('shutting down')
    expect(calls).toEqual(['shutdown'])
  })
})
