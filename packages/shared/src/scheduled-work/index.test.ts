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
  listReleaseKitItemUses,
  migrateCampaignCalendarJobs,
  parseScheduledWorkDocResult,
  serializeScheduledWorkBody,
  stableScheduledWorkAuthorizationStringify,
  summarizeReleaseKitItemUses,
  type ScheduledWorkOrder,
} from './index.ts'
import { hqSemanticIntentId } from '../hq-state/intent.ts'

test('authorization serialization is stable across key order and omits undefined fields', () => {
  const left = { title: 'Post', releaseKitRef: { itemId: 'item-1', sha256: 'a'.repeat(64), label: undefined }, platform: 'x', profileId: 'main', caption: 'Now.', platformOptions: { z: 2, a: 1 }, startAt: '2026-09-01T12:00:00.000Z', timezone: 'UTC' }
  const right = { timezone: 'UTC', startAt: '2026-09-01T12:00:00.000Z', platformOptions: { a: 1, z: 2 }, caption: 'Now.', profileId: 'main', platform: 'x', releaseKitRef: { sha256: 'a'.repeat(64), itemId: 'item-1' }, title: 'Post' }
  expect(stableScheduledWorkAuthorizationStringify(left)).toBe(stableScheduledWorkAuthorizationStringify(right))
})

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
  test('requires coherent workflow input-request state', () => {
    const base: ScheduledWorkOrder = {
      version: 1,
      id: 'workflow-needs-input',
      owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
      calendarLink: { calendar: 'campaign', itemId: 'workflow-needs-input-calendar' },
      title: 'Merch run',
      type: 'workflow-run',
      status: 'needs-setup',
      startAt: '2026-07-13T10:00:00.000Z',
      timezone: 'UTC',
      execution: { type: 'workflow-run', workflowSlug: 'merch-run', workflowDigest: 'digest', triggerInputs: {} },
      inputRefs: [], approvals: [], runs: [],
      attention: { reason: 'input-required', message: 'Waiting for: design_file' },
      inputRequest: {
        id: 'workflow-needs-input:input',
        inputs: ['design_file'],
        requestedAt: '2026-07-10T00:00:00.000Z',
        lastTriggeredAt: '2026-07-10T00:00:00.000Z',
        coalescedFireCount: 1,
        fireDefinitionDigests: ['fire-1'],
      },
      executionKey: { payloadDigest: 'digest', idempotencyKey: 'key' },
      createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
    }
    const parse = (order: ScheduledWorkOrder) => parseScheduledWorkDocResult({
      body: serializeScheduledWorkBody({ version: 1, workspaceId: 'campaign-1', items: [order], updatedAt: order.updatedAt }),
    }, 'campaign-1')

    expect(parse(base).ok).toBe(true)
    expect(parse({ ...base, status: 'scheduled' }).ok).toBe(false)
    expect(parse({ ...base, type: 'agent-task', execution: {
      type: 'agent-task', agentSlug: 'writer', brief: 'Write.', permissionMode: 'safe', expectedOutput: { requirement: 'none' },
    } }).ok).toBe(false)
    expect(parse({ ...base, inputRequest: undefined }).ok).toBe(false)

    const canceled = applyScheduledWorkMutation(
      { version: 1, workspaceId: 'campaign-1', items: [base], updatedAt: base.updatedAt },
      { operation: 'cancel', id: base.id, expectedUpdatedAt: base.updatedAt },
    )
    expect(canceled.ok).toBe(true)
    if (canceled.ok) {
      expect(canceled.item).toMatchObject({ status: 'canceled', attention: undefined, inputRequest: undefined })
      expect(parseScheduledWorkDocResult({ body: serializeScheduledWorkBody(canceled.work) }, 'campaign-1').ok).toBe(true)
    }
  })

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

  test('converts a legacy agent task into one canonical work order', () => {
    const calendar = calendarWithJob()
    const originalJobId = calendar.items[0]!.job!.id

    const migrated = migrateCampaignCalendarJobs(calendar, emptyScheduledWorkDocument('campaign-1'))

    expect(migrated.migrated).toBe(1)
    expect(migrated.calendar.items[0]?.scheduledWorkId).toBe(`scheduled-work-${originalJobId}`)
    expect(migrated.calendar.items[0]?.job).toBeUndefined()
    expect(migrated.work.items[0]).toMatchObject({
      id: `scheduled-work-${originalJobId}`,
      owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
      type: 'agent-task',
      execution: {
        type: 'agent-task',
        agentSlug: 'content-genius',
        brief: 'Create the launch copy.',
      },
    })
    expect(migrated.work.items[0]?.legacyRef).toBeUndefined()

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
    expect(second.calendar.items[0]?.job).toBeUndefined()
  })

  test('quarantines a legacy job that may already have started', () => {
    const calendar = calendarWithJob()
    calendar.items[0] = { ...calendar.items[0]!, status: 'running' }

    const migrated = migrateCampaignCalendarJobs(calendar, emptyScheduledWorkDocument('campaign-1'))

    expect(migrated.calendar.items[0]?.job).toBeUndefined()
    expect(migrated.work.items[0]).toMatchObject({
      status: 'needs-attention',
      attention: { reason: 'execution-uncertain' },
    })
  })

  test('does not bind a legacy job to a conflicting scheduled-work id', () => {
    const calendar = calendarWithJob()
    const job = calendar.items[0]!.job!
    calendar.items[0] = { ...calendar.items[0]!, scheduledWorkId: 'existing-order' }
    const work = emptyScheduledWorkDocument('campaign-1')
    work.items.push({
      ...migrateCampaignCalendarJobs(calendarWithJob(), emptyScheduledWorkDocument('campaign-1')).work.items[0]!,
      id: 'existing-order',
      calendarLink: { calendar: 'campaign', itemId: 'different-calendar-item' },
    })

    const migrated = migrateCampaignCalendarJobs(calendar, work)

    expect(migrated.migrated).toBe(0)
    expect(migrated.calendar.items[0]?.job?.id).toBe(job.id)
    expect(migrated.work.items).toHaveLength(1)
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

  test('leaves unsupported legacy actions embedded without making them runnable', () => {
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

  test('rejects malformed durable authorization records', () => {
    const order = migrateCampaignCalendarJobs(calendarWithJob('post-asset'), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const body = serializeScheduledWorkBody({
      ...emptyScheduledWorkDocument('campaign-1'),
      items: [{ ...order, authorizationPolicy: 'durable-v1', authorization: { approvedBy: { type: 'agent' } } } as never],
    })

    expect(parseScheduledWorkDocResult({ body }, 'campaign-1').ok).toBe(false)
  })

  test('round-trips a host-minted text-only X Editorial authorization', () => {
    const base = migrateCampaignCalendarJobs(calendarWithJob('post-asset'), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const definition = {
      kind: 'x-editorial' as const,
      title: 'X worldview post',
      xEditorialRef: {
        outputId: '11111111-2222-4333-8444-555555555555',
        slateId: 'xslate_1',
        candidateId: 'post_1',
        revision: 1,
      },
      platform: 'x' as const,
      profileId: 'artist-main',
      caption: 'Art should leave a bruise, not a brochure.',
      startAt: '2026-07-12T15:00:00.000Z',
      timezone: 'UTC',
    }
    const order: ScheduledWorkOrder = {
      ...base,
      title: definition.title,
      execution: { type: 'social-publish', platform: 'x', profileId: definition.profileId, caption: definition.caption },
      inputRefs: [],
      authorizationPolicy: 'durable-v1',
      authorization: {
        id: 'x-auth-1',
        authorizedAt: '2026-07-12T14:00:00.000Z',
        payloadDigest: 'digest-x',
        authorizedBy: { type: 'user', clientId: 'client-1', source: 'x-editorial-ui' },
        definition,
      },
    }
    const body = serializeScheduledWorkBody({
      ...emptyScheduledWorkDocument('campaign-1'),
      items: [order],
    })

    const parsed = parseScheduledWorkDocResult({ body }, 'campaign-1')
    expect(parsed.ok).toBe(true)
    expect(parsed.work.items[0]?.authorization?.definition).toEqual(definition)
  })

  test('rejects X Editorial authorization with a non-user authorizer', () => {
    const base = migrateCampaignCalendarJobs(calendarWithJob('post-asset'), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const body = serializeScheduledWorkBody({
      ...emptyScheduledWorkDocument('campaign-1'),
      items: [{
        ...base,
        inputRefs: [],
        authorizationPolicy: 'durable-v1',
        authorization: {
          id: 'x-auth-forged', authorizedAt: '2026-07-12T14:00:00.000Z', payloadDigest: 'digest-x',
          authorizedBy: { type: 'agent', clientId: 'agent-1', source: 'x-editorial-ui' },
          definition: {
            kind: 'x-editorial', title: 'Forged',
            xEditorialRef: { outputId: '11111111-2222-4333-8444-555555555555', slateId: 'xslate_1', candidateId: 'post_1', revision: 1 },
            platform: 'x', profileId: 'artist-main', caption: 'Forged.', startAt: '2026-07-12T15:00:00.000Z', timezone: 'UTC',
          },
        },
      } as never],
    })

    expect(parseScheduledWorkDocResult({ body }, 'campaign-1').ok).toBe(false)
  })

  test('rejects social completion without a verifiable receipt shape', () => {
    const order = migrateCampaignCalendarJobs(calendarWithJob('post-asset'), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const body = serializeScheduledWorkBody({
      ...emptyScheduledWorkDocument('campaign-1'),
      items: [{ ...order, status: 'done', result: { type: 'social-publish', receipt: { id: 'missing-proof' } } } as never],
    })

    expect(parseScheduledWorkDocResult({ body }, 'campaign-1').ok).toBe(false)
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

  test('lists exact Release Kit uses with stable attention, future, and history ordering', () => {
    const base = migrateCampaignCalendarJobs(calendarWithJob('post-asset'), emptyScheduledWorkDocument('campaign-1')).work.items[0]!
    const makeOrder = (id: string, status: ScheduledWorkOrder['status'], startAt: string, itemId = 'kit-1'): ScheduledWorkOrder => ({
      ...base,
      id,
      status,
      startAt,
      inputRefs: [{ kind: 'release-kit', itemId, sha256: 'a'.repeat(64) }],
      result: status === 'done' ? {
        type: 'social-publish',
        receipt: {
          id: `receipt-${id}`, actionType: 'post-asset', platform: 'instagram',
          completedAt: startAt, payloadDigest: 'digest', approvalId: 'approval', externalUrl: 'https://example.com/post',
        },
      } : undefined,
      attention: status === 'needs-attention' ? { reason: 'execution-failed', message: 'Reconnect Instagram.' } : undefined,
    })
    const work = {
      ...emptyScheduledWorkDocument('campaign-1'),
      items: [
        makeOrder('done-old', 'done', '2026-08-01T12:00:00.000Z'),
        { ...makeOrder('done-unverified', 'done', '2026-08-02T12:00:00.000Z'), result: undefined },
        makeOrder('future-late', 'scheduled', '2026-10-01T12:00:00.000Z'),
        makeOrder('other-asset', 'scheduled', '2026-09-01T12:00:00.000Z', 'kit-2'),
        { ...makeOrder('deleted', 'scheduled', '2026-09-01T12:00:00.000Z'), deletedAt: '2026-08-10T00:00:00.000Z' },
        makeOrder('attention', 'needs-attention', '2026-07-01T12:00:00.000Z'),
        { ...makeOrder('needs-input', 'needs-setup', '2026-07-02T12:00:00.000Z'), attention: { reason: 'input-required' as const, message: 'Waiting for: caption' }, inputRequest: { id: 'needs-input:input', inputs: ['caption'], requestedAt: '2026-07-02T12:00:00.000Z', lastTriggeredAt: '2026-07-02T12:00:00.000Z', coalescedFireCount: 1, fireDefinitionDigests: ['fire-input'] } },
        makeOrder('future-soon', 'scheduled', '2026-09-01T12:00:00.000Z'),
        makeOrder('canceled-new', 'canceled', '2026-08-15T12:00:00.000Z'),
      ],
    }

    expect(listReleaseKitItemUses(work, 'kit-1', new Date('2026-08-20T00:00:00.000Z')).map((order) => order.id)).toEqual([
      'attention', 'needs-input', 'done-unverified', 'future-soon', 'future-late', 'canceled-new', 'done-old',
    ])
    expect(summarizeReleaseKitItemUses(work, 'kit-1', { now: new Date('2026-08-20T00:00:00.000Z') })
      .find((use) => use.orderId === 'needs-input')?.status).toBe('needs-setup')
    expect(summarizeReleaseKitItemUses(work, 'kit-1', { now: new Date('2026-08-20T00:00:00.000Z') })).toMatchObject([
      { orderId: 'attention', status: 'needs-attention', attentionMessage: 'Reconnect Instagram.' },
      { orderId: 'needs-input', status: 'needs-setup', attentionMessage: 'Waiting for: caption' },
      { orderId: 'done-unverified', status: 'needs-attention', attentionMessage: expect.stringContaining('receipt is missing') },
      { orderId: 'future-soon', status: 'scheduled' },
      { orderId: 'future-late', status: 'scheduled' },
      { orderId: 'canceled-new', status: 'canceled' },
      { orderId: 'done-old', status: 'done', receipt: { externalUrl: 'https://example.com/post' } },
    ])
  })
})
