import { describe, expect, test } from 'bun:test'
import type { SignalState, SignalTrackConfig } from '@craft-agent/shared/shared-intel'
import type { OutputSummaryDTO } from '../hooks/useOutputs'
import { parseAutomationsConfig } from '../components/automations/types'
import { emptyArtistIntelConfig } from './artist-intel'
import { assertSignalScheduleCanRewrite, legacySignalSources, saveSignalSettingsTransaction, signalDefaultKey, signalDocumentInTrack, signalLibraryLabels, signalNextRun, signalNuggetsKey, signalOutputRun, signalScheduleMatches, signalWeeklyMatcher, signalWeeklyReadiness } from './signal-tracks'
import { appendSignalNugget } from './artist-signals'

const config: SignalTrackConfig = { version: 1, track: 'industry', enabled: false, cadence: 'manual', sinceDays: 7, maxPerChannel: 1, sources: [], revision: 'r1', updatedAt: '2026-09-07T00:00:00Z' }
const state: SignalState = { hqWorkspaceId: 'hq', tracks: { industry: config, 'your-world': { ...config, track: 'your-world' } }, runs: [{ runId: 'run', track: 'your-world', mode: 'scan', status: 'report', workflowRunId: 'workflow-run', orderIds: ['order'], outputId: 'output', createdAt: config.updatedAt, updatedAt: config.updatedAt }] }
const output: OutputSummaryDTO = { id: 'output', workspaceId: 'hq', title: 'User renamed this', kind: 'report', status: 'published', createdAt: config.updatedAt, primaryAssetId: 'report', origin: { source: 'workflow', workflowRunId: 'workflow-run', workflowSlug: 'weekly-world-scan', stepId: 'synthesize' } }

