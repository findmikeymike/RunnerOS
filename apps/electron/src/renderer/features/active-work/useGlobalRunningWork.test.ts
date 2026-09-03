import { describe, expect, test } from 'bun:test'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { activeSessionInfoToActiveSession, mergeActiveSessions, selectGloballyVisibleOrders } from './useGlobalRunningWork'

describe('global running work helpers', () => {
  test('keeps an automated processing session visible without renderer hidden metadata', () => {
    const authoritative = activeSessionInfoToActiveSession({
      sessionId: 'pulse-session',
      workspaceId: 'workspace-2',
      workspaceName: 'Campaign',
      title: 'Campaign pulse',
      status: 'processing',
      triggeredBy: { automationId: 'pulse-1', automationName: 'Campaign pulse', timestamp: 10 },
      createdAt: 1,
    })
    expect(authoritative).toEqual({
      id: 'pulse-session',
      workspaceId: 'workspace-2',
      name: 'Campaign pulse',
      isProcessing: true,
      createdAt: 1,
      lastMessageAt: 10,
      triggeredByAutomationId: 'pulse-1',
      triggeredByAutomationName: 'Campaign pulse',
    })
    expect(mergeActiveSessions(
      [{ id: 'pulse-session', workspaceId: 'workspace-2', hidden: true, isProcessing: true }],
      [authoritative],
    )[0]?.hidden).toBe(false)
  })

  test('retains running and all attention work from local workspaces', () => {
    const base: ScheduledWorkOrder = {
      version: 1, id: 'work', owner: { scope: 'hq', workspaceId: 'hq' },
      calendarLink: { calendar: 'hq', itemId: 'calendar' }, title: 'Work', type: 'agent-task',
      status: 'scheduled',
      startAt: '2026-09-02T12:00:00.000Z', timezone: 'UTC',
      execution: { type: 'agent-task', agentSlug: 'artist-manager', brief: 'Work', permissionMode: 'safe', expectedOutput: { requirement: 'none' } },
      inputRefs: [], approvals: [], runs: [], executionKey: { payloadDigest: 'digest', idempotencyKey: 'key' },
      createdAt: '2026-09-02T12:00:00.000Z', updatedAt: '2026-09-02T12:00:00.000Z',
    }
    const statuses: ScheduledWorkOrder['status'][] = ['running', 'needs-setup', 'needs-attention', 'scheduled', 'done']
    const selected = selectGloballyVisibleOrders(statuses.map((status, index) => ({ ...base, id: `work-${index}`, status })))
    expect(selected.map((order) => order.status)).toEqual(['running', 'needs-setup', 'needs-attention'])
  })
})
