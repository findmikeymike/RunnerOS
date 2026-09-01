import { describe, expect, test } from 'bun:test'
import type { OutputManifest } from '@craft-agent/shared/outputs'
import type { WorkflowRunSnapshot } from '@craft-agent/shared/workflows'
import { findExactWorkflowStepOutput } from './step-output'

const now = '2026-09-01T00:00:00.000Z'

function report(overrides: Partial<OutputManifest> = {}): OutputManifest {
  return {
    schemaVersion: 1,
    id: 'report-1',
    workspaceId: 'workspace-1',
    title: 'Weekly YouTube Intelligence Report',
    slug: 'weekly-youtube-intelligence-report',
    kind: 'report',
    status: 'published',
    summary: 'Summary',
    origin: {
      source: 'workflow',
      workflowRunId: 'original-run',
      workflowSlug: 'weekly-signal-scan',
      stepId: 'youtube-intel',
      sessionId: 'youtube-session',
    },
    assets: [],
    receipts: [],
    links: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function rerun(): WorkflowRunSnapshot {
  return {
    id: 'rerun-id',
    workflowSlug: 'weekly-signal-scan',
    workspaceId: 'workspace-1',
    state: 'running',
    trigger: { type: 'manual', inputs: {}, firedAt: now },
    workflowSnapshot: { metadata: { name: 'Signals', description: '', trigger: { type: 'manual' }, steps: [] }, body: '' },
    steps: [{ id: 'youtube-intel', state: 'succeeded', attempts: 1, sessionId: 'youtube-session', output: 'packet' }],
    createdAt: now,
    updatedAt: now,
    resumedFromRunId: 'original-run',
  }
}

describe('findExactWorkflowStepOutput', () => {
  test('accepts the exact Output belonging to a copied successful rerun step', () => {
    expect(findExactWorkflowStepOutput(
      [report()],
      rerun(),
      'youtube-intel',
      'Weekly YouTube Intelligence Report',
    )?.id).toBe('report-1')
  })

  test('rejects an Output from a different session or workflow', () => {
    expect(findExactWorkflowStepOutput(
      [report({ origin: { ...report().origin, sessionId: 'other-session' } })],
      rerun(),
      'youtube-intel',
      'Weekly YouTube Intelligence Report',
    )).toBeUndefined()
  })
})
