import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDeepResearchRun, writeDeepResearchRun, type DeepResearchRunSnapshot } from '@craft-agent/shared/deep-research'
import { createLabSong, loadLabSongs } from '@craft-agent/shared/lab'
import { DeepResearchRunner } from '../deep-research/DeepResearchRunner'
import { LabInspirationService, inspirationEdition } from './LabInspirationService'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lab-inspiration-')); roots.push(root)
  writeFileSync(join(root, 'config.json'), JSON.stringify({ id: 'lab', name: 'Lab', slug: 'lab', createdAt: 1, updatedAt: 1 }))
  const workspace = { id: 'lab', rootPath: root, artistWorkspaceScope: 'lab', remoteServer: undefined as unknown }
  const runner = new DeepResearchRunner({
    createSession: async () => { throw new Error('No live sessions in fixture') }, sendMessage: async () => {},
    getLastAssistantText: () => '', getSessionToolUseSummary: () => ({ count: 0, names: [] }), abortSession: async () => {},
    getWorkspaceRootPath: () => root,
    resolveSourceReadiness: () => ({ requested: [], usable: ['web'], missing: [], unusable: [] }),
    resolveSourceProfiles: () => [{ slug: 'web', name: 'Web', provider: 'exa', type: 'api', capabilities: ['search'] }],
  })
  runner.begin = (_workspaceId, runId) => readDeepResearchRun(root, runId)!
  const service = new LabInspirationService({ getRunner: () => runner, getWorkspace: () => workspace })
  const started = service.start('lab', { topic: 'Places that disappear' })
  const run = readDeepResearchRun(root, started.id)!
  run.state = 'succeeded'
  run.steps[0]!.state = 'succeeded'
  run.steps[0]!.toolReceipts = [{ id: 'a'.repeat(32), toolUseId: 'read-1', toolName: 'web_fetch', kind: 'page-read', status: 'succeeded',
    responseUrl: 'https://archive.org/story', resultChars: 200, resultSha256: 'b'.repeat(64), observedAt: new Date().toISOString(), supportExcerpt: 'Actual evidence.' }]
  run.structuredOutput = { discoveries: [{ title: 'A vanished street', summary: 'A street remembered through recordings.', tension: 'Belonging to a place that is gone.',
    angles: ['The last person who remembers a sound.'], question: 'What sound takes you home?', receiptIds: ['a'.repeat(32)] }] }
  const persist = () => writeDeepResearchRun(root, run)
  persist()
  return { root, workspace, runner, service, run, persist }
}

