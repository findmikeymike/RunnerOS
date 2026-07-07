import { describe, expect, test } from 'bun:test'
import { resolveCampaignFinalId } from '../output-finals-actions'
import type { OutputFinalPointerDTO, OutputSummaryDTO } from '@/hooks/useOutputs'

const output = (campaignId?: string): OutputSummaryDTO => ({
  id: 'output-1',
  workspaceId: 'workspace-1',
  title: 'Cover',
  kind: 'image',
  status: 'published',
  summary: 'Cover',
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  origin: { source: 'session', sessionId: 's1' },
  context: campaignId ? { scope: 'campaign', campaignId } : undefined,
  assetCount: 1,
  receiptCount: 0,
  linkCount: 0,
})

const final = (campaignId: string): OutputFinalPointerDTO => ({
  id: 'final-1',
  scope: 'campaign',
  campaignId,
  slot: 'cover-art',
  outputId: 'output-1',
  isPrimary: true,
  promotedAt: '2026-07-06T00:00:00.000Z',
  promotedBy: 'user',
})

describe('resolveCampaignFinalId', () => {
  test('uses existing final campaign before output or active campaign context', () => {
    expect(resolveCampaignFinalId({
      existing: final('final-campaign'),
      output: output('output-campaign'),
      currentCampaignId: 'active-campaign',
    })).toBe('final-campaign')
  })

  test('uses output campaign context before current campaign context', () => {
    expect(resolveCampaignFinalId({
      output: output('output-campaign'),
      currentCampaignId: 'active-campaign',
    })).toBe('output-campaign')
  })

  test('uses current campaign context without requiring raw id entry', () => {
    expect(resolveCampaignFinalId({
      output: output(),
      currentCampaignId: 'active-campaign',
      fallbackCampaignId: 'manual-campaign',
    })).toBe('active-campaign')
  })

  test('keeps manual fallback only for missing app context', () => {
    expect(resolveCampaignFinalId({
      output: output(),
      fallbackCampaignId: ' manual-campaign ',
    })).toBe('manual-campaign')
  })
})
