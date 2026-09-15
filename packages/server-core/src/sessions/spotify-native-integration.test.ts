import { afterEach, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { artistProfileDoc } from '@craft-agent/shared/artist-context'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { saveWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { cancelScheduledHqStateContextRefresh } from '../hq-state/refresh'
import { SessionManager, createManagedSession } from './SessionManager'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    cancelScheduledHqStateContextRefresh(root)
    rmSync(root, { recursive: true, force: true })
  }
})

function parseSnapshot(body: string) { return JSON.parse(body.match(/```json\s*([\s\S]*?)```/)![1]!) }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spotify-session-integration-'))
  roots.push(root)
  const artistId = '1234567890123456789012'
  saveWorkspaceConfig(root, { id: 'hq', name: 'Artist HQ', slug: 'hq', createdAt: 1, updatedAt: 1 })
  upsertContextDoc(root, {
    slug: 'artist-profile', metadata: artistProfileDoc.metadata(),
    body: artistProfileDoc.serialize({ ...artistProfileDoc.empty(), artistName: 'Test Artist', spotifyProfile: `https://open.spotify.com/artist/${artistId}` }),
  })
  const manager = new SessionManager()
  // Instance-local adapters only: exercise real admission, collector, publisher,
  // and processing settlement without a model, saved profile, or global mocks.
  const internal = manager as any
  internal.persistSession = mock(() => {})
  manager.flushSession = mock(async () => {})
  internal.resolveAgentSessionOptions = mock(async () => ({ spawnedFromAgent: { agentSlug: 'spotify-analyst', agentName: 'Spotify Analyst' } }))
  manager.sendMessage = mock(async () => { throw new Error('Native Pulse must never enter the model path') }) as typeof manager.sendMessage
  const managed = createManagedSession({ id: 'pulse-test', name: 'Spotify Pulse' }, { id: 'hq', name: 'Artist HQ', rootPath: root, createdAt: 1 } as never,
    { messagesLoaded: true, spawnedFromAgent: { agentSlug: 'spotify-analyst', agentName: 'Spotify Analyst' } })
  manager.createSession = mock(async () => {
    internal.sessions.set(managed.id, managed)
    return managed as never
  }) as typeof manager.createSession
  const events: any[] = []
  internal.sendEvent = mock((event: unknown) => events.push(event))
  const changes: any[] = []
  internal.eventSink = (channel: string, _target: unknown, workspaceId: string, docs: any[]) => {
    if (channel === RPC_CHANNELS.workspaceContext.CHANGED) {
      changes.push({ workspaceId, snapshot: parseSnapshot(docs.find(doc => doc.slug === 'artist-spotify-snapshot').body) })
    }
  }
  const navigation: string[] = []
  let url = ''
  internal.browserPaneManager = {
    useSocialProfileForSession: () => 'browser-test', setAgentControl: () => {}, focus: () => {}, clearAgentControl: () => {},
    clearVisualsForSession: async () => {}, unbindAllForSession: () => {},
    navigate: async (_id: string, next: string) => {
      if (next.endsWith('/audience/location')) expect(changes).toHaveLength(1)
      navigation.push(next); url = next
      return { url, title: 'Spotify for Artists' }
    },
    evaluate: async () => {
      if (url.endsWith('/home')) return { url, text: 'Last 28 days\nMonthly listeners\n81,259\nStreams\n179,642' }
      if (url.endsWith('/location')) return { url, text: 'Last 28 days', tables: [{ headers: ['Country', 'Listeners'], rows: [['United States', '39,050']] }, { headers: ['City', 'Listeners'], rows: [['Chicago', '2,300']] }] }
      return { url, text: 'Songs\n28 days', selectedWindowText: '28 days', tables: [{ headers: ['Title', 'Streams'], rows: [['Homebody', '1,200']] }] }
    },
  }
  let writes = 0
  const profile = randomUUID()
  const normalize = async (args: string[]) => {
    if (args[0] === 'catalog') return { profiles: [{ platform: 'spotify', profile, accountUrl: 'https://open.spotify.com/user/test-login' }] }
    const capture = JSON.parse(readFileSync(args[args.indexOf('--capture-file') + 1]!, 'utf8'))
    const directory = join(root, 'data', 'spotify', 'snapshots')
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, `2026-09-15-s4a-${++writes}.json`), JSON.stringify({
      version: 1, dataSource: 'spotify-for-artists-browser', snapshotDate: capture.snapshotDate, windowDays: capture.windowDays,
      artist: capture.artist, metrics: { streams: capture.streams, listeners: capture.listeners },
      geo: { topCities: capture.topCities, topCountries: capture.topCountries }, tracks: capture.topTracks,
      updatedAt: new Date(Date.now() + writes).toISOString(),
    }))
    return { ok: true, status: 'succeeded' }
  }
  manager.setPulseSocialCli(normalize)
  const input = { workspaceId: 'hq', workspaceRootPath: root, prompt: 'Refresh', agentSlug: 'spotify-analyst', taskModeId: 'fresh-snapshot' }
  return { manager, internal, input, managed, changes, events, navigation, normalize, root }
}

