import { afterEach, expect, mock, test } from 'bun:test'
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadContextDoc } from '@craft-agent/shared/workspace-context'
import { parseArtistInstagramSnapshotDocResult } from '@craft-agent/shared/artist-context'
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

test('Instagram growth automation saves and publishes account metrics without a model or subprocess normalizer', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'instagram-session-integration-')))
  roots.push(root)
  saveWorkspaceConfig(root, { id: 'hq', name: 'Artist HQ', slug: 'hq', createdAt: 1, updatedAt: 1 })
  const manager = new SessionManager()
  const internal = manager as any
  // Instance-local admission/browser seams; real collector, normalizer, disk
  // snapshots, context publication and processing settlement run end-to-end.
  internal.persistSession = mock(() => {})
  manager.flushSession = mock(async () => {})
  internal.resolveAgentSessionOptions = mock(async () => ({ spawnedFromAgent: { agentSlug: 'social-publisher', agentName: 'Social Publisher' } }))
  manager.sendMessage = mock(async () => { throw new Error('Insights must never enter the model path') }) as typeof manager.sendMessage
  const managed = createManagedSession({ id: 'instagram-integration', name: 'Instagram Insights' }, { id: 'hq', name: 'Artist HQ', rootPath: root, createdAt: 1 } as never,
    { messagesLoaded: true, spawnedFromAgent: { agentSlug: 'social-publisher', agentName: 'Social Publisher' } })
  manager.createSession = mock(async () => { internal.sessions.set(managed.id, managed); return managed as never }) as typeof manager.createSession
  const events: any[] = []
  internal.sendEvent = mock((event: unknown) => events.push(event))
  const changes: any[] = []
  internal.eventSink = (channel: string, _target: unknown, workspaceId: string, docs: any[]) => {
    if (channel === RPC_CHANNELS.workspaceContext.CHANGED) changes.push({ workspaceId, parsed: parseArtistInstagramSnapshotDocResult(docs.find(doc => doc.slug === 'artist-instagram-snapshot')) })
  }
  const target = 'https://www.instagram.com/accounts/insights/?timeframe=30'
  const navigation: string[] = []
  const profile = randomUUID()
  const useProfile = mock(() => 'instagram-browser')
  internal.browserPaneManager = {
    useSocialProfileForSession: useProfile, setAgentControl: () => {}, focus: () => {}, clearAgentControl: () => {},
    clearVisualsForSession: async () => {}, unbindAllForSession: () => {},
    navigate: async (_id: string, url: string) => { navigation.push(url); return { url, title: 'Account Insights' } },
    evaluate: async () => ({
      url: target,
      text: 'Professional dashboard\nLast 30 days\nAccount insights\nViews\nInfo\n800\nFollowers\n26.5%\nNon-followers\n73.5%\nViewers\n173\nInteractions\nInfo\n19\nAccounts engaged\n18\nProfile visits\n275\nFollowers\nInfo\n10815\nTotal followers',
      headings: ['Views', '800', 'Interactions', '19', 'Followers', '10815'].map(text => ({ text, level: 2 })),
      anchors: [{ href: 'https://www.instagram.com/testartist/', imageAlt: "testartist's profile picture" }],
    }),
  }
  const socialCli = mock(async (args: string[]) => {
    expect(args).toEqual(['catalog', '--json'])
    return { profiles: [{ platform: 'instagram', profile, accountUrl: 'https://www.instagram.com/testartist/' }] }
  })
  manager.setPulseSocialCli(socialCli)
  await expect(manager.executePromptAutomation({ workspaceId: 'hq', workspaceRootPath: root, prompt: 'Refresh Instagram', agentSlug: 'social-publisher', taskModeId: 'growth' })).resolves.toEqual({ sessionId: managed.id })
  expect(manager.sendMessage).not.toHaveBeenCalled()
  expect(socialCli).toHaveBeenCalledTimes(1)
  expect(useProfile).toHaveBeenCalledWith(managed.id, 'instagram', profile, { show: true })
  expect(navigation).toEqual([target])
  expect(changes).toHaveLength(1)
  expect(changes[0]).toMatchObject({ workspaceId: 'hq', parsed: { ok: true, snapshot: { windowDays: 30, metrics: { followers: 10815, views: 800, interactions: 19, accountsEngaged: 18, profileVisits: 275 }, partial: false } } })
  const saved = parseArtistInstagramSnapshotDocResult(loadContextDoc(root, 'artist-instagram-snapshot') ?? undefined)
  expect(saved.ok && saved.snapshot?.metrics.views).toBe(800)
  expect(saved.ok && saved.snapshot?.metrics.accountsReached).toBeUndefined()
  expect(readdirSync(join(root, 'data/instagram/snapshots'))).toHaveLength(1)
  expect(managed.isProcessing).toBe(false)
  expect(managed.lastSettledProcessingGeneration).toBe(managed.processingGeneration)
  expect(internal.nativePulseRuns.size).toBe(0)
  expect(events.some(event => event.type === 'complete')).toBe(true)
}, 15_000)
