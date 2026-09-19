import { describe, expect, test } from 'bun:test'
import { applyScheduledWorkMutation, parseScheduledWorkDocResult, serializeScheduledWorkBody, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
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

test.each(['cancel', 'delete'] as const)('%s preserves execution evidence but releases never-submitted work', action => {
  const replacement = entry({ id: 'replacement' }, 'campaign')
  for (const state of ['running', 'confirmed', 'legacy-canceled', 'pre-submit-failed', 'draft'] as const) {
    const prior = entry({ id: `prior-${state}`, status: state === 'draft' ? 'draft' : state === 'legacy-canceled' ? 'canceled' : state === 'running' ? 'running' : 'needs-attention' })
    if (state !== 'draft') prior.order.runs = [{ id: 'attempt', jobId: prior.order.id, startedAt: prior.order.startAt,
      status: state === 'running' ? 'running' : state === 'confirmed' ? 'done' : 'failed' }]
    if (state === 'pre-submit-failed') prior.order.attention = { reason: 'execution-failed', message: 'Upload unavailable' }
    const changed = applyScheduledWorkMutation({ version: 1, workspaceId: 'hq', items: [prior.order], updatedAt: prior.order.updatedAt },
      { operation: action, id: prior.order.id, expectedUpdatedAt: prior.order.updatedAt }, '2026-09-10T15:02:00.000Z')
    expect(changed.ok).toBe(true)
    if (!changed.ok) throw new Error(changed.error)
    const parsed = parseScheduledWorkDocResult({ body: serializeScheduledWorkBody(changed.work) }, 'hq')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error)
    expect(findArtistSocialPublishConflicts(replacement, [{ ...prior, order: parsed.work.items[0]! }])).toHaveLength(
      state === 'pre-submit-failed' || state === 'draft' ? 0 : 1,
    )
  }
})

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


test('an exact replacement can follow a pre-submit failure, but never an uncertain submission', () => {
  const failed = entry({ status: 'needs-attention' })
  failed.order.attention = { reason: 'execution-failed', message: 'Upload control unavailable' }
  const replacement = entry({ id: 'replacement', startAt: '2026-09-10T16:00:00.000Z' }, 'campaign')
  expect(findArtistSocialPublishConflicts(replacement, [failed])).toEqual([])
  failed.order.attention!.reason = 'execution-uncertain'
  expect(findArtistSocialPublishConflicts(replacement, [failed])).toHaveLength(1)
  failed.order.attention = undefined
  expect(findArtistSocialPublishConflicts(replacement, [failed])).toHaveLength(1)
})

// Independent review reproduction: older pending work vs later uncertain dispatch.
test('a newer uncertain submission blocks an older duplicate at execution', () => {
  const older = entry({ id: 'older', status: 'running', createdAt: '2026-09-01T10:00:00.000Z' })
  const newer = entry({ id: 'newer', status: 'needs-attention', createdAt: '2026-09-01T11:00:00.000Z' }, 'campaign')
  newer.order.attention = { reason: 'execution-uncertain', message: 'Response lost after submit' }
  newer.order.runs = [{ id: 'attempt', jobId: 'newer', status: 'failed', startedAt: '2026-09-10T15:00:00.000Z', endedAt: '2026-09-10T15:01:00.000Z', error: 'Response lost after submit' }]
  expect(findArtistSocialPublishConflicts(older, [newer])).toHaveLength(1)
  expect(() => assertArtistSocialPublishMayExecute(older, [newer])).toThrow(/Publish blocked/i)
})

for (const action of ['cancel', 'delete'] as const) test(`${action} cannot erase uncertain-send duplicate protection`, async () => {
  const prior = entry({ id: 'uncertain', status: 'needs-attention' })
  prior.order.attention = { reason: 'execution-uncertain', message: 'Response lost after submit' }
  prior.order.runs = [{ id: 'attempt', jobId: 'uncertain', status: 'failed', startedAt: '2026-09-10T15:00:00.000Z', endedAt: '2026-09-10T15:01:00.000Z', error: 'Response lost after submit' }]
  const replacement = entry({ id: 'replacement', startAt: '2026-09-10T16:00:00.000Z' }, 'campaign')
  expect(findArtistSocialPublishConflicts(replacement, [prior])).toHaveLength(1)
  const result = applyScheduledWorkMutation({ version: 1, workspaceId: 'hq', items: [prior.order], updatedAt: prior.order.updatedAt }, { operation: action, id: prior.order.id, expectedUpdatedAt: prior.order.updatedAt }, '2026-09-10T15:02:00.000Z')
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.error)
  const reopened = parseScheduledWorkDocResult({ body: serializeScheduledWorkBody(result.work) }, 'hq')
  expect(reopened.ok).toBe(true)
  if (!reopened.ok) throw new Error(reopened.error)
  expect(findArtistSocialPublishConflicts(replacement, [{ ...prior, order: reopened.work.items[0]! }])).toHaveLength(1)
})
