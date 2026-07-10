import { describe, expect, test } from 'bun:test'
import {
  createCampaignCalendarItem,
  createCampaignScheduledJob,
} from '@craft-agent/shared/campaign-calendar'
import { executeScheduledSocialWork, prepareCampaignSocialJob, prepareScheduledSocialWork } from '../campaign-social-job-preparer'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'

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
      fingerprintMediaPath: () => 'sha256:media-one',
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

  test('changes the approval digest when media bytes change at the same path', async () => {
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
      socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-main' }],
      outputRefs: [{ outputId: 'output-1' }],
      job,
    })
    const dryRun = {
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
        payload: { text: 'New song Friday.', media: ['/workspace/output.jpg'] },
        options: { dryRun: true },
      },
      browserPlan: { accountVerification: { verificationTargetKnown: true } },
    }
    const prepare = (fingerprint: string) => prepareCampaignSocialJob({
      workspaceId: 'campaign-1',
      workspaceRootPath: '/workspace',
      item,
      job,
    }, {
      resolveMediaPath: () => '/workspace/output.jpg',
      fingerprintMediaPath: () => fingerprint,
      runSocialJson: async () => dryRun,
    })

    const first = await prepare('sha256:first-bytes')
    const second = await prepare('sha256:second-bytes')

    expect(first.actionDigest).not.toBe(second.actionDigest)
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

describe('native scheduled social work', () => {
  const order: ScheduledWorkOrder = {
    version: 1,
    id: 'social-native-1',
    owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
    calendarLink: { calendar: 'campaign', itemId: 'calendar-native-1' },
    title: 'Publish teaser',
    type: 'social-publish',
    status: 'needs-approval',
    startAt: '2026-07-10T14:00:00.000Z',
    timezone: 'America/Chicago',
    execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Out Friday.' },
    inputRefs: [], approvals: [], runs: [],
    executionKey: { payloadDigest: 'payload-native-1', idempotencyKey: 'idem-native-1' },
    createdAt: '2026-07-09T00:00:00.000Z', updatedAt: '2026-07-09T00:00:00.000Z',
  }

  test('prepares the exact action and refuses a delegated result without a real receipt', async () => {
    const dryRun = {
      ok: true, status: 'dry_run', actionId: 'act_social-native-1', platform: 'x', profile: 'artist-main',
      action: { actionId: 'act_social-native-1', platform: 'x', profile: 'artist-main', payload: { text: 'Out Friday.' }, options: { dryRun: true, idempotencyKey: 'idem-native-1' } },
      browserPlan: { accountVerification: { verificationTargetKnown: true } },
    }
    const preview = await prepareScheduledSocialWork({ workspaceRootPath: '/workspace', order }, { runSocialJson: async () => dryRun })
    let executeArgs: string[] = []
    const execution = executeScheduledSocialWork({
      workspaceRootPath: '/workspace', order, preview,
      approval: { id: 'approval-1', approvedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), actionId: preview.actionId, actionDigest: preview.actionDigest, mediaDigest: preview.mediaDigest, payloadDigest: preview.payloadDigest, platform: preview.platform, profileId: preview.profileId, approvedBy: { type: 'user', clientId: 'test-client' } },
    }, { runSocialJson: async (args) => { executeArgs = args; return { ok: true, status: 'delegated', code: 'RUNNER_CDP_DELEGATED' } } })

    await expect(execution).rejects.toThrow(/visible-account verification/i)
    expect(executeArgs).toContain('--expected-action-id')
    expect(executeArgs).toContain('act_social-native-1')
    expect(executeArgs).toContain('runner-cdp')
  })

  test('rejects a dry-run whose caption differs from the order', async () => {
    await expect(prepareScheduledSocialWork({ workspaceRootPath: '/workspace', order }, { runSocialJson: async () => ({
      ok: true, status: 'dry_run', actionId: 'act_social-native-1', platform: 'x', profile: 'artist-main',
      action: { actionId: 'act_social-native-1', platform: 'x', profile: 'artist-main', payload: { text: 'Changed text.' }, options: { dryRun: true, idempotencyKey: 'idem-native-1' } },
      browserPlan: { accountVerification: { verificationTargetKnown: true } },
    }) })).rejects.toThrow(/authoritative work order/i)
  })
})
