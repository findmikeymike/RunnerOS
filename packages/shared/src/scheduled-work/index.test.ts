import { describe, expect, test } from 'bun:test'
import {
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendar,
} from '../campaign-calendar/index.ts'
import {
  applyScheduledWorkMutation,
  emptyScheduledWorkDocument,
  migrateCampaignCalendarJobs,
  parseScheduledWorkDocResult,
  serializeScheduledWorkBody,
} from './index.ts'
import { hqSemanticIntentId } from '../hq-state/intent.ts'

function calendarWithJob(actionType: 'ask-agent' | 'run-workflow' | 'post-asset' | 'outreach-batch' = 'ask-agent'): CampaignCalendar {
  const payload = actionType === 'run-workflow'
    ? { workflowSlug: 'launch-campaign', workflowDigest: 'workflow-definition-v1', triggerInputs: { market: 'US' } }
    : actionType === 'post-asset'
      ? { caption: 'Out Friday.' }
      : { prompt: 'Create the launch copy.', agentSlug: 'content-genius' }
  return {
    version: 1,
    campaignId: 'campaign-1',
    items: [createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-12',
      time: '10:00',
      title: 'Launch work',
      kind: 'scheduled-job',
      status: actionType === 'post-asset' ? 'needs-approval' : 'scheduled',
      finalRefs: actionType === 'post-asset' ? [{ outputId: 'output-1', assetId: 'asset-1' }] : [],
      socialProfileRefs: actionType === 'post-asset' ? [{ platform: 'instagram', profileId: 'artist-main' }] : undefined,
      job: createCampaignScheduledJob({
        runAt: '2026-07-12T15:00:00.000Z',
        actionType,
        payload,
      }),
    })],
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

