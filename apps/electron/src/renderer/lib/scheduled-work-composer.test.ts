import { describe, expect, test } from 'bun:test'
import {
  composerReviewSentence,
  composerDefinitionDigest,
  buildCampaignScheduleFromComposer,
  buildCampaignSchedulePlanFromComposer,
  buildAutomationQueueWorkAction,
  applyWorkflowRunComposerPrefill,
  createScheduledWorkComposerDraft,
  selectScheduledWorkComposerType,
  validateComposerDraft,
  validateComposerSection,
} from './scheduled-work-composer'

const defaults = {
  owner: { scope: 'campaign' as const, workspaceId: 'campaign-1', campaignId: 'campaign-1' },
  date: '2026-07-12',
  timezone: 'America/Chicago',
}

describe('scheduled work composer drafts', () => {
  test('starts as a compact Event without executable fields', () => {
    expect(createScheduledWorkComposerDraft(defaults)).toEqual(expect.objectContaining({
      type: 'event',
      date: '2026-07-12',
      timezone: 'America/Chicago',
      endTime: '',
    }))
  })

  test('creates a typed draft for every queue choice', () => {
    const event = createScheduledWorkComposerDraft(defaults)
    expect(selectScheduledWorkComposerType(event, 'agent-task')).toEqual(expect.objectContaining({ type: 'agent-task', agentSlug: '', brief: '' }))
    expect(selectScheduledWorkComposerType(event, 'workflow-run')).toEqual(expect.objectContaining({ type: 'workflow-run', workflowSlug: '', triggerInputs: {} }))
    expect(selectScheduledWorkComposerType(event, 'social-publish')).toEqual(expect.objectContaining({ type: 'social-publish', profileId: '', caption: '' }))
    expect(selectScheduledWorkComposerType(event, 'review')).toEqual(expect.objectContaining({ type: 'review', reviewerType: 'user' }))
  })

  test('changing queue type preserves common answers and invalidates dependent answers', () => {
    const agent = {
      ...selectScheduledWorkComposerType(createScheduledWorkComposerDraft(defaults), 'agent-task'),
      title: 'Launch copy',
      time: '10:00',
      agentSlug: 'content-genius',
      agentName: 'Content Genius',
      brief: 'Write launch copy.',
      inputRefs: [{ kind: 'output' as const, outputId: 'output-1', title: 'Campaign brief' }],
    }

    const workflow = selectScheduledWorkComposerType(agent, 'workflow-run')

    expect(workflow).toEqual(expect.objectContaining({
      type: 'workflow-run',
      title: 'Launch copy',
      time: '10:00',
      workflowSlug: '',
      inputRefs: [{ kind: 'output', outputId: 'output-1', title: 'Campaign brief' }],
    }))
    expect('agentSlug' in workflow).toBe(false)
  })

  test('requires executable targets but keeps Event creation quick', () => {
    const event = { ...createScheduledWorkComposerDraft(defaults), title: 'Release day' }
    expect(validateComposerDraft(event)).toBeUndefined()

    const agent = {
      ...selectScheduledWorkComposerType(event, 'agent-task'),
      time: '10:00',
      brief: 'Prepare copy.',
    }
    expect(validateComposerDraft(agent)).toBe('Choose an active agent.')
  })

  test('blocks each wizard section at the field that needs attention', () => {
    const initial = createScheduledWorkComposerDraft({ ...defaults, suggestedType: 'agent-task' })
    if (initial.type !== 'agent-task') throw new Error('Expected agent draft')

    expect(validateComposerSection(initial, 'inputs')).toBe('Add a title.')
    expect(validateComposerSection({ ...initial, title: 'Draft copy' }, 'inputs')).toBe('Add a clear brief.')
    expect(validateComposerSection({ ...initial, title: 'Draft copy', brief: 'Write it.' }, 'inputs')).toBeUndefined()
    expect(validateComposerSection(initial, 'runner')).toBe('Choose an active agent.')
    expect(validateComposerSection({ ...initial, agentSlug: 'writer' }, 'timing')).toBe('Choose a start time.')
  })

  test('writes a plain-language footer summary', () => {
    const agent = {
      ...selectScheduledWorkComposerType(createScheduledWorkComposerDraft(defaults), 'agent-task'),
      agentName: 'Content Genius',
      time: '10:00',
      expectedOutput: { requirement: 'required' as const, kind: 'document' as const, title: 'Social Copy Output' },
    }

    expect(composerReviewSentence(agent)).toContain('Content Genius will start')
    expect(composerReviewSentence(agent)).toContain('Social Copy Output')
  })

  test('binds workflow definitions with a stable digest', () => {
    expect(composerDefinitionDigest({ steps: [{ id: 'write', agent: 'writer' }], name: 'Launch' }))
      .toBe(composerDefinitionDigest({ name: 'Launch', steps: [{ agent: 'writer', id: 'write' }] }))
  })

  test('preserves exact workflow inputs when scheduling an existing workflow', () => {
    const initial = createScheduledWorkComposerDraft({ ...defaults, title: 'Lyric clips', suggestedType: 'workflow-run' })
    const inputs = { lyrics: 'Approved lyrics', master_audio: '/vault/angelina.wav', clips: 4 }
    const result = applyWorkflowRunComposerPrefill(initial, {
      slug: 'lyric-clips',
      name: 'Lyric Clips',
      digest: 'workflow-digest',
      triggerInputs: inputs,
    })

    expect(result).toMatchObject({
      type: 'workflow-run',
      title: 'Lyric clips',
      workflowSlug: 'lyric-clips',
      workflowName: 'Lyric Clips',
      workflowDigest: 'workflow-digest',
      triggerInputs: inputs,
    })
    expect(result.type === 'workflow-run' && result.triggerInputs).not.toBe(inputs)
  })

  test('builds one typed work order and linked campaign shell', () => {
    const initial = createScheduledWorkComposerDraft({
      ...defaults,
      suggestedType: 'social-publish',
      inputRefs: [{ kind: 'release-kit', itemId: 'kit_teaser', sha256: 'a'.repeat(64), label: 'Teaser' }],
    })
    if (initial.type !== 'social-publish') throw new Error('Expected social draft')
    const draft = {
      ...initial,
      requestId: 'request-1',
      title: 'Publish teaser',
      time: '10:00',
      platform: 'instagram',
      profileId: 'artist-main',
      profileLabel: 'Instagram @artist-main',
      caption: 'Out Friday.',
    }

    const result = buildCampaignScheduleFromComposer(draft, '2026-07-10T00:00:00.000Z')

    expect(result.order).toMatchObject({
      id: 'scheduled-work-request-1',
      type: 'social-publish',
      status: 'needs-approval',
      calendarLink: { calendar: 'campaign', itemId: 'campaign-item-request-1' },
    })
    expect(result.calendarItem).toMatchObject({
      id: 'campaign-item-request-1',
      scheduledWorkId: 'scheduled-work-request-1',
      kind: 'scheduled-job',
      status: 'needs-approval',
      releaseKitRefs: [{ itemId: 'kit_teaser', sha256: 'a'.repeat(64), label: 'Teaser' }],
    })
    expect(result.calendarItem.job).toBeUndefined()
  })

  test('requires exact safe YouTube settings and blocks unverified Shorts', () => {
    const initial = createScheduledWorkComposerDraft({
      ...defaults,
      suggestedType: 'social-publish',
      inputRefs: [{ kind: 'release-kit', itemId: 'kit_video', sha256: 'b'.repeat(64) }],
    })
    if (initial.type !== 'social-publish') throw new Error('Expected social draft')
    const draft = {
      ...initial,
      title: 'Publish video',
      time: '10:00',
      platform: 'youtube',
      profileId: 'channel-main',
      caption: 'Official video',
      platformOptions: { postType: 'short', visibility: 'public', madeForKids: 'no' },
    }
    expect(validateComposerDraft(draft)).toMatch(/Shorts classification/)
    expect(validateComposerDraft({
      ...draft,
      platformOptions: { postType: 'video', visibility: 'private', madeForKids: 'no' },
    })).toBeUndefined()
  })

  test('rejects legacy mutable Output refs for new campaign social work', () => {
    const initial = createScheduledWorkComposerDraft({
      ...defaults,
      suggestedType: 'social-publish',
      inputRefs: [{ kind: 'final', outputId: 'output-1', assetId: 'asset-1' }],
    })
    if (initial.type !== 'social-publish') throw new Error('Expected social draft')
    expect(validateComposerDraft({
      ...initial,
      title: 'Publish teaser',
      time: '10:00',
      platform: 'instagram',
      profileId: 'artist-main',
      caption: 'Out Friday.',
    })).toMatch(/Release Kit/)
  })

  test('keeps ask-mode agent tasks runnable while preserving permission mode', () => {
    const initial = createScheduledWorkComposerDraft({ ...defaults, suggestedType: 'agent-task' })
    if (initial.type !== 'agent-task') throw new Error('Expected agent draft')
    const result = buildCampaignScheduleFromComposer({
      ...initial,
      requestId: 'ask-agent-1',
      title: 'Draft launch copy',
      time: '10:00',
      agentSlug: 'content-genius',
      brief: 'Draft the launch copy.',
      permissionMode: 'ask',
    }, '2026-07-10T00:00:00.000Z')

    expect(result.order.status).toBe('scheduled')
    expect(result.calendarItem.status).toBe('scheduled')
    expect(result.order.execution).toMatchObject({ type: 'agent-task', permissionMode: 'ask' })
  })

  test('builds a stable Agent to Review chain with a waiting exact-output child', () => {
    const initial = createScheduledWorkComposerDraft({ ...defaults, suggestedType: 'agent-task' })
    if (initial.type !== 'agent-task') throw new Error('Expected agent draft')
    const plan = buildCampaignSchedulePlanFromComposer({
      ...initial,
      requestId: 'chain-1',
      title: 'Draft launch copy',
      time: '10:00',
      agentSlug: 'content-genius',
      brief: 'Draft the launch copy.',
      followUp: { type: 'review', reviewerType: 'user', reviewerId: '', reviewerName: 'You', outputKind: 'document' },
    }, '2026-07-10T00:00:00.000Z')
    if (!('orders' in plan)) throw new Error('Expected chain plan')

    expect(plan.orders[0]).toMatchObject({ id: 'campaign-chain-chain-1-0', status: 'scheduled', chain: { ordinal: 0 } })
    expect(plan.orders[1]).toMatchObject({
      id: 'campaign-chain-chain-1-1',
      status: 'waiting',
      type: 'review',
      chain: { ordinal: 1, predecessor: { orderId: 'campaign-chain-chain-1-0', releaseOn: 'success' } },
      inputRefs: [{ kind: 'produced-output', selector: { kind: 'document' }, bindTo: { kind: 'review-target' } }],
    })
    expect(plan.calendarItems.map((item) => item.status)).toEqual(['scheduled', 'draft'])
  })

  test('converts the composer draft into a trigger-owned queue-work action', () => {
    const initial = createScheduledWorkComposerDraft({ ...defaults, suggestedType: 'agent-task' })
    if (initial.type !== 'agent-task') throw new Error('Expected agent draft')
    const action = buildAutomationQueueWorkAction({
      ...initial,
      title: 'Draft launch copy',
      time: '10:00',
      agentSlug: 'content-genius',
      brief: 'Draft the launch copy.',
      followUp: { type: 'review', reviewerType: 'user', reviewerId: '', reviewerName: 'You', outputKind: 'document' },
    }, { calendarVisibility: 'hidden' })

    expect(action).toMatchObject({
      type: 'queue-work',
      ownerScope: 'campaign',
      calendarVisibility: 'hidden',
      title: 'Draft launch copy',
      execution: { type: 'agent-task', agentSlug: 'content-genius' },
      followUp: { execution: { type: 'review', reviewerType: 'user' }, outputKind: 'document' },
    })
    expect(action).not.toHaveProperty('date')
    expect(action).not.toHaveProperty('time')
  })
})
