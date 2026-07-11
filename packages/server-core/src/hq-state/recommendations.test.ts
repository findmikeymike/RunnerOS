import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HqRecommendationCandidate, HqStateEntityRef } from '@craft-agent/shared/hq-state'
import { createOutputBundle } from '@craft-agent/shared/outputs'
import { scheduledWorkDefinitionDigest, scheduledWorkMetadata, serializeScheduledWorkBody, type ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { writeRun, type WorkflowRunSnapshot } from '@craft-agent/shared/workflows'
import { AUTOMATIONS_HISTORY_FILE } from '@craft-agent/shared/automations'
import { readHqRecommendationOutcomes, upsertHqRecommendationOutcome } from '@craft-agent/shared/hq-state/recommendation-storage'
import {
  readHqRecommendationStore,
  transitionHqRecommendation,
  upsertHqRecommendation,
} from '@craft-agent/shared/hq-state/recommendation-storage'
import { reconcileHqRecommendationOutcomes } from './recommendations'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

describe('HQ recommendation outcome reconciliation', () => {
  test('moves a launched recommendation to completed from linked Output evidence', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
    transitionHqRecommendation(workspace, 'sop_outcome', 'launched', {
      actor: { type: 'user' },
      executionRef: { kind: 'session', id: 'session-1', linkedAt: '2026-07-10T00:01:00.000Z' },
    })
    const output = createOutputBundle(workspace, {
      workspaceId: 'ws-1',
      title: 'Completed campaign brief',
      kind: 'document',
      status: 'draft',
      completedAt: '2026-07-10T00:05:00.000Z',
      origin: { source: 'session', sessionId: 'session-1', agentSlug: 'concierge' },
      tags: ['hq-recommendation:sop_outcome'],
    })

    reconcileHqRecommendationOutcomes(workspace, new Date('2026-07-10T00:06:00.000Z'))

    const reconciled = readHqRecommendationStore(workspace).candidates[0]!
    expect(reconciled.status).toBe('completed')
    expect(reconciled.executionRefs).toContainEqual(expect.objectContaining({ kind: 'output', id: output.id }))
  })

  test('moves linked pending approval and failed Outputs to the correct states', () => {
    const pendingWorkspace = tempWorkspace()
    launch(pendingWorkspace, 'pending-session')
    createOutputBundle(pendingWorkspace, {
      workspaceId: 'ws-1', title: 'Review me', kind: 'document', status: 'draft',
      origin: { source: 'session', sessionId: 'pending-session', agentSlug: 'concierge' }, approval: { state: 'pending' },
      tags: ['hq-recommendation:sop_outcome'],
    })
    reconcileHqRecommendationOutcomes(pendingWorkspace)
    expect(readHqRecommendationStore(pendingWorkspace).candidates[0]?.status).toBe('awaiting_approval')

    const failedWorkspace = tempWorkspace()
    launch(failedWorkspace, 'failed-session')
    createOutputBundle(failedWorkspace, {
      workspaceId: 'ws-1', title: 'Failed work', kind: 'document', status: 'failed',
      origin: { source: 'session', sessionId: 'failed-session', agentSlug: 'concierge' },
      tags: ['hq-recommendation:sop_outcome'],
    })
    reconcileHqRecommendationOutcomes(failedWorkspace)
    expect(readHqRecommendationStore(failedWorkspace).candidates[0]?.status).toBe('failed')
  })

  test('ignores unrelated Outputs from the same session', () => {
    const workspace = tempWorkspace()
    launch(workspace, 'session-1')
    createOutputBundle(workspace, {
      workspaceId: 'ws-1',
      title: 'Incidental session board',
      kind: 'other',
      status: 'draft',
      completedAt: '2026-07-10T00:05:00.000Z',
      origin: { source: 'session', sessionId: 'session-1', agentSlug: 'concierge' },
      tags: ['visual-board'],
    })

    reconcileHqRecommendationOutcomes(workspace)

    expect(readHqRecommendationStore(workspace).candidates[0]?.status).toBe('launched')
  })

  test('records partial and successful outcomes from explicit Output criteria', () => {
    for (const receiptStatus of [undefined, 'pending', 'succeeded'] as const) {
      const workspace = tempWorkspace()
      upsertHqRecommendation(workspace, {
        ...candidate(),
        completionContract: {
          type: 'output', requiredTag: 'hq-recommendation:sop_outcome', expectedAgentSlug: 'concierge',
          criteria: [{ type: 'output-completed' }, { type: 'receipt-recorded' }],
        },
      })
      transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
      transitionHqRecommendation(workspace, 'sop_outcome', 'launched', {
        actor: { type: 'system' }, executionRef: { kind: 'session', id: 'criteria-session', linkedAt: new Date().toISOString() },
      })
      createOutputBundle(workspace, {
        workspaceId: 'ws-1', title: 'Criteria output', kind: 'document', status: 'draft', completedAt: '2026-07-10T00:05:00.000Z',
        origin: { source: 'session', sessionId: 'criteria-session', agentSlug: 'concierge' }, tags: ['hq-recommendation:sop_outcome'],
        receipts: receiptStatus ? [{ id: 'receipt-1', provider: 'test', action: 'publish', status: receiptStatus, occurredAt: '2026-07-10T00:05:00.000Z' }] : [],
      })

      reconcileHqRecommendationOutcomes(workspace)

      const outcome = readHqRecommendationOutcomes(workspace)[0]!
      expect(outcome.status).toBe(receiptStatus === 'succeeded' ? 'successful' : 'partial')
      expect(outcome.criteria?.map((result) => result.satisfied)).toEqual(receiptStatus === 'succeeded' ? [true, true] : [true, false])
    }
  })

  test('reconciles linked Scheduled Work to an evidenced outcome', () => {
    const workspace = tempWorkspace()
    const order = completedOrder('work-1')
    upsertContextDoc(workspace, {
      slug: 'scheduled-work', metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody({ version: 1, workspaceId: 'ws-1', items: [order], updatedAt: order.updatedAt }),
    })
    launchEntity(workspace, { kind: 'scheduled-work', id: order.id, source: `scheduled-work:${order.id}`, scope: { type: 'hq' } })

    reconcileHqRecommendationOutcomes(workspace)

    expect(readHqRecommendationStore(workspace).candidates[0]?.status).toBe('completed')
    expect(readHqRecommendationOutcomes(workspace)[0]).toEqual(expect.objectContaining({ status: 'successful' }))
  })

  test('reconciles a linked workflow run from its persisted terminal state', () => {
    const workspace = tempWorkspace()
    const run = workflowRun('12345678-1234-4123-8123-123456789012', 'succeeded')
    writeRun(workspace, run)
    launchEntity(workspace, { kind: 'workflow-run', id: run.id, source: `workflow-run:${run.id}`, scope: { type: 'hq' } })

    reconcileHqRecommendationOutcomes(workspace)

    expect(readHqRecommendationStore(workspace).candidates[0]?.status).toBe('completed')
    expect(readHqRecommendationOutcomes(workspace)[0]?.evidence[0]?.id).toBe(run.id)
  })

  test('retires an observed obligation when its entity resolves without claiming launch credit', () => {
    const workspace = tempWorkspace()
    const order = completedOrder('observed-work')
    upsertContextDoc(workspace, {
      slug: 'scheduled-work', metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody({ version: 1, workspaceId: 'ws-1', items: [order], updatedAt: order.updatedAt }),
    })
    const entity = { kind: 'scheduled-work' as const, id: order.id, source: `scheduled-work:${order.id}`, scope: { type: 'hq' as const } }
    upsertHqRecommendation(workspace, { ...candidate(), completionContract: { type: 'entity-resolution', entity } })

    reconcileHqRecommendationOutcomes(workspace)

    expect(readHqRecommendationStore(workspace).candidates[0]?.status).toBe('superseded')
    expect(readHqRecommendationStore(workspace).candidates[0]?.executionRefs.some((ref) => ref.kind === 'session')).toBe(false)
  })

  test('repairs a missing outcome from terminal recommendation state', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
    transitionHqRecommendation(workspace, 'sop_outcome', 'launched', { actor: { type: 'system' } })
    transitionHqRecommendation(workspace, 'sop_outcome', 'completed', { actor: { type: 'system' } })
    expect(readHqRecommendationOutcomes(workspace)).toEqual([])

    reconcileHqRecommendationOutcomes(workspace, new Date('2026-07-10T02:00:00.000Z'))

    expect(readHqRecommendationOutcomes(workspace)[0]).toEqual(expect.objectContaining({ status: 'successful' }))
  })

  test('repairs a stale outcome after a failed recommendation succeeds on retry', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
    transitionHqRecommendation(workspace, 'sop_outcome', 'failed', { actor: { type: 'system' } })
    upsertHqRecommendationOutcome(workspace, {
      version: 1, recommendationId: 'sop_outcome', status: 'unsuccessful', evaluatedAt: '2026-07-10T01:00:00.000Z', evidence: [], userUsefulness: 'useful',
    })
    transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
    transitionHqRecommendation(workspace, 'sop_outcome', 'launched', { actor: { type: 'system' } })
    transitionHqRecommendation(workspace, 'sop_outcome', 'completed', { actor: { type: 'system' } })

    reconcileHqRecommendationOutcomes(workspace, new Date('2026-07-10T02:00:00.000Z'))

    expect(readHqRecommendationOutcomes(workspace)[0]).toEqual(expect.objectContaining({ status: 'successful', userUsefulness: 'useful' }))
  })

  test('does not break reconciliation when automation history is unreadable', () => {
    const workspace = tempWorkspace()
    mkdirSync(join(workspace, AUTOMATIONS_HISTORY_FILE))
    const entity = { kind: 'automation-run' as const, id: 'weekly-intel', source: 'automation:weekly-intel', scope: { type: 'hq' as const } }
    launchEntity(workspace, entity)

    expect(() => reconcileHqRecommendationOutcomes(workspace)).not.toThrow()
    expect(readHqRecommendationStore(workspace).candidates[0]?.status).toBe('launched')
  })
})

