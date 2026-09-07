import { describe, expect, test } from 'bun:test'
import type { SignalRetrievedEntry } from '@craft-agent/shared/shared-intel'
import { launchSignalIdea, resolvedSignalIdea, signalCampaignChoices, signalIdeaDraft, type SignalHandoffLaunchDependencies } from './signal-idea-handoff'

const reference = { hqWorkspaceId: 'hq', outputId: 'report', contentHash: 'a'.repeat(64), entryId: 'idea-1' }
const idea: SignalRetrievedEntry = { reference, id: 'idea-1', kind: 'idea', title: 'A useful question', excerpt: 'Ask what changes for independent creators.', topics: [], sourceRefs: ['source'], temporalKind: 'unknown', track: 'your-world', mode: 'links', workflowRunId: 'run', createdAt: '2026-09-07', coverageStatus: 'partial', sources: [{ sourceId: 'source', sourceUrl: 'https://example.com/article', sourcePublishedAt: '2020-01-01' }], supportingFindings: [{ id: 'finding', excerpt: 'The evidence is limited.', sourceRefs: ['source'] }] }
function dependencies(overrides: Partial<SignalHandoffLaunchDependencies> = {}) {
  const calls: string[] = []
  const deps: SignalHandoffLaunchDependencies = {
    resolve: async () => ({ ok: true, mode: 'reference', entries: [idea] }), find: async () => null,
    create: async () => { calls.push('create'); return 'new' }, bind: async id => { calls.push(`bind:${id}`); return id },
    discardBlank: async id => { calls.push(`discard:${id}`) }, seed: async id => { calls.push(`seed:${id}`) },
    focus: async id => { calls.push(`focus:${id}`) }, isCurrent: () => true, ...overrides,
  }
  return { deps, calls }
}
describe('deliberate Signal handoff', () => {
  test('binds before draft and navigation; never calls Send', async () => {
    const { deps, calls } = dependencies()
    await launchSignalIdea(reference, deps)
    expect(calls).toEqual(['create', 'bind:new', 'seed:new', 'focus:new'])
  })
  test('reuses persisted unsent draft without replacing artist edits', async () => {
    const { deps, calls } = dependencies({ find: async () => 'existing' })
    await launchSignalIdea(reference, deps)
    expect(calls).toEqual(['focus:existing'])
  })
  test('concurrent host winner is focused and unused blank removed', async () => {
    const { deps, calls } = dependencies({ bind: async () => 'winner' })
    await launchSignalIdea(reference, deps)
    expect(calls).toEqual(['create', 'discard:new', 'focus:winner'])
  })
  test('stale source fails before creating a session', async () => {
    const { deps, calls } = dependencies({ resolve: async () => ({ ok: false, mode: 'reference', entries: [], unavailable: true }) })
    await expect(launchSignalIdea(reference, deps)).rejects.toThrow('changed')
    expect(calls).toEqual([])
    expect(() => resolvedSignalIdea({ ok: true, mode: 'reference', entries: [{ ...idea, reference: { ...reference, contentHash: 'b'.repeat(64) } }] }, reference)).toThrow()
  })
  test('partial budget response retains valid canonical idea, but empty or mismatched entries still fail', () => {
    expect(resolvedSignalIdea({ ok: true, mode: 'reference', entries: [idea], unavailable: true }, reference)).toBe(idea)
    expect(() => resolvedSignalIdea({ ok: true, mode: 'reference', entries: [], unavailable: true }, reference)).toThrow()
    expect(() => resolvedSignalIdea({ ok: true, mode: 'reference', entries: [{ ...idea, reference: { ...reference, entryId: 'wrong' } }], unavailable: true }, reference)).toThrow()
  })
  test('bind failure removes only new blank and does not seed', async () => {
    const { deps, calls } = dependencies({ bind: async () => { throw new Error('deleted') } })
    await expect(launchSignalIdea(reference, deps)).rejects.toThrow('deleted')
    expect(calls).toEqual(['create', 'discard:new'])
  })
  test('cancel during resolve creates nothing', async () => {
    const { deps, calls } = dependencies({ isCurrent: () => false })
    await expect(launchSignalIdea(reference, deps)).rejects.toThrow('cancelled')
    expect(calls).toEqual([])
  })
  test('seed failure preserves the bound session for explicit recovery without navigation', async () => {
    const { deps, calls } = dependencies({ seed: async () => { throw new Error('disk full') } })
    await expect(launchSignalIdea(reference, deps)).rejects.toMatchObject({ sessionId: 'new', draft: signalIdeaDraft(idea) })
    expect(calls).toEqual(['create', 'bind:new'])
  })
  test('explicit campaign choices exclude remote and ambiguous HQ scopes', () => {
    const rows = [{ id: 'hq', artistWorkspaceScope: 'hq' }, { id: 'campaign', artistWorkspaceScope: 'campaign' }, { id: 'remote', artistWorkspaceScope: 'campaign', remoteServer: {} }]
    expect(signalCampaignChoices(rows, 'hq').map(row => row.id)).toEqual(['campaign'])
    expect(signalCampaignChoices([...rows, { id: 'other', artistWorkspaceScope: 'hq' }], 'hq')).toEqual([])
  })
  test('draft keeps old source date and unknown event date, support and exact angle', () => {
    const draft = signalIdeaDraft(idea)
    expect(draft).toContain(idea.excerpt)
    expect(draft).toContain('The evidence is limited.')
    expect(draft).toContain('2020-01-01')
    expect(draft).toContain('event date: unknown')
    expect(draft).toContain('do not create or publish assets yet')
  })
})
