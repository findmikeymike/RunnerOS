import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HqRecommendationCandidate } from '@craft-agent/shared/hq-state'
import { createOutputBundle } from '@craft-agent/shared/outputs'
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
      origin: { source: 'session', sessionId: 'session-1' },
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
      origin: { source: 'session', sessionId: 'pending-session' }, approval: { state: 'pending' },
    })
    reconcileHqRecommendationOutcomes(pendingWorkspace)
    expect(readHqRecommendationStore(pendingWorkspace).candidates[0]?.status).toBe('awaiting_approval')

    const failedWorkspace = tempWorkspace()
    launch(failedWorkspace, 'failed-session')
    createOutputBundle(failedWorkspace, {
      workspaceId: 'ws-1', title: 'Failed work', kind: 'document', status: 'failed',
      origin: { source: 'session', sessionId: 'failed-session' },
    })
    reconcileHqRecommendationOutcomes(failedWorkspace)
    expect(readHqRecommendationStore(failedWorkspace).candidates[0]?.status).toBe('failed')
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

function candidate(): HqRecommendationCandidate {
  return {
    version: 1,
    id: 'sop_outcome',
    fingerprint: 'v1:hq:concierge:campaign-brief',
    scope: { type: 'hq' },
    title: 'Create campaign brief',
    reason: 'Campaign needs a brief.',
    desiredOutcome: 'A completed campaign brief.',
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
