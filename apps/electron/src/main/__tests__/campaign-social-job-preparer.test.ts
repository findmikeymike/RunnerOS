import { describe, expect, test } from 'bun:test'
import {
  createCampaignCalendarItem,
  createCampaignScheduledJob,
} from '@craft-agent/shared/campaign-calendar'
import { prepareCampaignSocialJob } from '../campaign-social-job-preparer'

describe('prepareCampaignSocialJob', () => {
  test('builds an exact Printing Press dry-run from profile and final refs', async () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { caption: 'New song Friday.' },
    })
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      accountSetId: 'artist-main',
      socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-main' }],
      finalRefs: [{ outputId: 'output-1', assetId: 'asset-1' }],
      job,
    })
    let args: string[] = []

    const result = await prepareCampaignSocialJob({
      workspaceId: 'campaign-1',
      workspaceRootPath: '/workspace',
      item,
      job,
    }, {
      resolveMediaPath: () => '/workspace/.craft-agent/outputs/output-1/teaser.jpg',
      runSocialJson: async (input) => {
        args = input
        return {
          ok: true,
          status: 'dry_run',
          actionId: `act_${job.id}`,
          platform: 'instagram',
          profile: 'ig-main',
          action: {
            actionId: `act_${job.id}`,
            verb: 'post',
            platform: 'instagram',
            profile: 'ig-main',
            payload: { text: 'New song Friday.', media: ['/workspace/.craft-agent/outputs/output-1/teaser.jpg'] },
            options: { dryRun: true, idempotencyKey: job.idempotencyKey },
          },
          browserPlan: {
            accountVerification: { verificationTargetKnown: true },
          },
        }
      },
    })

    expect(args).toEqual([
      'post', 'instagram',
      '--profile', 'ig-main',
      '--text', 'New song Friday.',
      '--media', '/workspace/.craft-agent/outputs/output-1/teaser.jpg',
      '--action-id', `act_${job.id}`,
      '--idempotency-key', job.idempotencyKey,
      '--dry-run',
      '--json',
    ])
    expect(result).toMatchObject({
      actionId: `act_${job.id}`,
      platform: 'instagram',
      profileId: 'ig-main',
      summary: 'Instagram post for ig-main is ready for exact approval.',
    })
    expect(result.actionDigest).toMatch(/^sha256:/)
  })

  test('rejects a dry-run resolved for a different profile', async () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { text: 'New song Friday.' },
    })
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      socialProfileRefs: [{ platform: 'x', profileId: 'artist-main' }],
      job,
    })

    await expect(prepareCampaignSocialJob({
      workspaceId: 'campaign-1',
      workspaceRootPath: '/workspace',
      item,
      job,
    }, {
      resolveMediaPath: () => undefined,
      runSocialJson: async () => ({
        ok: true,
        status: 'dry_run',
        actionId: `act_${job.id}`,
        platform: 'x',
        profile: 'label-main',
        action: {},
        browserPlan: { accountVerification: { verificationTargetKnown: true } },
      }),
    })).rejects.toThrow(/profile mismatch/i)
  })

  test('rejects a dry-run without a known account verification target', async () => {
    const job = createCampaignScheduledJob({
      runAt: '2026-07-10T14:00:00.000Z',
      actionType: 'post-asset',
      payload: { text: 'New song Friday.' },
    })
    const item = createCampaignCalendarItem({
      campaignId: 'campaign-1',
      date: '2026-07-10',
      title: 'Post teaser',
      kind: 'scheduled-job',
      socialProfileRefs: [{ platform: 'x', profileId: 'artist-main' }],
      job,
    })

    await expect(prepareCampaignSocialJob({
      workspaceId: 'campaign-1',
      workspaceRootPath: '/workspace',
      item,
      job,
    }, {
      resolveMediaPath: () => undefined,
      runSocialJson: async () => ({
        ok: true,
        status: 'dry_run',
        actionId: `act_${job.id}`,
        platform: 'x',
        profile: 'artist-main',
        action: {},
        browserPlan: { accountVerification: { verificationTargetKnown: false } },
      }),
    })).rejects.toThrow(/verification target/i)
  })
})
