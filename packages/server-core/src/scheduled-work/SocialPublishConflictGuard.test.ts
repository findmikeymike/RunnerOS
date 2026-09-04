import { describe, expect, test } from 'bun:test'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import {
  assertArtistSocialPublishMayExecute,
  assertNoArtistSocialScheduleConflict,
  findArtistSocialPublishConflicts,
  type ArtistSocialWorkEntry,
} from './SocialPublishConflictGuard'

function entry(overrides: Partial<ScheduledWorkOrder> = {}, workspaceId = 'hq'): ArtistSocialWorkEntry {
  const order: ScheduledWorkOrder = {
    version: 1,
    id: overrides.id ?? `post-${workspaceId}`,
    owner: overrides.owner ?? (workspaceId === 'hq'
      ? { scope: 'hq', workspaceId }
      : { scope: 'campaign', workspaceId, campaignId: workspaceId }),
    calendarLink: overrides.calendarLink ?? { calendar: workspaceId === 'hq' ? 'hq' : 'campaign', itemId: `calendar-${workspaceId}` },
    title: overrides.title ?? 'Post release clip',
    type: 'social-publish',
    status: overrides.status ?? 'needs-approval',
    startAt: overrides.startAt ?? '2026-09-10T15:00:00.000Z',
    timezone: overrides.timezone ?? 'UTC',
    execution: overrides.execution ?? { type: 'social-publish', platform: 'instagram', profileId: 'artist-main', caption: 'Out Friday.' },
    inputRefs: overrides.inputRefs ?? [{ kind: 'release-kit', itemId: 'clip', sha256: 'a'.repeat(64) }],
    approvals: overrides.approvals ?? [],
    runs: overrides.runs ?? [],
    executionKey: overrides.executionKey ?? { payloadDigest: `digest-${workspaceId}`, idempotencyKey: `idem-${workspaceId}` },
    createdAt: overrides.createdAt ?? '2026-09-01T12:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-09-01T12:00:00.000Z',
    deletedAt: overrides.deletedAt,
  }
  return { workspaceId, workspaceName: workspaceId === 'hq' ? 'Artist HQ' : 'Release Campaign', order }
}

describe('artist-wide social publish conflicts', () => {
  test('blocks HQ and Campaign posts targeting the same account in the same minute', () => {
    const proposed = entry({ id: 'campaign-post', startAt: '2026-09-10T15:00:30.000Z' }, 'campaign')
    const existing = entry({ id: 'hq-post' })
    expect(() => assertNoArtistSocialScheduleConflict(proposed, [existing])).toThrow(/same minute.*Artist HQ/i)
  })

  test('normalizes copy and blocks it across workspaces for seven days', () => {
    const proposed = entry({
      id: 'campaign-post',
      startAt: '2026-09-15T15:00:00.000Z',
      execution: { type: 'social-publish', platform: 'INSTAGRAM', profileId: ' artist-main ', caption: '  OUT\nFriday. ' },
      inputRefs: [],
    }, 'campaign')
    const conflicts = findArtistSocialPublishConflicts(proposed, [entry({ inputRefs: [] })])
    expect(conflicts.map((conflict) => conflict.kind)).toEqual(['copy'])
  })

  test('blocks reuse of the same approved asset even when copy changes', () => {
    const proposed = entry({
      id: 'campaign-post',
      startAt: '2026-09-15T15:00:00.000Z',
      execution: { type: 'social-publish', platform: 'instagram', profileId: 'artist-main', caption: 'Different caption.' },
    }, 'campaign')
    expect(findArtistSocialPublishConflicts(proposed, [entry()])[0]?.kind).toBe('asset')
  })

  test('allows different accounts and posts outside the seven-day window', () => {
    const differentAccount = entry({
      id: 'different-account',
      execution: { type: 'social-publish', platform: 'instagram', profileId: 'artist-alt', caption: 'Out Friday.' },
    }, 'campaign')
    const later = entry({ id: 'later', startAt: '2026-09-17T15:00:00.001Z' }, 'campaign')
    expect(findArtistSocialPublishConflicts(differentAccount, [entry()])).toEqual([])
    expect(findArtistSocialPublishConflicts(later, [entry()])).toEqual([])
  })

  test('keeps the exact seven-day boundary inside the duplicate window', () => {
    const proposed = entry({ id: 'boundary', startAt: '2026-09-17T15:00:00.000Z', inputRefs: [] }, 'campaign')
    expect(findArtistSocialPublishConflicts(proposed, [entry({ inputRefs: [] })])[0]?.kind).toBe('copy')
  })

  test('rejects an invalid proposed publish time instead of silently skipping it', () => {
    expect(() => findArtistSocialPublishConflicts(entry({ startAt: 'not-a-date' }), [])).toThrow(/time is invalid/i)
  })

  test('ignores the same order plus inactive, canceled, and deleted work', () => {
    const proposed = entry()
    expect(findArtistSocialPublishConflicts(proposed, [
      proposed,
      entry({ id: 'draft', status: 'draft' }, 'campaign'),
      entry({ id: 'setup', status: 'needs-setup' }, 'campaign'),
      entry({ id: 'canceled', status: 'canceled' }, 'campaign'),
      entry({ id: 'deleted', deletedAt: '2026-09-02T00:00:00.000Z' }, 'campaign'),
    ])).toEqual([])
  })

  test('execution lets only the earliest-created stale duplicate proceed', () => {
    const first = entry({ id: 'first', createdAt: '2026-09-01T10:00:00.000Z' })
    const second = entry({ id: 'second', createdAt: '2026-09-01T11:00:00.000Z' }, 'campaign')
    expect(() => assertArtistSocialPublishMayExecute(first, [first, second])).not.toThrow()
    expect(() => assertArtistSocialPublishMayExecute(second, [first, second])).toThrow(/Publish blocked/i)
  })

  test('execution never retries around a duplicate that may already have published', () => {
    const earlier = entry({ id: 'earlier', createdAt: '2026-09-01T10:00:00.000Z' })
    const laterButRunning = entry({ id: 'running', status: 'running', createdAt: '2026-09-01T11:00:00.000Z' }, 'campaign')
    expect(() => assertArtistSocialPublishMayExecute(earlier, [earlier, laterButRunning])).toThrow(/Publish blocked/i)
  })

  test('serializes concurrent scheduling decisions', async () => {
    const { withArtistSocialScheduleLock } = await import('./SocialPublishConflictGuard')
    const events: string[] = []
    let releaseFirst!: () => void
    const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve })
    const first = withArtistSocialScheduleLock(async () => {
      events.push('first-start')
      await firstDone
      events.push('first-end')
    })
    const second = withArtistSocialScheduleLock(() => { events.push('second') })
    await Promise.resolve()
    expect(events).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'first-end', 'second'])
  })
})
