import { describe, expect, test } from 'bun:test'
import { collectFinalRows } from '../FinalsWidget'
import type { OutputSummaryDTO } from '@/hooks/useOutputs'

function output(id: string, finals: OutputSummaryDTO['finals']): OutputSummaryDTO {
  return {
    id,
    workspaceId: 'campaign-1',
    title: id,
    kind: 'image',
    status: 'published',
    summary: id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    origin: { source: 'session', sessionId: 's1' },
    assetCount: 1,
    receiptCount: 0,
    linkCount: 0,
    finals,
  }
}

describe('collectFinalRows', () => {
  test('filters campaign finals by campaign id and puts primary first', () => {
    const rows = collectFinalRows([
      output('cover-a', [{
        id: 'final-a',
        scope: 'campaign',
        campaignId: 'campaign-1',
        slot: 'cover-art',
        outputId: 'cover-a',
        isPrimary: false,
        promotedAt: '2026-07-06T01:00:00.000Z',
        promotedBy: 'user',
      }]),
      output('cover-b', [{
        id: 'final-b',
        scope: 'campaign',
        campaignId: 'campaign-1',
        slot: 'cover-art',
        outputId: 'cover-b',
        isPrimary: true,
        promotedAt: '2026-07-06T00:30:00.000Z',
        promotedBy: 'user',
      }]),
      output('bio', [{
        id: 'final-c',
        scope: 'hq',
        slot: 'artist-bio',
        outputId: 'bio',
        isPrimary: true,
        promotedAt: '2026-07-06T02:00:00.000Z',
        promotedBy: 'user',
      }]),
    ], 'campaign', 'campaign-1')

    expect(rows.map((row) => row.output.id)).toEqual(['cover-b', 'cover-a'])
  })

  test('keeps hq finals separate from campaign finals', () => {
    const rows = collectFinalRows([
      output('cover', [{
        id: 'final-a',
        scope: 'campaign',
        campaignId: 'campaign-1',
        slot: 'cover-art',
        outputId: 'cover',
        isPrimary: true,
        promotedAt: '2026-07-06T01:00:00.000Z',
        promotedBy: 'user',
      }]),
      output('bio', [{
        id: 'final-b',
        scope: 'hq',
        slot: 'artist-bio',
        outputId: 'bio',
        isPrimary: false,
        promotedAt: '2026-07-06T02:00:00.000Z',
        promotedBy: 'user',
      }]),
    ], 'hq')

    expect(rows.map((row) => row.output.id)).toEqual(['bio'])
  })

  test('returns no campaign finals when campaign id is missing', () => {
    const rows = collectFinalRows([
      output('cover', [{
        id: 'final-a',
        scope: 'campaign',
        campaignId: 'campaign-1',
        slot: 'cover-art',
        outputId: 'cover',
        isPrimary: true,
        promotedAt: '2026-07-06T01:00:00.000Z',
        promotedBy: 'user',
      }]),
    ], 'campaign')

    expect(rows).toEqual([])
  })
})