describe('Lab inspiration', () => {
  test('requests native public-web research rather than every connected source', () => {
    const { run } = fixture()
    expect(run.executionContract?.nativePublicWebOnly).toBe(true)
    expect(run.executionContract?.overallTimeoutMs).toBe(480_000)
    expect(run.executionContract?.maxSearchCalls).toBe(4)
    expect(run.executionContract?.maxPageReads).toBe(6)
    expect(run.plan.requiredSourceSlugs).toEqual([])
  })
  test('explains the live no-search failure instead of blaming source availability', () => {
    const { run } = fixture()
    run.state = 'failed'
    run.error = 'Step "research-loop" did not use any selected search/browser tool. Completed tools: none.'
    expect(inspirationEdition(run).error).toContain('No web search or page read completed')
    expect(inspirationEdition(run).error).not.toContain('when your sources are available')
  })

  test('explains a research deadline without blaming the connection', () => {
    const { run } = fixture()
    run.state = 'failed'
    run.error = 'Deep research deadline exceeded.'
    expect(inspirationEdition(run).error).toContain('time limit')
    expect(inspirationEdition(run).error).not.toContain('connection')
  })
  test('renders only host receipt URLs and creates stable discovery IDs', () => {
    const { run } = fixture()
    const edition = inspirationEdition(run)
    expect(edition.state).toBe('ready')
    expect(edition.discoveries[0]!.sources).toEqual([{ receiptId: 'a'.repeat(32), url: 'https://archive.org/story', observedAt: run.steps[0]!.toolReceipts![0]!.observedAt, excerpt: 'Actual evidence.' }])
    expect(edition.discoveries[0]!.id).toBe(`${run.id}:0`)
  })

  test('rejects invented, failed, snippet-only, local, and corrupt receipt evidence', () => {
    const { run } = fixture()
    for (const mutation of [
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.id = 'c'.repeat(32) },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.status = 'failed' },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.kind = 'search' },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.responseUrl = 'http://127.0.0.1/secret' },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.resultSha256 = undefined },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.state = 'failed' },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.supportExcerpt = undefined },
      (r: DeepResearchRunSnapshot) => { r.steps[0]!.toolReceipts![0]!.supportExcerpt = '  ' },
    ]) {
      const copy = structuredClone(run); mutation(copy)
      expect(inspirationEdition(copy)).toMatchObject({ state: 'failed', discoveries: [] })
    }
  })

  test('separates valid empty, malformed, failed, interrupted, and cancelled outcomes', () => {
    const { run } = fixture()
    run.structuredOutput = { discoveries: [] }
    expect(inspirationEdition(run).state).toBe('empty')
    run.structuredOutput = { discoveries: 'bad' }
    expect(inspirationEdition(run).state).toBe('failed')
    for (const state of ['failed', 'interrupted', 'cancelled'] as const) {
      run.state = state
      expect(inspirationEdition(run).state).toBe(state === 'cancelled' ? 'cancelled' : 'failed')
    }
  })

  test('startup recovery makes both prepared and running editions terminal', () => {
    for (const state of ['created', 'running'] as const) {
      const { run, runner, root, service, persist } = fixture()
      run.state = state; persist()
      runner.recoverInterruptedRuns([{ id: 'lab', rootPath: root }])
      expect(service.list('lab')[0]!.state).toBe('failed')
      expect(service.start('lab', { topic: 'A fresh curiosity' }).state).toBe('running')
    }
  })

  test('deduplicates active research before preparing another paid run', () => {
    const { run, service, persist } = fixture()
    run.state = 'running'; persist()
    expect(service.start('lab', { topic: 'Places that disappear' }).id).toBe(run.id)
    expect(() => service.start('lab', { topic: 'Another curiosity' })).toThrow('already running')
    expect(service.list('lab')).toHaveLength(1)
  })

  test('rejects foreign ownership, wrong workspace identity, HQ and remote scope', async () => {
    const { service, run, persist, workspace } = fixture()
    expect(() => service.list('other')).toThrow('Workspace not found')
    run.workspaceId = 'other'; persist()
    expect(service.list('lab')).toEqual([])
    await expect(service.cancel('lab', run.id)).rejects.toThrow('not found')
    run.workspaceId = 'lab'; run.purpose = 'general-research'; persist()
    expect(service.list('lab')).toEqual([])
    workspace.artistWorkspaceScope = 'hq'
    expect(() => service.start('lab', { topic: 'Topic' })).toThrow('local Lab')
    workspace.artistWorkspaceScope = 'lab'; workspace.remoteServer = {}
    expect(() => service.list('lab')).toThrow('local Lab')
  })

  test('saves exact selected text once to Remember, preserving existing lyrics', () => {
    const { root, service, run } = fixture()
    const song = createLabSong(root, { title: 'My song', captures: [{ text: 'Original lyric', destination: 'rough_pad' }] })
    const input = { editionId: run.id, discoveryId: `${run.id}:0`, angleIndex: 0, songId: song.id }
    expect(service.save('lab', input)).toEqual({ songId: song.id, alreadySaved: false })
    expect(service.save('lab', input).alreadySaved).toBe(true)
    const saved = loadLabSongs(root)[0]!
    expect(saved.roughText).toBe('Original lyric')
    expect(saved.rememberText).toBe('The last person who remembers a sound.')
    expect(saved.captures).toHaveLength(2)
    expect(saved.captures[1]!.note).toContain('https://archive.org/story')
    expect(saved.captures[1]!.note).toContain('receipt ' + 'a'.repeat(32))
  })

  test('denied team permissions fence start, cancel and save', async () => {
    const { root, service, run } = fixture()
    writeFileSync(join(root, 'config.json'), JSON.stringify({ id: root, name: 'Lab', slug: 'lab', createdAt: 1, updatedAt: 1,
      storage: { mode: 'shared-folder' }, team: { enabled: true, teamId: root, revision: 1 } }))
    expect(() => service.start('lab', { topic: 'Blocked' })).toThrow('Team permission denied')
    await expect(service.cancel('lab', run.id)).rejects.toThrow('Team permission denied')
    expect(() => service.save('lab', { editionId: run.id, discoveryId: `${run.id}:0`, newSongTitle: 'Blocked' })).toThrow('Team permission denied')
    expect(loadLabSongs(root)).toEqual([])
  })

  test('cancelled discoveries cannot be saved and zero-source empty results remain empty', () => {
    const { run, service, persist } = fixture()
    run.state = 'cancelled'; persist()
    expect(() => service.save('lab', { editionId: run.id, discoveryId: `${run.id}:0`, newSongTitle: 'No' })).toThrow('completed edition')
    run.state = 'succeeded'; run.steps[0]!.toolReceipts = []; run.structuredOutput = { discoveries: [] }
    expect(inspirationEdition(run)).toMatchObject({ state: 'empty', discoveries: [] })
  })

  test('new-song retry is idempotent and destinations must be explicit', () => {
    const { root, service, run } = fixture()
    const input = { editionId: run.id, discoveryId: `${run.id}:0`, newSongTitle: 'New idea' }
    const first = service.save('lab', input)
    expect(service.save('lab', input)).toEqual({ songId: first.songId, alreadySaved: true })
    expect(loadLabSongs(root)).toHaveLength(1)
    expect(() => service.save('lab', { ...input, songId: first.songId })).toThrow('one existing song')
    expect(() => service.save('lab', { editionId: run.id, discoveryId: `${run.id}:0` })).toThrow('one existing song')
    expect(() => service.save('lab', { ...input, angleIndex: 99 })).toThrow('available angle')
  })
})
