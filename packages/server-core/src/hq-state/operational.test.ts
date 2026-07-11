import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTOMATIONS_HISTORY_FILE } from '@craft-agent/shared/automations'
import { createOutputBundle } from '@craft-agent/shared/outputs'
import {
  scheduledWorkDefinitionDigest,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import { upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { buildHqOperationalSnapshot } from './operational'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

describe('HQ operational snapshot', () => {
  test('summarizes pending and failed outputs without reading output bodies', () => {
    const workspace = tempWorkspace()
    createOutputBundle(workspace, {
      workspaceId: 'ws-1',
      title: 'Approve teaser cut',
      kind: 'video',
      status: 'draft',
      summary: 'A review-ready teaser.',
      origin: { source: 'session', agentSlug: 'video-agent' },
      approval: { state: 'pending' },
    })
    createOutputBundle(workspace, {
      workspaceId: 'ws-1',
      title: 'Broken report',
      kind: 'report',
      status: 'failed',
      origin: { source: 'automation', automationId: 'weekly-report' },
    })

    const snapshot = buildHqOperationalSnapshot(workspace)

    expect(snapshot.approvals.map((item) => item.title)).toContain('Approve teaser cut')
    expect(snapshot.failures.map((item) => item.title)).toContain('Broken report')
    expect(snapshot.recentOutputs).toHaveLength(2)
  })

  test('summarizes active and approval-blocked scheduled work', () => {
    const workspace = tempWorkspace()
    const running = order('work-running', 'Create cover art', 'running')
    const approval = order('work-approval', 'Approve social post', 'needs-approval')
    upsertContextDoc(workspace, {
      slug: 'scheduled-work',
      metadata: scheduledWorkMetadata(),
      body: serializeScheduledWorkBody({
        version: 1,
        workspaceId: 'ws-1',
        items: [running, approval],
        updatedAt: '2026-07-10T00:00:00.000Z',
      }),
    })

    const snapshot = buildHqOperationalSnapshot(workspace)

    expect(snapshot.active).toEqual([expect.objectContaining({ id: 'work-running', worker: 'art-director' })])
    expect(snapshot.approvals).toEqual([expect.objectContaining({ id: 'work-approval' })])
  })

  test('only reports the latest automation result for each matcher', () => {
    const workspace = tempWorkspace()
    writeFileSync(join(workspace, AUTOMATIONS_HISTORY_FILE), [
      JSON.stringify({ id: 'recovered', ts: 1000, ok: false, error: 'old failure' }),
      JSON.stringify({ id: 'still-failing', ts: 1500, ok: false, error: 'current failure' }),
      JSON.stringify({ id: 'recovered', ts: 2000, ok: true }),
      'malformed',
    ].join('\n'))

    const snapshot = buildHqOperationalSnapshot(workspace)

    expect(snapshot.failures.map((item) => item.id)).toContain('still-failing')
    expect(snapshot.failures.map((item) => item.id)).not.toContain('recovered')
  })
})

function tempWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'runneros-hq-operational-'))
  workspaces.push(workspace)
  return workspace
}

function order(id: string, title: string, status: ScheduledWorkOrder['status']): ScheduledWorkOrder {
  const execution = {
    type: 'agent-task' as const,
    agentSlug: 'art-director',
    brief: title,
    permissionMode: 'safe' as const,
    expectedOutput: { requirement: 'required' as const, kind: 'image' as const },
  }
  return {
    version: 1,
    id,
    owner: { scope: 'hq', workspaceId: 'ws-1' },
    calendarLink: { calendar: 'hq', itemId: `calendar-${id}` },
    title,
    type: 'agent-task',
    status,
    startAt: '2026-07-10T10:00:00.000Z',
    timezone: 'America/Chicago',
    execution,
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: {
      payloadDigest: scheduledWorkDefinitionDigest(execution),
      idempotencyKey: `scheduled-work:${id}`,
    },
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}