function launch(workspace: string, sessionId: string): void {
  upsertHqRecommendation(workspace, candidate())
  transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
  transitionHqRecommendation(workspace, 'sop_outcome', 'launched', {
    actor: { type: 'user' },
    executionRef: { kind: 'session', id: sessionId, linkedAt: new Date().toISOString() },
  })
}

function launchEntity(workspace: string, entity: HqStateEntityRef): void {
  upsertHqRecommendation(workspace, { ...candidate(), completionContract: { type: 'entity-resolution', entity } })
  transitionHqRecommendation(workspace, 'sop_outcome', 'accepted', { actor: { type: 'user' } })
  transitionHqRecommendation(workspace, 'sop_outcome', 'launched', { actor: { type: 'system' } })
}

function completedOrder(id: string): ScheduledWorkOrder {
  const execution = { type: 'agent-task' as const, agentSlug: 'concierge', brief: 'Do work', permissionMode: 'safe' as const, expectedOutput: { requirement: 'none' as const } }
  return {
    version: 1, id, owner: { scope: 'hq', workspaceId: 'ws-1' }, calendarLink: { calendar: 'hq', itemId: `calendar-${id}` }, title: 'Completed work', type: 'agent-task', status: 'done', startAt: '2026-07-10T00:00:00.000Z', timezone: 'America/Chicago', execution, inputRefs: [], approvals: [], runs: [], executionKey: { payloadDigest: scheduledWorkDefinitionDigest(execution), idempotencyKey: id }, createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T01:00:00.000Z',
  }
}

