import { describe, expect, test } from 'bun:test'
import { campaignCalendarPrefillForOutput, defaultFinalSlotForOutput, resolveCampaignFinalId } from '../output-finals-actions'
import type { OutputFinalPointerDTO, OutputManifestDTO, OutputSummaryDTO } from '@/hooks/useOutputs'

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

describe('defaultFinalSlotForOutput', () => {
  test('routes ad-tagged videos to Ads instead of generic shortform clips', () => {
    expect(defaultFinalSlotForOutput({
      ...output('campaign-1'),
      title: 'Watching Tornado Videos Meta ad cut',
      kind: 'video',
      tags: ['ad-creative'],
    })).toBe('Ads')
  })

  test('keeps normal videos in Shortform Clips', () => {
    expect(defaultFinalSlotForOutput({
      ...output('campaign-1'),
      title: 'Behind the scenes clip',
      kind: 'video',
      tags: ['content'],
    })).toBe('Shortform Clips')
  })
})

describe('campaignCalendarPrefillForOutput', () => {
  test('prefers the campaign Primary Final over another campaign final', () => {
    const manifest: OutputManifestDTO = {
      ...output('campaign-1'),
      summary: 'Cover',
      origin: { source: 'session', sessionId: 's1' },
      assets: [],
      receipts: [],
      links: [],
      finals: [
        { ...final('campaign-1'), id: 'secondary', slot: 'alternate', isPrimary: false },
        { ...final('campaign-1'), id: 'primary', assetId: 'asset-1' },
      ],
    }

    expect(campaignCalendarPrefillForOutput(manifest, 'campaign-1')).toEqual({
      title: 'Schedule Cover',
      kind: 'scheduled-job',
      actionType: 'post-asset',
      finalRefs: [{
        outputId: 'output-1',
        assetId: 'asset-1',
        slot: 'cover-art',
        label: 'Cover',
      }],
    })
  })

  test('falls back to the Output when no campaign Final exists', () => {
    const manifest: OutputManifestDTO = {
      ...output('campaign-1'),
      summary: 'Cover',
      origin: { source: 'session', sessionId: 's1' },
      assets: [],
      receipts: [],
      links: [],
      finals: [],
    }

    expect(campaignCalendarPrefillForOutput(manifest, 'campaign-1')).toEqual({
      title: 'Schedule Cover',
      kind: 'scheduled-job',
      actionType: 'post-asset',
      outputRefs: [{ outputId: 'output-1', title: 'Cover', kind: 'image' }],
    })
  })
})
