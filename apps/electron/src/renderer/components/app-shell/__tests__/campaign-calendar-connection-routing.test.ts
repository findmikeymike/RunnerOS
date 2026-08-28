import { describe, expect, it } from 'bun:test'
import { connectionSettingsSubpageForWork } from '../CampaignCalendarPage'
import type { ScheduledWorkOrder } from '@craft-agent/shared/scheduled-work'

function work(overrides: Partial<ScheduledWorkOrder> = {}): ScheduledWorkOrder {
  return {
    version: 1,
    id: 'work-1',
    owner: { scope: 'campaign', workspaceId: 'ws-1', campaignId: 'camp-1' },
    calendarLink: { calendar: 'campaign', itemId: 'item-1' },
    title: 'Test work',
    type: 'agent-task',
    status: 'needs-attention',
    startAt: '2026-08-27T12:00:00.000Z',
    timezone: 'America/Chicago',
    execution: {
      type: 'agent-task',
      agentSlug: 'branding-agent',
      brief: 'test',
      permissionMode: 'safe',
      expectedOutput: { requirement: 'none' },
    },
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: {
      payloadDigest: 'sha256:test',
      idempotencyKey: 'idem-1',
    },
    createdAt: '2026-08-27T12:00:00.000Z',
    updatedAt: '2026-08-27T12:00:00.000Z',
    ...overrides,
  }
}

describe('campaign connection routing', () => {
  it('routes spotify agent setup issues to Spotify settings', () => {
    expect(connectionSettingsSubpageForWork(work({
      execution: {
        type: 'agent-task',
        agentSlug: 'spotify-analyst',
        brief: 'test',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'none' },
      },
    }))).toBe('spotify')
  })

  it('routes Ad Runner browser-login issues to Ad Accounts', () => {
    expect(connectionSettingsSubpageForWork(work({
      execution: {
        type: 'agent-task',
        agentSlug: 'ads-agent',
        brief: 'test',
        permissionMode: 'safe',
        expectedOutput: { requirement: 'none' },
      },
    }))).toBe('ad-accounts')
  })

  it('routes spotify publish setup issues to Spotify settings', () => {
    expect(connectionSettingsSubpageForWork(work({
      type: 'social-publish',
      execution: {
        type: 'social-publish',
        platform: 'spotify',
        profileId: 'spotify-main',
        caption: 'test',
      },
    }))).toBe('spotify')
  })

  it('keeps standard social setup issues on Social Accounts', () => {
    expect(connectionSettingsSubpageForWork(work({
      type: 'social-publish',
      execution: {
        type: 'social-publish',
        platform: 'instagram',
        profileId: 'main',
        caption: 'test',
      },
    }))).toBe('social-accounts')
  })
})
