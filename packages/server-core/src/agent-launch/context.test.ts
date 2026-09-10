import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadContextDoc, upsertContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import { importMissionAssets, saveMissionLyricsAsync } from '@craft-agent/shared/mission-assets'
import { resolveReleaseKitItemPath } from '@craft-agent/shared/release-kit'
import { resolveAgentTaskMode, STARTER_AGENTS } from '@craft-agent/shared/agent-definitions'
import { prepareAgentLaunchContext } from './context'
import { withScriptwriterArtistContext } from '../hq-state/scriptwriter-context'
import { ReleaseKitService } from '../release-kit/ReleaseKitService'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function workspace(scope = 'campaign') {
  const rootPath = mkdtempSync(join(tmpdir(), 'launch-context-'))
  roots.push(rootPath)
  return { id: 'fixture', name: 'Fixture', rootPath, artistWorkspaceScope: scope }
}
function doc(slug: string, metadata: Partial<LoadedContextDoc['metadata']> = {}): LoadedContextDoc {
  return { slug, path: '/fixture', workspaceRootPath: '/fixture', body: `sensitive-${slug}`, metadata: { name: slug, enabled: true, delivery: 'always', routing: { mode: 'broadcast' }, ...metadata } }
}
const quiet = { warn: () => {} }

describe('shared launch context preparation', () => {
  test('tampered promoted audio loses verified track claims before composition', async () => {
    const ws = workspace()
    const service = new ReleaseKitService({ getWorkspaceByNameOrId: () => ws as never, assertWritePermission: () => {} })
    const source = join(ws.rootPath, 'master.wav')
    writeFileSync(source, 'audio-v1')
    const asset = importMissionAssets(ws.rootPath, ws.id, [source], { kindHint: 'master' }).imported[0]!
    await saveMissionLyricsAsync(ws.rootPath, ws.id, { sourceAudioAssetId: asset.id, lyricsText: 'APPROVED-LYRIC' }, 'client')
    const promoted = service.promote(ws.id, { source: { type: 'campaign-asset', assetId: asset.id }, category: 'audio', subtype: 'master' }, 'user')
    expect(loadContextDoc(ws.rootPath, 'release-kit')!.body).toContain('"hasLyrics": true')
    writeFileSync(resolveReleaseKitItemPath(ws.rootPath, promoted.item.relativePath), 'tampered')
    prepareAgentLaunchContext(ws, 'writer', undefined, { refreshReleaseKit: id => service.refreshAgentContext(id) })
    expect(loadContextDoc(ws.rootPath, 'release-kit')!.body).not.toContain('"hasLyrics": true')
  })

  test('failed track fallback and Release Kit persistence exclude stale docs but retain safe context', () => {
    const ws = workspace()
    const docs = prepareAgentLaunchContext(ws, 'writer', undefined, {
      ...quiet,
      refreshTracks: () => ({ ok: false, error: 'write failed', unsafePersistedSlug: 'mission-assets' }),
      refreshReleaseKit: () => ({ contextPersisted: false }),
      loadDocs: () => [doc('mission-assets'), doc('release-kit'), doc('safe')],
    })
    expect(docs.map(d => d.slug)).toEqual(['artist-os-workspace', 'safe'])
  })

  test('Release Kit exception also excludes the stale copy', () => {
    const ws = workspace()
    expect(prepareAgentLaunchContext(ws, 'writer', undefined, {
      ...quiet, refreshTracks: () => ({ ok: true }), refreshReleaseKit: () => { throw new Error('corrupt manifest') },
      loadDocs: () => [doc('release-kit')],
    }).map(d => d.slug)).toEqual(['artist-os-workspace'])
  })

  test('successful safe-empty track fallback remains eligible', () => {
    const ws = workspace('hq')
    expect(prepareAgentLaunchContext(ws, 'writer', undefined, {
      ...quiet, refreshTracks: () => ({ ok: false, error: 'replaced with empty' }),
      loadDocs: () => [doc('artist-vault')],
    }).map(d => d.slug)).toEqual(['artist-os-workspace', 'artist-vault'])
  })

  test('HQ failure filters its own unsafe slug without refreshing a campaign kit', () => {
    const ws = workspace('hq')
    let kitCalls = 0
    const docs = prepareAgentLaunchContext(ws, 'writer', undefined, {
      ...quiet, refreshTracks: () => ({ ok: false, error: 'write failed', unsafePersistedSlug: 'artist-vault' }),
      refreshReleaseKit: () => { kitCalls++; return { contextPersisted: true } },
      loadDocs: () => [doc('artist-vault')],
    })
    expect(docs.map(d => d.slug)).toEqual(['artist-os-workspace'])
    expect(kitCalls).toBe(0)
  })

  test('focused context respects private, disabled and on-demand delivery rules', () => {
    const ws = workspace('lab')
    const agent = STARTER_AGENTS.find(a => a.slug === 'social-publisher')!
    const mode = resolveAgentTaskMode(agent, 'growth')!
    const snapshot = doc('artist-instagram-snapshot', { delivery: 'on-demand' })
    const prepare = (docs: LoadedContextDoc[]) => prepareAgentLaunchContext(ws, agent.slug, mode, { loadDocs: () => docs })
    expect(prepare([snapshot]).map(d => d.slug)).toEqual(['artist-instagram-snapshot'])
    expect(prepare([{ ...snapshot, metadata: { ...snapshot.metadata, enabled: false } }])).toEqual([])
    expect(prepare([{ ...snapshot, metadata: { ...snapshot.metadata, private: true, routing: { mode: 'targeted', agents: ['writer'] } } }])).toEqual([])
    expect(prepareAgentLaunchContext(ws, agent.slug, undefined, { loadDocs: () => [snapshot] }).map(d => d.slug)).toEqual(['artist-os-workspace'])
  })

  test('Scriptwriter uses current HQ identity and never resurrects restricted campaign copies', () => {
    const campaign = workspace()
    const hq = workspace('hq')
    const write = (root: string, slug: string, body: string, metadata: Partial<LoadedContextDoc['metadata']> = {}) => {
      upsertContextDoc(root, { slug, body, metadata: { name: slug, enabled: true, delivery: 'always', routing: { mode: 'broadcast' }, ...metadata } })
    }
    for (const slug of ['artist-profile', 'artist-voice', 'artist-branding']) write(campaign.rootPath, slug, 'STALE-CAMPAIGN')
    write(hq.rootPath, 'artist-profile', 'CURRENT-HQ')
    write(hq.rootPath, 'artist-voice', 'DISABLED-HQ', { enabled: false })
    write(hq.rootPath, 'artist-branding', 'PRIVATE-HQ', { private: true, routing: { mode: 'targeted', agents: ['branding-agent'] } })
    const docs = prepareAgentLaunchContext(campaign, 'scriptwriter', undefined, {
      refreshTracks: () => ({ ok: true }), refreshReleaseKit: () => ({ contextPersisted: true }),
      withScriptwriterContext: (root, slug, local) => withScriptwriterArtistContext(root, slug, local, [hq, campaign]),
    })
    expect(docs.find(d => d.slug === 'artist-profile')?.body).toBe('CURRENT-HQ')
    expect(JSON.stringify(docs)).not.toMatch(/STALE-CAMPAIGN|DISABLED-HQ|PRIVATE-HQ/)
    expect(docs.find(d => d.slug === 'artist-profile')?.workspaceRootPath).toBe(hq.rootPath)
  })

  test('Manager state refresh precedes loading and generic workspaces skip Artist OS refreshes', () => {
    const calls: string[] = []
    prepareAgentLaunchContext(workspace('hq'), 'concierge', undefined, {
      refreshHq: () => { calls.push('state'); return null }, refreshTracks: () => { calls.push('tracks'); return { ok: true } },
      loadDocs: () => { calls.push('load'); return [] },
    })
    expect(calls).toEqual(['state', 'tracks', 'load'])
    calls.length = 0
    expect(prepareAgentLaunchContext(workspace('general'), 'writer', undefined, {
      refreshTracks: () => { throw new Error('unexpected Artist OS refresh') },
      refreshReleaseKit: () => { throw new Error('unexpected kit refresh') }, loadDocs: () => [],
    })).toEqual([])
  })
})
