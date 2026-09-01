import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createOutputBundle,
  readOutputManifest,
  resolveOutputAssetPath,
} from '@craft-agent/shared/outputs'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'
import { parseXEditorialSlate, type XEditorialSlate } from '@craft-agent/shared/x-editorial'
import { reconcileXEditorialSlateOrder } from './slate-status'

const workspaceId = 'workspace-1'
const outputId = '11111111-2222-4333-8444-555555555555'
let roots: string[] = []

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'x-editorial-status-'))
  roots.push(root)
  return root
}

function seedSlate(root: string): void {
  const slate: XEditorialSlate = {
    schemaVersion: 1,
    slateId: 'xslate_1',
    title: 'Daily X Slate',
    createdAt: '2026-08-31T12:00:00.000Z',
    timezone: 'UTC',
    profile: { platform: 'x', profileId: 'artist-main' },
    context: { scope: 'hq', campaignId: null, campaignName: null, campaignWeight: 'none' },
    research: { summary: 'Current artist themes.', researchedAt: null, sources: [] },
    candidates: [{
      id: 'post_1', revision: 1, lane: 'worldview', format: 'post',
      text: 'Art should leave a bruise.', thread: null,
      rationale: 'Artist worldview.', researchBasis: 'artist-truth', sourceIds: [], campaignId: null,
      scheduledFor: '2026-09-01T12:00:00.000Z', timingBasis: 'editorial-default',
      asset: null, status: 'scheduled', scheduledWorkId: 'work-x-1', calendarItemId: 'calendar-x-1',
    }],
  }
  createOutputBundle(root, {
    id: outputId,
    workspaceId,
    title: slate.title,
    kind: 'collection',
    content: `${JSON.stringify(slate, null, 2)}\n`,
    contentMimeType: 'application/json',
    origin: { source: 'session', sessionId: 'session-1', agentSlug: 'x-editorial' },
    approval: { state: 'approved' },
    tags: ['artist-x-slate'],
  })
}

function order(overrides: Partial<ScheduledWorkOrder> = {}): ScheduledWorkOrder {
  return {
    version: 1,
    id: 'work-x-1',
    owner: { scope: 'hq', workspaceId },
    calendarLink: { calendar: 'hq', itemId: 'calendar-x-1' },
    title: 'X worldview post',
    type: 'social-publish',
    status: 'needs-approval',
    startAt: '2026-09-01T12:00:00.000Z',
    timezone: 'UTC',
    execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Art should leave a bruise.' },
    inputRefs: [], approvals: [], runs: [],
    authorizationPolicy: 'durable-v1',
    authorization: {
      id: 'auth-x-1', authorizedAt: '2026-08-31T12:00:00.000Z', payloadDigest: 'digest-x',
      authorizedBy: { type: 'user', clientId: 'client-1', source: 'x-editorial-ui' },
      definition: {
        kind: 'x-editorial', title: 'X worldview post',
        xEditorialRef: { outputId, slateId: 'xslate_1', candidateId: 'post_1', revision: 1 },
        platform: 'x', profileId: 'artist-main', caption: 'Art should leave a bruise.',
        startAt: '2026-09-01T12:00:00.000Z', timezone: 'UTC',
      },
    },
    executionKey: { payloadDigest: 'digest-x', idempotencyKey: 'idem-x-1' },
    createdAt: '2026-08-31T12:00:00.000Z',
    updatedAt: '2026-08-31T12:00:00.000Z',
    ...overrides,
  }
}

function readSlate(root: string): XEditorialSlate {
  const manifest = readOutputManifest(root, outputId)
  if (!manifest?.primary) throw new Error('Output missing.')
  const path = resolveOutputAssetPath(root, outputId, manifest.primary.path)
  if (!path) throw new Error('Asset missing.')
  const parsed = parseXEditorialSlate(readFileSync(path, 'utf-8'))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.slate
}

describe('X Editorial slate status reconciliation', () => {
  test('copies a verified social receipt back into the approved candidate and Output', () => {
    const root = makeRoot()
    seedSlate(root)
    const completed = order({
      status: 'done',
      result: {
        type: 'social-publish',
        receipt: {
          id: 'receipt-x-1', actionType: 'post-asset', platform: 'x', profileId: 'artist-main',
          externalUrl: 'https://x.com/artist/status/1', completedAt: '2026-09-01T12:01:00.000Z',
          payloadDigest: 'digest-x', approvalId: 'approval-x-1', summary: 'Published to X.',
        },
      },
    })

    expect(reconcileXEditorialSlateOrder(root, completed)).toEqual({ updated: true, outputId })
    expect(readSlate(root).candidates[0]).toMatchObject({
      status: 'posted',
      receipt: { id: 'receipt-x-1', externalUrl: 'https://x.com/artist/status/1' },
    })
    expect(readOutputManifest(root, outputId)?.receipts).toMatchObject([{
      id: 'receipt-x-1', provider: 'x', status: 'succeeded', url: 'https://x.com/artist/status/1',
    }])
    expect(reconcileXEditorialSlateOrder(root, completed).updated).toBe(false)
  })

  test('copies actionable runner failure into the candidate without claiming publication', () => {
    const root = makeRoot()
    seedSlate(root)
    const failed = order({
      status: 'needs-attention',
      attention: { reason: 'execution-failed', message: 'Reconnect the X account before publishing.' },
    })

    expect(reconcileXEditorialSlateOrder(root, failed).updated).toBe(true)
    expect(readSlate(root).candidates[0]).toMatchObject({
      status: 'needs-attention',
      attentionMessage: 'Reconnect the X account before publishing.',
    })
    expect(readSlate(root).candidates[0]?.receipt).toBeUndefined()
  })

  test('does not mutate a different candidate revision', () => {
    const root = makeRoot()
    seedSlate(root)
    const mismatched = order({
      authorization: {
        ...order().authorization!,
        definition: {
          ...order().authorization!.definition,
          kind: 'x-editorial',
          xEditorialRef: { outputId, slateId: 'xslate_1', candidateId: 'post_1', revision: 2 },
        } as never,
      },
    })

    expect(reconcileXEditorialSlateOrder(root, mismatched).updated).toBe(false)
    expect(readSlate(root).candidates[0]?.status).toBe('scheduled')
  })
})