test('fresh-snapshot automation publishes core then enrichment and settles without a model call', async () => {
  const f = fixture()
  await expect(f.manager.executePromptAutomation(f.input)).resolves.toEqual({ sessionId: 'pulse-test' })
  expect(f.manager.sendMessage).not.toHaveBeenCalled()
  expect(f.changes).toHaveLength(2)
  expect(f.changes[0]).toMatchObject({ workspaceId: 'hq', snapshot: { metrics: { streams: 179642, listeners: 81259 }, tracks: [] } })
  expect(f.changes[1].snapshot.tracks).toEqual([{ name: 'Homebody', streams: 1200 }])
  expect(f.changes[1].snapshot.geo.topCountries).toEqual([{ country: 'United States', listeners: 39050 }])
  expect(parseSnapshot(loadContextDoc(f.root, 'artist-spotify-snapshot')!.body).tracks).toHaveLength(1)
  expect(f.managed.isProcessing).toBe(false)
  expect(f.managed.lastSettledProcessingGeneration).toBe(f.managed.processingGeneration)
  expect(f.events.some(event => event.type === 'complete')).toBe(true)
  expect(f.internal.nativePulseRuns.size).toBe(0)
}, 20_000)

test('duplicate automation start is rejected before creating another session', async () => {
  const f = fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  f.manager.setPulseSocialCli(async args => { if (args[0] === 'catalog') await gate; return f.normalize(args) })
  const first = f.manager.executePromptAutomation(f.input)
  await expect(f.manager.executePromptAutomation(f.input)).rejects.toThrow('already running')
  release()
  await first
  expect(f.manager.createSession).toHaveBeenCalledTimes(1)
  expect(f.manager.sendMessage).not.toHaveBeenCalled()
  expect(f.managed.isProcessing).toBe(false)
}, 20_000)

test('manual cancellation after core publication keeps the widget data and settles the native run', async () => {
  const f = fixture()
  let reachedLocation!: () => void
  let resume!: () => void
  const reached = new Promise<void>(resolve => { reachedLocation = resolve })
  const held = new Promise<void>(resolve => { resume = resolve })
  const navigate = f.internal.browserPaneManager.navigate
  f.internal.browserPaneManager.navigate = async (id: string, url: string) => {
    if (url.endsWith('/audience/location')) { reachedLocation(); await held }
    return navigate(id, url)
  }
  const running = f.manager.executePromptAutomation(f.input)
  const stopped = running.then(() => null, error => error as Error)
  await reached
  expect(f.changes).toHaveLength(1)
  await f.manager.cancelProcessing(f.managed.id, true)
  resume()
  expect((await stopped)?.message).toContain('cancelled')
  expect(f.changes).toHaveLength(1)
  expect(parseSnapshot(loadContextDoc(f.root, 'artist-spotify-snapshot')!.body).metrics.streams).toBe(179642)
  expect(f.managed.isProcessing).toBe(false)
  expect(f.managed.wasInterrupted).toBe(true)
  expect(f.internal.nativePulseRuns.size).toBe(0)
  expect(f.manager.sendMessage).not.toHaveBeenCalled()
}, 20_000)