function workflowRun(id: string, state: WorkflowRunSnapshot['state']): WorkflowRunSnapshot {
  return {
    id, workflowSlug: 'weekly-review', workspaceId: 'ws-1', state,
    trigger: { type: 'manual', inputs: {}, firedAt: '2026-07-10T00:00:00.000Z' },
    workflowSnapshot: { metadata: { name: 'Weekly review', description: 'Fixture', trigger: { type: 'manual' }, steps: [{ id: 'step-1', agent: 'concierge', input: 'Review.' }] }, body: '' },
    steps: [{ id: 'step-1', state: state === 'succeeded' ? 'succeeded' : 'running', attempts: 1 }],
    createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T01:00:00.000Z', completedAt: state === 'succeeded' ? '2026-07-10T01:00:00.000Z' : undefined,
  }
}

function candidate(): HqRecommendationCandidate {
  return {
    version: 1,
    id: 'sop_outcome',
    fingerprint: 'v1:hq:concierge:campaign-brief',
    scope: { type: 'hq' },
    title: 'Create campaign brief',
    reason: 'Campaign needs a brief.',
    desiredOutcome: 'A completed campaign brief.',
    completionContract: { type: 'output', requiredTag: 'hq-recommendation:sop_outcome', expectedAgentSlug: 'concierge' },
    status: 'proposed',
    executionRefs: [],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    lastProposedAt: '2026-07-10T00:00:00.000Z',
  }
}

function tempWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'runneros-hq-outcome-'))
  workspaces.push(workspace)
  return workspace
}
