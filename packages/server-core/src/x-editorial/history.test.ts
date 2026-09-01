import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOutputBundle } from '@craft-agent/shared/outputs'
import type { XEditorialSlate } from '@craft-agent/shared/x-editorial'
import { readXEditorialHistory } from './history'

describe('readXEditorialHistory', () => {
  test('returns exact recent slate copy and status from the HQ Output store', () => {
    const root = mkdtempSync(join(tmpdir(), 'x-editorial-history-'))
    const workspaceId = 'hq-1'
    const slate: XEditorialSlate = {
      schemaVersion: 1,
      slateId: 'slate-history-1',
      title: 'Daily X Slate — History',
      createdAt: '2026-08-31T10:00:00.000Z',
      timezone: 'America/Chicago',
      profile: { platform: 'x', profileId: 'artist-main' },
      context: { scope: 'hq', campaignId: 'campaign-1', campaignName: 'Single', campaignWeight: 'light' },
      research: { summary: 'History test.', researchedAt: null, sources: [] },
      candidates: [{
        id: 'post-history-1', revision: 2, lane: 'campaign-adjacent', format: 'post',
        text: 'The exact line that must not be repeated.', thread: null,
        rationale: 'Artist fit.', researchBasis: 'artist-truth', sourceIds: [], campaignId: 'campaign-1',
        scheduledFor: '2026-09-01T15:00:00.000Z', timingBasis: 'campaign-constraint',
        asset: null, status: 'scheduled', scheduledWorkId: 'work-1', calendarItemId: 'event-1',
      }],
    }
    createOutputBundle(root, {
      id: '11111111-2222-4333-8444-555555555555',
      workspaceId,
      title: slate.title,
      kind: 'collection',
      content: JSON.stringify(slate),
      contentMimeType: 'application/json',
      origin: { source: 'session', sessionId: 'session-1', agentSlug: 'x-editorial' },
      tags: ['artist-x-slate'],
    })

    expect(readXEditorialHistory(root, workspaceId, 8)).toMatchObject({
      workspaceId,
      slates: [{
        slateId: 'slate-history-1',
        context: { campaignId: 'campaign-1' },
        candidates: [{
          text: 'The exact line that must not be repeated.',
          lane: 'campaign-adjacent',
          revision: 2,
          status: 'scheduled',
        }],
      }],
    })
  })

  test('skips a stale slate asset without hiding healthy history', () => {
    const root = mkdtempSync(join(tmpdir(), 'x-editorial-history-stale-'))
    const workspaceId = 'hq-1'
    const baseSlate: XEditorialSlate = {
      schemaVersion: 1,
      slateId: 'slate-healthy',
      title: 'Healthy slate',
      createdAt: '2026-08-31T10:00:00.000Z',
      timezone: 'America/Chicago',
      profile: { platform: 'x', profileId: 'artist-main' },
      context: { scope: 'hq', campaignId: null, campaignName: null, campaignWeight: 'none' },
      research: { summary: 'Healthy history.', researchedAt: null, sources: [] },
      candidates: [{
        id: 'post-healthy', revision: 1, lane: 'worldview', format: 'post',
        text: 'Keep the healthy history readable.', thread: null,
        rationale: 'Artist fit.', researchBasis: 'artist-truth', sourceIds: [], campaignId: null,
        scheduledFor: null, timingBasis: 'editorial-default', asset: null, status: 'proposed',
      }],
    }
    createOutputBundle(root, {
      id: '11111111-2222-4333-8444-555555555556', workspaceId,
      title: baseSlate.title, kind: 'collection', content: JSON.stringify(baseSlate),
      contentMimeType: 'application/json',
      origin: { source: 'session', sessionId: 'session-1', agentSlug: 'x-editorial' },
      tags: ['artist-x-slate'],
    })
    const stale = createOutputBundle(root, {
      id: '11111111-2222-4333-8444-555555555557', workspaceId,
      title: 'Stale slate', kind: 'collection',
      content: JSON.stringify({ ...baseSlate, slateId: 'slate-stale', title: 'Stale slate' }),
      contentMimeType: 'application/json',
      origin: { source: 'session', sessionId: 'session-2', agentSlug: 'x-editorial' },
      tags: ['artist-x-slate'],
    })
    rmSync(join(root, 'outputs', stale.id, stale.primary!.path))

    expect(readXEditorialHistory(root, workspaceId, 8).slates.map((slate) => slate.slateId)).toEqual(['slate-healthy'])
  })
})