describe('Signals track UI contracts', () => {
  test('next run respects future snoozes, expiry, exact due time and invalid schedules', () => {
    const now = new Date('2026-09-07T22:00:00Z')
    const schedule = { cron: '0 9 * * 1', timezone: 'America/Chicago' }
    expect(signalNextRun(schedule, now)?.toISOString()).toBe('2026-09-14T14:00:00.000Z')
    expect(signalNextRun({ ...schedule, snoozedUntil: '2026-10-07T15:00:00Z' }, now)?.toISOString()).toBe('2026-10-12T14:00:00.000Z')
    expect(signalNextRun({ ...schedule, snoozedUntil: '2026-09-14T14:00:00Z' }, now)?.toISOString()).toBe('2026-09-14T14:00:00.000Z')
    for (const snoozedUntil of ['invalid', '2026-09-01T00:00:00Z']) expect(signalNextRun({ ...schedule, snoozedUntil }, now)?.toISOString()).toBe('2026-09-14T14:00:00.000Z')
    expect(signalNextRun({ cron: 'bad cron' }, now)).toBeNull()
    expect(signalNextRun({}, now)).toBeNull()
  })
  test('library labels distinguish actual repeated titles and same-time reports', () => {
    const items = [
      { key: 'new', title: 'Your World Signal Brief', date: '2026-09-07T12:00:00Z' },
      { key: 'old', title: 'Your World Signal Brief', date: '2026-08-31T12:00:00Z' },
      { key: 'same', title: 'Your World Signal Brief', date: '2026-09-07T12:00:00Z' },
      { key: 'renamed', title: 'Your World Signal Brief (2)', date: '2026-09-07T12:00:00Z' },
      { key: 'undated', title: 'Your World Signal Brief', date: 'invalid' },
      { key: 'review', title: 'Your World Video Review', mode: 'links' as const },
      { key: signalNuggetsKey, title: 'Signal Nuggets' },
    ]
    const labels = signalLibraryLabels(items)
    expect(new Set(labels.values()).size).toBe(items.length)
    expect(labels.get('new')).toContain('2026')
    expect(labels.get('same')).toEndWith('(2)')
    expect(labels.get('undated')).toStartWith('Undated')
    expect(labels.get('review')).toContain('Video review:')
    expect(labels.get(signalNuggetsKey)).toBe('Saved nuggets')
  })
  test('shared nuggets are reachable in both tracks without becoming the default report', () => {
    const nugget = { slug: 'artist-signal-nuggets', metadata: { name: 'My renamed excerpts' } }
    for (const track of ['industry', 'your-world'] as const) expect(signalDocumentInTrack(nugget, track)).toBe(true)
    expect(signalDocumentInTrack({ slug: 'other-report', metadata: { name: 'Industry report' } }, 'your-world')).toBe(false)
    expect(signalDocumentInTrack({ slug: 'artist-intel-config', metadata: { name: 'Industry config' } }, 'industry')).toBe(false)
    expect(signalDefaultKey([{ key: signalNuggetsKey }], null)).toBeNull()
    expect(signalDefaultKey([{ key: signalNuggetsKey }], signalNuggetsKey)).toBe(signalNuggetsKey)
    expect(signalDefaultKey([{ key: signalNuggetsKey }, { key: 'report' }], null)).toBe('report')
  })
  test('weekly readiness requires both host settings and matcher; Work pause is not a mismatch', () => {
    expect(signalWeeklyReadiness(config, { enabled: true })).toEqual({ active: false, needsRepair: true })
    expect(signalWeeklyReadiness({ ...config, enabled: true, cadence: 'weekly' }, { enabled: true })).toEqual({ active: true, needsRepair: false })
    expect(signalWeeklyReadiness({ ...config, enabled: true, cadence: 'weekly' }, { enabled: false })).toEqual({ active: false, needsRepair: false })
    expect(signalWeeklyReadiness({ ...config, enabled: true, cadence: 'manual' }, { enabled: true })).toEqual({ active: false, needsRepair: true })
    expect(signalWeeklyReadiness({ ...config, enabled: true, cadence: 'weekly' }, undefined)).toEqual({ active: false, needsRepair: false })
  })
  test('report identity comes from saved host run and output provenance, not renamed titles', () => {
    expect(signalOutputRun(output, state)?.track).toBe('your-world')
    for (const value of [
      { ...output, id: 'other' }, { ...output, workspaceId: 'another-hq' }, { ...output, status: 'draft' as const },
      { ...output, tags: ['signal-source-packet'] }, { ...output, origin: { ...output.origin!, stepId: 'collect' } },
      { ...output, origin: { ...output.origin!, workflowRunId: 'different' } },
      { ...output, origin: { ...output.origin!, workflowSlug: 'signals-industry-scan' } },
    ]) expect(signalOutputRun(value, state)).toBeUndefined()
    expect(signalOutputRun(output, { ...state, runs: [{ ...state.runs[0]!, status: 'no-change' }] })).toBeUndefined()
    expect(signalOutputRun({ ...output, primaryAssetId: undefined, primary: { id: 'p', label: 'Report', role: 'primary', path: 'report.md' } }, state)).toBeDefined()
  })
  test('weekly default survives a newer review; selection and deletion fallback stay track-local', () => {
    const items = [{ key: 'links', mode: 'links' as const }, { key: 'weekly', mode: 'scan' as const }]
    expect(signalDefaultKey(items, null)).toBe('weekly')
    expect(signalDefaultKey(items, 'links')).toBe('links')
    expect(signalDefaultKey(items, 'deleted')).toBe('weekly')
    expect(signalDefaultKey([], 'links')).toBeNull()
    expect(signalDefaultKey([{ key: 'world', mode: 'scan' }], 'weekly')).toBe('world')
  })
  test('adoption preserves deliberate empty sources and refuses malformed/oversized legacy config', () => {
    const fallback = emptyArtistIntelConfig()
    expect(legacySignalSources('```json\n{"version":1,"sources":[]}\n```', fallback)).toEqual([])
    expect(legacySignalSources(null, fallback)).toEqual(fallback.sources)
    expect(() => legacySignalSources('not valid', fallback)).toThrow('unreadable')
    expect(() => legacySignalSources(JSON.stringify({ version: 1, sources: [{ name: 'Broken' }] }), fallback)).toThrow('incomplete')
    expect(() => legacySignalSources(JSON.stringify({ version: 1, sources: Array(21).fill(fallback.sources[0]) }), fallback)).toThrow('20')
  })
  test('weekly adoption retains timing, snooze and conditions with a distinct scoped identity', () => {
    const old = { id: 'old', cron: '13 11 * * 4', timezone: 'America/Chicago', snoozedUntil: '2026-10-01T00:00:00Z', conditions: [{ condition: 'state' }], enabled: true }
    const next = signalWeeklyMatcher('hq', 'industry', 'digest', true, old)
    expect(next).toMatchObject(old)
    expect(next.templateKey).toBe('signals:hq:industry:weekly')
    const [item] = parseAutomationsConfig({ version: 2, automations: { SchedulerTick: [next] } })
    expect(signalScheduleMatches(item!, 'hq', 'industry')).toBe(true)
    expect(signalScheduleMatches(item!, 'hq', 'your-world')).toBe(false)
    expect(signalWeeklyMatcher('hq', 'your-world', 'world-digest', true).cron).toBeUndefined()
  })
  test('schedule failure rolls config back using the written revision, never the original token', async () => {
    const writes: Array<{ config: SignalTrackConfig; revision: string }> = []
    await expect(saveSignalSettingsTransaction({ previous: config, next: { ...config, enabled: true, cadence: 'weekly' },
      save: async (value, revision) => { writes.push({ config: value, revision }); return { ...state, tracks: { ...state.tracks, industry: { ...value, revision: 'r2' } } } },
      schedule: async () => { throw new Error('Schedule CAS refused') },
    })).rejects.toThrow('Schedule CAS refused')
    expect(writes.map(write => write.revision)).toEqual(['r1', 'r2'])
    expect(writes[1]?.config).toBe(config)
  })
  test('custom actions are protected on every enable/resave, but exact-action pause is permitted', () => {
    const actions = [{ type: 'prompt' as const, prompt: 'First custom action' }, { type: 'prompt' as const, prompt: 'Second custom action' }]
    expect(() => assertSignalScheduleCanRewrite({ actions }, true)).toThrow('custom actions')
    expect(() => assertSignalScheduleCanRewrite({ actions }, false)).not.toThrow()
    expect(() => assertSignalScheduleCanRewrite({ actions: actions.slice(0, 1) }, true)).not.toThrow()
    expect(() => assertSignalScheduleCanRewrite(undefined, true)).not.toThrow()
    expect(actions).toHaveLength(2)
  })
  test('failed rollback is surfaced and never silently reported as saved', async () => {
    let calls = 0
    await expect(saveSignalSettingsTransaction({ previous: config, next: config,
      save: async () => { if (++calls > 1) throw new Error('Concurrent settings edit'); return state },
      schedule: async () => { throw new Error('Schedule refused') },
    })).rejects.toThrow('Settings could not be restored')
  })
  test('nuggets append scoped provenance without replacing existing artist prose', () => {
    const body = appendSignalNugget('Artist-written opening.\n\nExisting nugget.', { text: 'Selected evidence', sourceTitle: 'My report', sourceKey: 'output:out', outputId: 'out', track: 'your-world', amendedAt: config.updatedAt })
    expect(body).toContain('Artist-written opening.\n\nExisting nugget.')
    expect(body).toContain('signal-track: your-world; output: out')
    expect(body).toContain('signal-source: output:out')
  })
})