describe('scheduled work documents', () => {
  test('accepts the YouTube Intelligence report postprocessor contract', () => {
    const work = emptyScheduledWorkDocument('workspace-1')
    work.items.push({
      version: 1,
      id: 'weekly-youtube-intel',
      owner: { scope: 'hq', workspaceId: 'workspace-1' },
      calendarLink: { calendar: 'hq', itemId: 'hidden-weekly-youtube-intel' },
      calendarVisibility: 'hidden',
      intentId: 'weekly-youtube-intel',
      title: 'Weekly YouTube Intelligence Report',
      type: 'agent-task',
      status: 'scheduled',
      startAt: '2026-07-13T10:00:00.000Z',
      timezone: 'America/Chicago',
      execution: {
        type: 'agent-task',
        agentSlug: 'youtube-intelligence-agent',
        brief: 'Scan configured trusted channels.',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'required', kind: 'report' },
        postProcess: 'youtube-intelligence',
      },
      inputRefs: [], approvals: [], runs: [],
      executionKey: { payloadDigest: 'digest', idempotencyKey: 'weekly-key' },
      createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    })

    const parsed = parseScheduledWorkDocResult({ body: serializeScheduledWorkBody(work) }, 'workspace-1')
    expect(parsed.ok).toBe(true)
    expect(parsed.work.items[0]?.intentId).toBe('weekly-youtube-intel')
  })

  test('round-trips a migrated agent task without removing the embedded job', () => {
    const calendar = calendarWithJob()
    const originalJobId = calendar.items[0]!.job!.id

    const migrated = migrateCampaignCalendarJobs(calendar, emptyScheduledWorkDocument('campaign-1'))

    expect(migrated.migrated).toBe(1)
    expect(migrated.calendar.items[0]?.scheduledWorkId).toBe(`scheduled-work-${originalJobId}`)
    expect(migrated.calendar.items[0]?.job?.id).toBe(originalJobId)
    expect(migrated.work.items[0]).toMatchObject({
      id: `scheduled-work-${originalJobId}`,
      owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
      type: 'agent-task',
      execution: {
        type: 'agent-task',
        agentSlug: 'content-genius',
        brief: 'Create the launch copy.',
      },
      legacyRef: { campaignItemId: calendar.items[0]!.id, campaignJobId: originalJobId },
    })

    const calendarRoundTrip = parseCampaignCalendarDocResult({
      body: serializeCampaignCalendarBody(migrated.calendar),
    }, 'campaign-1')
    expect(calendarRoundTrip.ok).toBe(true)
    expect(calendarRoundTrip.calendar.items[0]?.scheduledWorkId).toBe(`scheduled-work-${originalJobId}`)

    const body = serializeScheduledWorkBody(migrated.work)
    const parsed = parseScheduledWorkDocResult({
      body,
    }, 'campaign-1')

    expect(parsed.ok).toBe(true)
    expect(parsed.work.items).toHaveLength(1)
    expect(parsed.work.items[0]?.intentId).toBe(hqSemanticIntentId({ title: 'Launch work', intent: JSON.stringify(parsed.work.items[0]?.execution) }))
  })

  test('is idempotent when migration runs repeatedly', () => {
    const first = migrateCampaignCalendarJobs(calendarWithJob('run-workflow'), emptyScheduledWorkDocument('campaign-1'))
    const second = migrateCampaignCalendarJobs(first.calendar, first.work)

    expect(first.migrated).toBe(1)
    expect(second.migrated).toBe(0)
    expect(second.work.items).toHaveLength(1)
    expect(second.calendar.items[0]?.job).toBeDefined()
  })

  test('migrates exact social bindings into a social publish work order', () => {
    const migrated = migrateCampaignCalendarJobs(calendarWithJob('post-asset'), emptyScheduledWorkDocument('campaign-1'))

    expect(migrated.work.items[0]).toMatchObject({
      type: 'social-publish',
      status: 'needs-approval',
      execution: {
        type: 'social-publish',
        platform: 'instagram',
        profileId: 'artist-main',
        caption: 'Out Friday.',
      },
      inputRefs: [{ kind: 'final', outputId: 'output-1', assetId: 'asset-1' }],
    })
  })

  test('leaves unsupported legacy actions embedded for the old runner', () => {
    const calendar = calendarWithJob('outreach-batch')
    const migrated = migrateCampaignCalendarJobs(calendar, emptyScheduledWorkDocument('campaign-1'))

    expect(migrated.migrated).toBe(0)
    expect(migrated.work.items).toEqual([])
    expect(migrated.calendar.items[0]?.scheduledWorkId).toBeUndefined()
    expect(migrated.calendar.items[0]?.job?.actionType).toBe('outreach-batch')
  })

  test('reports malformed documents without throwing', () => {
    const result = parseScheduledWorkDocResult({
      body: '```json\n{broken\n```',
    }, 'campaign-1')

    expect(result.ok).toBe(false)
    expect(result.work.items).toEqual([])
  })

  test('rejects malformed field types without throwing', () => {
    const result = parseScheduledWorkDocResult({
      body: `\`\`\`json\n${JSON.stringify({
        version: 1,
        workspaceId: 'campaign-1',
        items: [{ version: 1, id: 42, startAt: false }],
      })}\n\`\`\``,
    }, 'campaign-1')

    expect(result.ok).toBe(false)
  })

  test('rejects documents containing mismatched or unsupported execution types', () => {
    const result = parseScheduledWorkDocResult({
      body: `\`\`\`json\n${JSON.stringify({
        version: 1,
        workspaceId: 'campaign-1',
        items: [{
          version: 1,
          id: 'bad-order',
          owner: { scope: 'campaign', workspaceId: 'campaign-1' },
          calendarLink: { calendar: 'campaign', itemId: 'item-1' },
          title: 'Bad',
          type: 'agent-task',
          status: 'scheduled',
          startAt: '2026-07-12T15:00:00.000Z',
          timezone: 'UTC',
          execution: { type: 'social-publish' },
          inputRefs: [],
          approvals: [],
          runs: [],
          executionKey: { payloadDigest: 'x', idempotencyKey: 'y' },
          createdAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        }],
        updatedAt: '2026-07-10T00:00:00.000Z',
      })}\n\`\`\``,
    }, 'campaign-1')

    expect(result.ok).toBe(false)
    expect(result.work.items).toEqual([])
  })

  test('applies owner-scoped upsert and cancel mutations', () => {
    const migrated = migrateCampaignCalendarJobs(calendarWithJob(), emptyScheduledWorkDocument('campaign-1'))
    const order = migrated.work.items[0]!
    const empty = emptyScheduledWorkDocument('campaign-1')

    const added = applyScheduledWorkMutation(empty, { operation: 'upsert', order, expectedUpdatedAt: null })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.work.items).toHaveLength(1)

    const canceled = applyScheduledWorkMutation(added.work, {
      operation: 'cancel',
      id: order.id,
      expectedUpdatedAt: added.item.updatedAt,
    })
    expect(canceled.ok).toBe(true)
    if (canceled.ok) expect(canceled.item.status).toBe('canceled')
  })

  test('rejects work orders owned by another workspace', () => {
    const migrated = migrateCampaignCalendarJobs(calendarWithJob(), emptyScheduledWorkDocument('campaign-1'))
    const order = { ...migrated.work.items[0]!, owner: { scope: 'campaign' as const, workspaceId: 'campaign-2', campaignId: 'campaign-2' } }

    const result = applyScheduledWorkMutation(emptyScheduledWorkDocument('campaign-1'), {
      operation: 'upsert',
      order,
      expectedUpdatedAt: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('workspace')
  })

  test('rejects malformed upserts instead of persisting work that disappears on read', () => {
    const valid = migrateCampaignCalendarJobs(calendarWithJob(), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const malformed = {
      ...valid,
      execution: { type: 'social-publish' as const, platform: '', profileId: '', caption: '' },
    }

    const result = applyScheduledWorkMutation(emptyScheduledWorkDocument('campaign-1'), {
      operation: 'upsert',
      order: malformed as never,
      expectedUpdatedAt: null,
    })

    expect(result.ok).toBe(false)
  })

  test('rejects stale updates that would erase runner-owned state', () => {
    const order = migrateCampaignCalendarJobs(calendarWithJob(), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const current = {
      ...emptyScheduledWorkDocument('campaign-1'),
      items: [{ ...order, status: 'running' as const, updatedAt: '2026-07-12T15:01:00.000Z' }],
    }

    const result = applyScheduledWorkMutation(current, {
      operation: 'upsert',
      order,
      expectedUpdatedAt: order.updatedAt,
    })

    expect(result.ok).toBe(false)
    expect(result.work.items[0]?.status).toBe('running')
  })

  test('rejects impossible owner and calendar combinations', () => {
    const order = migrateCampaignCalendarJobs(calendarWithJob(), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const invalid = {
      ...order,
      owner: { scope: 'hq' as const, workspaceId: 'campaign-1' },
    }

    const result = applyScheduledWorkMutation(emptyScheduledWorkDocument('campaign-1'), {
      operation: 'upsert',
      order: invalid,
      expectedUpdatedAt: null,
    })

    expect(result.ok).toBe(false)
  })

  test('rejects a scheduled-work document owned by another workspace', () => {
    const body = serializeScheduledWorkBody(emptyScheduledWorkDocument('campaign-2'))
    const result = parseScheduledWorkDocResult({ body }, 'campaign-1')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('campaign-2')
  })

  test('leaves legacy workflow jobs embedded when no definition digest was captured', () => {
    const calendar = calendarWithJob('run-workflow')
    calendar.items[0]!.job!.payload = { workflowSlug: 'launch-campaign', triggerInputs: { market: 'US' } }

    const result = migrateCampaignCalendarJobs(calendar, emptyScheduledWorkDocument('campaign-1'))

    expect(result.migrated).toBe(0)
    expect(result.work.items).toEqual([])
    expect(result.calendar.items[0]?.job).toBeDefined()
  })

  test('leaves generic legacy agent jobs embedded when no agent identity was captured', () => {
    const calendar = calendarWithJob()
    calendar.items[0]!.job!.payload = { prompt: 'Create the launch copy.' }

    const result = migrateCampaignCalendarJobs(calendar, emptyScheduledWorkDocument('campaign-1'))

    expect(result.migrated).toBe(0)
    expect(result.work.items).toEqual([])
    expect(result.calendar.items[0]?.job).toBeDefined()
  })
})
