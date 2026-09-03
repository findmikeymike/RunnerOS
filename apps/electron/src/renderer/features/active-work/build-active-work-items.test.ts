import { describe, expect, test } from 'bun:test'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import type { AutomationListItem } from '@/components/automations/types'
import { buildActiveWorkItems } from './build-active-work-items'

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
  test('classifies current, upcoming, attention, and automated work', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [{ id: 'session-1', workspaceId: 'workspace-1', name: 'Artist Manager', isProcessing: true }],
      workflowRuns: [{ id: 'run-1', workspaceId: 'workspace-1', workflowSlug: 'release-qa', state: 'failed', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' }],
      scheduledWork: [order({})],
      automations: [automation()],
      describeCron: () => 'At 09:00 (weekday: 1)',
    })

    expect(items.map((item) => item.section)).toEqual(['running', 'attention', 'up-next', 'up-next'])
    expect(items.find((item) => item.sourceId === 'run-1')?.statusLabel).toBe('Failed')
    expect(items.find((item) => item.sourceId === 'auto-1' && item.section === 'up-next')?.cadenceLabel).toBe('Weekly')
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

  test('includes only live work from other local workspaces', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      runningWorkspaceIds: new Set(['workspace-1', 'workspace-2']),
      sessions: [{ id: 'other-session', workspaceId: 'workspace-2', isProcessing: true }],
      workflowRuns: [
        { id: 'other-running', workspaceId: 'workspace-2', workflowSlug: 'release-qa', state: 'running', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' },
        { id: 'other-failed', workspaceId: 'workspace-2', workflowSlug: 'release-qa', state: 'failed', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' },
      ],
      scheduledWork: [],
      automations: [],
    })
    expect(items.map((item) => [item.sourceId, item.workspaceId])).toEqual([
      ['other-running', 'workspace-2'],
      ['other-session', 'workspace-2'],
    ])
  })

  test('deduplicates a cross-workspace scheduled agent run and preserves its cadence', () => {
    const otherOrder = order({
      owner: { scope: 'campaign', workspaceId: 'workspace-2', campaignId: 'workspace-2' },
      status: 'running',
      execution: {
        type: 'agent-task',
        agentSlug: 'artist-manager',
        brief: 'Run the pulse',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'none' },
      },
      automationRef: { matcherId: 'auto-2', name: 'Daily pulse', event: 'SchedulerTick', definitionDigest: 'definition', configurationDigest: 'configuration' },
      runs: [{ id: 'job-2', jobId: 'job', startedAt: '2026-09-01T01:00:00.000Z', status: 'running', sessionId: 'pulse-session' }],
    })
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      runningWorkspaceIds: new Set(['workspace-1', 'workspace-2']),
      sessions: [{
        id: 'pulse-session',
        workspaceId: 'workspace-2',
        name: 'Daily pulse',
        isProcessing: true,
        triggeredByAutomationId: 'auto-2',
        triggeredByAutomationName: 'Different display name',
      }],
      workflowRuns: [],
      scheduledWork: [otherOrder],
      automations: [],
      automationsByWorkspace: new Map([['workspace-2', [
        automation({ id: 'wrong-id', name: 'Different display name', cron: '0 9 * * 1' }),
        automation({ id: 'auto-2', name: 'Daily pulse', cron: '0 9 * * *' }),
      ]]]),
      describeCron: (cron) => cron === '0 9 * * *' ? 'Daily at 9:00 AM' : 'Weekly on Monday at 9:00 AM',
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ source: 'session', sourceId: 'pulse-session', workspaceId: 'workspace-2', cadenceLabel: 'Daily' })
  })

  test('uses a bare Pulse session automation ID before a duplicate display name', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      runningWorkspaceIds: new Set(['workspace-1', 'workspace-2']),
      sessions: [{
        id: 'bare-pulse-session',
        workspaceId: 'workspace-2',
        isProcessing: true,
        triggeredByAutomationId: 'daily-pulse-id',
        triggeredByAutomationName: 'Shared pulse name',
      }],
      workflowRuns: [],
      scheduledWork: [],
      automations: [],
      automationsByWorkspace: new Map([['workspace-2', [
        automation({ id: 'weekly-pulse-id', name: 'Shared pulse name', cron: '0 9 * * 1' }),
        automation({ id: 'daily-pulse-id', name: 'Another name', cron: '0 9 * * *' }),
      ]]]),
      describeCron: (cron) => cron === '0 9 * * *' ? 'Daily at 9:00 AM' : 'Weekly on Monday at 9:00 AM',
    })

    expect(items).toHaveLength(1)
    expect(items[0]?.cadenceLabel).toBe('Daily')
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

  test('retains automation cadence when its order is represented by a live run', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [{ id: 'run-1', workspaceId: 'workspace-1', workflowSlug: 'lyric-clips', state: 'running', createdAt: '2026-09-01T01:00:00.000Z', updatedAt: '2026-09-01T02:00:00.000Z' }],
      scheduledWork: [order({
        status: 'running',
        automationRef: { matcherId: 'auto-1', name: 'Weekly content', event: 'SchedulerTick', definitionDigest: 'definition', configurationDigest: 'configuration' },
        runs: [{ id: 'job-1', jobId: 'job', startedAt: '2026-09-01T01:00:00.000Z', status: 'running', workflowRunId: 'run-1' }],
      })],
      automations: [automation()],
      describeCron: () => 'At 09:00 (weekday: 1)',
    })
    expect(items[0]?.cadenceLabel).toBe('Weekly')
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
    expect(items[0]?.section).toBe('attention')
    expect(items[0]?.statusLabel).toBe('Missing source')
    expect(items[0]?.attentionReason).toContain('review or remove')
  })

  test('keeps the exact durable input request on the Needs You row', () => {
    const inputRequest = {
      id: 'request-1',
      inputs: ['design_file'],
      requestedAt: '2026-09-01T01:00:00.000Z',
      lastTriggeredAt: '2026-09-01T01:00:00.000Z',
      coalescedFireCount: 3,
      fireDefinitionDigests: ['fire-1'],
    }
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [],
      scheduledWork: [order({
        status: 'needs-setup',
        attention: { reason: 'input-required', message: 'Waiting for: design_file' },
        inputRequest,
      })],
      automations: [],
    })
    expect(items[0]?.section).toBe('attention')
    expect(items[0]?.inputRequest).toEqual(inputRequest)
  })

  test('shows cross-workspace Needs You work with its campaign origin', () => {
    const inputRequest = {
      id: 'request-2', inputs: ['design_file'], requestedAt: '2026-09-01T01:00:00.000Z',
      lastTriggeredAt: '2026-09-01T01:00:00.000Z', coalescedFireCount: 1, fireDefinitionDigests: ['fire-2'],
    }
    const items = buildActiveWorkItems({
      workspaceId: 'hq',
      runningWorkspaceIds: new Set(['hq', 'campaign-2']),
      workspaceNamesById: new Map([['hq', 'HQ'], ['campaign-2', 'Night Drive']]),
      sessions: [], workflowRuns: [], automations: [],
      scheduledWork: [order({
        owner: { scope: 'campaign', workspaceId: 'campaign-2', campaignId: 'campaign-2' },
        status: 'needs-setup', attention: { reason: 'input-required', message: 'Waiting for: design_file' }, inputRequest,
      })],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ section: 'attention', workspaceId: 'campaign-2', originLabel: 'Night Drive' })
  })

  test('shows cross-workspace failed work with its campaign origin', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'hq',
      runningWorkspaceIds: new Set(['hq', 'campaign-2']),
      workspaceNamesById: new Map([['hq', 'HQ'], ['campaign-2', 'Night Drive']]),
      sessions: [], workflowRuns: [], automations: [],
      scheduledWork: [order({
        owner: { scope: 'campaign', workspaceId: 'campaign-2', campaignId: 'campaign-2' },
        status: 'needs-attention', attention: { reason: 'execution-failed', message: 'The workflow failed.' },
        runs: [{
          id: 'campaign-job-1', jobId: 'scheduled-job-1', status: 'failed',
          startedAt: '2026-09-01T01:00:00.000Z', workflowRunId: 'unloaded-campaign-run',
        }],
      })],
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ section: 'attention', workspaceId: 'campaign-2', originLabel: 'Night Drive', statusLabel: 'Needs attention', attentionReason: 'The workflow failed.' })
  })

  test('derives cadence from cron fields without leaking technical syntax', () => {
    const labels = ['0 9 * * *', '0 9 * * 1', '0 9 1 * *', '0 9 1,15 * *', '*/15 * * * *']
      .map((cron, index) => buildActiveWorkItems({
        workspaceId: 'workspace-1', sessions: [], workflowRuns: [], scheduledWork: [],
        automations: [automation({ id: `auto-${index}`, cron })],
      })[0]?.cadenceLabel)
    expect(labels).toEqual(['Daily', 'Weekly', 'Monthly', 'Custom schedule', 'Custom schedule'])
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
    expect(items[0]?.statusLabel).toBe('Missing source')
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

  test('separates paused automations and labels trigger cadence', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [],
      scheduledWork: [],
      automations: [automation({ enabled: false, event: 'FileWatch', cron: undefined })],
    })
    expect(items[0]?.section).toBe('paused')
    expect(items[0]?.cadenceLabel).toBe('On file')
    expect(items[0]?.statusLabel).toBe('Paused')
  })

  test('shows a snoozed automation as paused and keeps its successful receipt', () => {
    const completed = order({
      status: 'done',
      automationRef: { matcherId: 'auto-1', name: 'Weekly content', event: 'SchedulerTick', definitionDigest: 'definition', configurationDigest: 'configuration' },
      updatedAt: '2026-09-01T02:00:00.000Z',
    })
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1', sessions: [], workflowRuns: [], scheduledWork: [completed],
      automations: [automation({ snoozedUntil: new Date(Date.now() + 86_400_000).toISOString(), actions: [{ type: 'queue-work', ownerScope: 'hq', title: 'Weekly content', execution: { type: 'agent-task', agentSlug: 'writer', brief: 'Write', permissionMode: 'safe', expectedOutput: { requirement: 'required', kind: 'report' } } }] })],
      automationExecutions: new Map([['auto-1', [{
        id: 'run-1', automationId: 'auto-1', event: 'SchedulerTick', status: 'success', duration: 10, timestamp: Date.now() - 3_600_000,
      }]]]),
    })
    expect(items[0]).toMatchObject({ section: 'paused', statusLabel: 'Snoozed', actionLabel: 'Activate' })
    expect(items[0]?.recentCompletionAt).toBe('2026-09-01T02:00:00.000Z')
  })

  test('does not call an old completion recent', () => {
    const completed = order({
      status: 'done',
      automationRef: { matcherId: 'auto-1', name: 'Weekly content', event: 'SchedulerTick', definitionDigest: 'definition', configurationDigest: 'configuration' },
      updatedAt: new Date(Date.now() - 31 * 86_400_000).toISOString(),
    })
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1', sessions: [], workflowRuns: [], scheduledWork: [completed], automations: [automation()],
    })
    expect(items[0]?.recentCompletionAt).toBeUndefined()
  })

  test('does not surface an old failure after the automation is paused', () => {
    const items = buildActiveWorkItems({
      workspaceId: 'workspace-1',
      sessions: [],
      workflowRuns: [],
      scheduledWork: [],
      automations: [automation({ enabled: false })],
      automationExecutions: new Map([['auto-1', [
        { id: 'failure', automationId: 'auto-1', event: 'SchedulerTick', status: 'error', duration: 1, timestamp: 2, error: 'failed' },
      ]]]),
    })
    expect(items[0]?.section).toBe('paused')
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
