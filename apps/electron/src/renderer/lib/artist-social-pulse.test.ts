import { describe, expect, test } from 'bun:test'
import type { SocialAccountProfileStatus, SocialAccountsDoctorResult, SocialPlatform } from '../../shared/types'
import { summarizeArtistSocialPulse } from './artist-social-pulse'

describe('artist social pulse', () => {
  test('summarizes social readiness and excludes Spotify accounts', () => {
    const summary = summarizeArtistSocialPulse(doctor([
      profile('instagram', 'main', true, 'Artist'),
      profile('tiktok', 'main', false, 'Artist'),
      profile('x', 'press', true, 'Press'),
      profile('spotify', 'artist', true, 'Artist'),
    ]))

    expect(summary).toEqual(expect.objectContaining({
      totalProfiles: 3,
      readyProfiles: 2,
      attentionProfiles: 1,
      accountSets: 2,
    }))
    expect(summary.platforms.find((entry) => entry.platform === 'instagram')).toEqual({ platform: 'instagram', total: 1, ready: 1 })
    expect(summary.platforms.map((entry) => entry.platform)).toEqual(['instagram', 'tiktok', 'x', 'youtube'])
  })

  test('returns an empty, stable summary before accounts load', () => {
    expect(summarizeArtistSocialPulse(null)).toEqual(expect.objectContaining({
      totalProfiles: 0,
      readyProfiles: 0,
      attentionProfiles: 0,
      accountSets: 0,
    }))
  })
})

function doctor(profiles: SocialAccountProfileStatus[]): SocialAccountsDoctorResult {
  const platforms = Array.from(new Set(profiles.map((profile) => profile.platform)))
  return {
    ok: true,
    status: 'ok',
    command: 'doctor',
    liveChecked: false,
    summary: { totalProfiles: profiles.length, readyProfiles: profiles.filter((profile) => profile.ready).length, loginNeeded: 0, unverified: 0, wrongAccount: 0, failed: 0 },
    platforms: platforms.map((platform) => ({ platform, ok: true, profiles: profiles.filter((profile) => profile.platform === platform) })),
  }
}

function profile(platform: SocialPlatform, id: string, ready: boolean, accountGroup: string): SocialAccountProfileStatus {
  return {
    id: `${platform}/${id}`,
    platform,
    profile: id,
    accountHandle: null,
    accountUrl: null,
    accountGroup,
    sessionPath: null,
    confirmPolicy: null,
    browserEngine: null,
    profileStatus: ready ? 'ready' : 'login_needed',
    severity: ready ? 'info' : 'warning',
    message: null,
    nextAction: null,
    lastCheckedAt: null,
    ready,
    localSessionExists: ready,
    liveChecked: false,
    loggedIn: ready,
    matchesExpected: ready,
    evidence: null,
    live: null,
    error: null,
  }
}
