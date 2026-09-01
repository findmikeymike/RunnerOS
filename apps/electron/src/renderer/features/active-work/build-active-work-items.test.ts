import { describe, expect, test } from 'bun:test'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import type { AutomationListItem } from '@/components/automations/types'
import { buildActiveWorkItems, visibleRecurringItems } from './build-active-work-items'

const order = (overrides: Partial<ScheduledWorkOrder>): ScheduledWorkOrder => ({
  version: 1,
  id: 'order-1',
  owner: { scope: 'campaign', workspaceId: 'workspace-1', campaignId: 'workspace-1' },
  calendarLink: { calendar: 'campaign', itemId: 'calendar-1' },
  title: 'Make lyric clips',
  type: 'workflow-run',
  status: 'scheduled',
  startAt: '2026-09-02T15:00:00.000Z',
  timezone: 'UTC',
  execution: { type: 'workflow-run', workflowSlug: 'lyric-clips', workflowDigest: 'digest', triggerInputs: {} },
  inputRefs: [],
  approvals: [],
  runs: [],
  executionKey: { payloadDigest: 'payload', idempotencyKey: 'key' },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const automation = (overrides: Partial<AutomationListItem> = {}): AutomationListItem => ({
  id: 'auto-1',
  event: 'SchedulerTick',
  matcherIndex: 0,
  name: 'Weekly content',
  summary: 'Every Monday',
  enabled: true,
  cron: '0 9 * * 1',
  actions: [],
  ...overrides,
})

describe('buildActiveWorkItems', () => {
  test('keeps an all-paused recurring section visible while collapsing mixed large lists', () => {
    const paused = Array.from({ length: 3 }, (_, index) => ({
      id: `paused-${index}`,
      statusLabel: 'Paused',
    })) as ReturnType<typeof buildActiveWorkItems>
    expect(visibleRecurringItems(paused, false)).toHaveLength(3)
    expect(visibleRecurringItems([
      ...paused,
      { id: 'active', statusLabel: 'Active' },
    ] as ReturnType<typeof buildActiveWorkItems>, false).map((item) => item.id)).toEqual(['active'])
  })

  test('classifies current, upcoming, attention, and recurring work', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [{ id: 'session-1', workspaceId: 'workspace-1', name: 'Artist Manager', isProcessing: true }],
      workflowRuns: [{ id: 'run-1', workspaceId: 'workspace-1', workflowSlug: 'release-qa', state: 'failed', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' }],
      scheduledWork: [order({})],
      automations: [automation()],
      describeCron: () => 'At 09:00 (weekday: 1)',
    })

    expect(items.map((item) => item.section)).toEqual(['attention', 'running', 'up-next', 'recurring'])
    expect(items.find((item) => item.sourceId === 'run-1')?.statusLabel).toBe('Failed')
    expect(items.find((item) => item.sourceId === 'auto-1' && item.section === 'recurring')?.cadenceLabel).toBe('Weekly')
  })

  test('filters hidden and cross-workspace sessions', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [
        { id: 'visible', workspaceId: 'workspace-1', isProcessing: true },
        { id: 'hidden', workspaceId: 'workspace-1', isProcessing: true, hidden: true },
        { id: 'other', workspaceId: 'workspace-2', isProcessing: true },
      ],
      workflowRuns: [],
      scheduledWork: [],
      automations: [],
    })
    expect(items.map((item) => item.sourceId)).toEqual(['visible'])
  })

  test('deduplicates a scheduled order against its live workflow run', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [{ id: 'run-1', workspaceId: 'workspace-1', workflowSlug: 'lyric-clips', state: 'running', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' }],
      scheduledWork: [order({ status: 'running', runs: [{ id: 'job-1', jobId: 'job', startedAt: '2026-09-01T01:00:00.000Z', status: 'running', workflowRunId: 'run-1' }] })],
      automations: [],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.source).toBe('workflow-run')
    expect(items[0]?.subtitle).toBe('Make lyric clips')
  })

  test('falls back to scheduled work when a persisted run link is stale', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [],
      scheduledWork: [order({
        status: 'needs-attention',
        runs: [{ id: 'job-1', jobId: 'job', startedAt: '2026-09-01T01:00:00.000Z', status: 'failed', workflowRunId: 'missing-run' }],
      })],
      automations: [],
    })

    expect(items[0]?.openTarget).toEqual({ kind: 'scheduled-work', id: 'order-1' })
  })

  test('does not open a hidden session from a persisted scheduled-work link', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [{ id: 'hidden-session', workspaceId: 'workspace-1', hidden: true }],
      workflowRuns: [],
      scheduledWork: [order({
        status: 'needs-attention',
        runs: [{ id: 'job-1', jobId: 'job', startedAt: '2026-09-01T01:00:00.000Z', status: 'failed', sessionId: 'hidden-session' }],
      })],
      automations: [],
    })

    expect(items[0]?.openTarget).toEqual({ kind: 'scheduled-work', id: 'order-1' })
  })

  test('shows only the latest unresolved automation failure', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [],
      scheduledWork: [],
      automations: [automation()],
      automationExecutions: new Map([['auto-1', [
        { id: 'old', automationId: 'auto-1', event: 'SchedulerTick', status: 'error', duration: 1, timestamp: 1, error: 'old' },
        { id: 'new', automationId: 'auto-1', event: 'SchedulerTick', status: 'success', duration: 1, timestamp: 2 },
      ]]]),
    })
    expect(items.filter((item) => item.section === 'attention')).toHaveLength(0)
  })

  test('does not expose raw cron syntax for a custom schedule', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [],
      scheduledWork: [],
      automations: [automation({ cron: '0 9 1,15 * *' })],
      describeCron: (cron) => cron,
    })
    expect(items[0]?.cadenceLabel).toBe('Custom schedule')
  })

  test('deduplicates automation attention against a linked attention order', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [{ id: 'run-1', workspaceId: 'workspace-1', workflowSlug: 'lyric-clips', state: 'failed', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' }],
      scheduledWork: [order({
        status: 'needs-attention',
        attention: { reason: 'execution-failed', message: 'The workflow failed.' },
        runs: [{ id: 'job-1', jobId: 'job', startedAt: '2026-09-01T01:00:00.000Z', endedAt: '2026-09-01T02:00:00.000Z', status: 'failed', workflowRunId: 'run-1' }],
      })],
      automations: [automation()],
      automationExecutions: new Map([['auto-1', [
        { id: 'failure', automationId: 'auto-1', event: 'SchedulerTick', status: 'error', duration: 1, timestamp: 2, error: 'failed', workOrderIds: ['order-1'] },
      ]]]),
    })
    expect(items.filter((item) => item.section === 'attention')).toHaveLength(1)
    expect(items.find((item) => item.section === 'attention')?.source).toBe('workflow-run')
  })
})
