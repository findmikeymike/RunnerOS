import { describe, expect, test } from 'bun:test'
import { SocialVerificationMemory } from './social-verification-memory'
import type { SocialAccountProfileStatus, SocialAccountsDoctorResult } from '../../shared/types'
const row = (platform = 'instagram', profile = 'main') => ({
  platform, profile, accountHandle: '@artist', accountUrl: 'https://example.com/artist',
  sessionPath: '/sessions/' + platform + '/' + profile, localSessionExists: true,
  liveChecked: false, ready: false, lastCheckedAt: null, profileStatus: 'session_exists_unverified',
}) as SocialAccountProfileStatus
const doctor = (...rows: SocialAccountProfileStatus[]) => ({ platforms: rows.map(profile => ({ platform: profile.platform, profiles: [profile] })) }) as SocialAccountsDoctorResult
const remember = (memory: SocialVerificationMemory, profile: SocialAccountProfileStatus) => {
  const revision = memory.begin(profile)
  memory.remember({ ...profile, ready: true, liveChecked: true, lastCheckedAt: '2026-09-13T12:00:00Z', profileStatus: 'verified' }, revision)
}
describe('social verification display memory', () => {
  test('restores Instagram and Spotify services after a fresh app instance without live authorization', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const original = new SocialVerificationMemory(storage)
    remember(original, { ...row(), evidence: { rawText: 'PRIVATE_PAGE_CONTENT' }, live: { secret: 'NEVER_SAVE' } })
    const spotify = { ...row('spotify'), spotifyCapabilities: {
      artists: { ready: true, status: 'ready', label: 'Artists', message: 'Verified', accountId: 'selected-artist' },
      webPlayer: { ready: true, status: 'ready', label: 'Player', message: 'Verified' },
      adsManager: { ready: false, status: 'login_needed', label: 'Ads', message: 'Optional' },
    } } as SocialAccountProfileStatus
    remember(original, spotify)
    const restored = new SocialVerificationMemory(storage).merge(doctor(row(), row('spotify')))
    expect(restored.platforms[0]!.profiles[0]!.ready).toBe(true)
    expect(restored.platforms[0]!.profiles[0]!.liveChecked).toBe(false)
    expect(restored.platforms[1]!.profiles[0]!.spotifyCapabilities).toEqual(spotify.spotifyCapabilities)
    expect([...values.values()].join('')).not.toContain('PRIVATE_PAGE_CONTENT')
    expect([...values.values()].join('')).not.toContain('NEVER_SAVE')
    original.invalidate(row())
    expect(new SocialVerificationMemory(storage).merge(doctor(row())).platforms[0]!.profiles[0]!.ready).toBe(false)
  })
  test('an interrupted recheck preserves the saved connection, but a failed check replaces it', () => {
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const memory = new SocialVerificationMemory(storage)
    remember(memory, row())
    const revision = memory.begin(row())
    expect(new SocialVerificationMemory(storage).merge(doctor(row())).platforms[0]!.profiles[0]!.ready).toBe(true)
    memory.remember({ ...row(), liveChecked: true, lastCheckedAt: '2026-09-14T12:00:00Z', profileStatus: 'login_needed' }, revision)
    expect(new SocialVerificationMemory(storage).merge(doctor(row())).platforms[0]!.profiles[0]!.ready).toBe(false)
  })
  test('host verification overrides stale renderer cache after an agent recheck', () => {
    const memory = new SocialVerificationMemory()
    remember(memory, row())
    const host = { ...row(), ready: false, profileStatus: 'wrong_account', savedVerification: true, lastCheckedAt: '2026-09-14T12:00:00Z' }
    const result = memory.merge(doctor(host)).platforms[0]!.profiles[0]!
    expect(result.ready).toBe(false)
    expect(result.profileStatus).toBe('wrong_account')
    expect(result.lastCheckedAt).toBe(host.lastCheckedAt)
  })
  test('corrupt storage does not block loading accounts', () => {
    const memory = new SocialVerificationMemory({ getItem: () => '{broken', setItem: () => {} })
    expect(memory.merge(doctor(row())).platforms[0]!.profiles[0]!.ready).toBe(false)
  })
  test('adding and opening TikTok preserves the Instagram observation', () => {
    const memory = new SocialVerificationMemory()
    remember(memory, row())
    memory.invalidate(row('tiktok'))
    const result = memory.merge(doctor(row(), row('tiktok')))
    expect(result.platforms[0]!.profiles[0]!.ready).toBe(true)
    expect(result.platforms[0]!.profiles[0]!.liveChecked).toBe(false)
    expect(result.platforms[1]!.profiles[0]!.ready).toBe(false)
  })
  test('identity changes and missing sessions invalidate old observations', () => {
    for (const change of [{ accountHandle: '@fan' }, { accountUrl: 'https://example.com/fan' }, { localSessionExists: false }]) {
      const memory = new SocialVerificationMemory()
      remember(memory, row())
      expect(memory.merge(doctor({ ...row(), ...change })).platforms[0]!.profiles[0]!.ready).toBe(false)
    }
  })
  test('secondary accounts stay separate and opening a row invalidates only that row', () => {
    const memory = new SocialVerificationMemory()
    remember(memory, row())
    remember(memory, row('instagram', 'fan'))
    memory.invalidate(row('instagram', 'fan'))
    const result = memory.merge(doctor(row(), row('instagram', 'fan')))
    expect(result.platforms[0]!.profiles[0]!.ready).toBe(true)
    expect(result.platforms[1]!.profiles[0]!.ready).toBe(false)
  })
  test('old async verifications cannot restore invalidated results', () => {
    const memory = new SocialVerificationMemory()
    const revision = memory.begin(row())
    memory.invalidate(row())
    expect(memory.remember({ ...row(), ready: true, liveChecked: true, lastCheckedAt: 'now' }, revision)).toBe(false)
  })
  test('deleting then recreating a row does not revive verification', () => {
    const memory = new SocialVerificationMemory()
    remember(memory, row())
    memory.merge(doctor())
    expect(memory.merge(doctor(row())).platforms[0]!.profiles[0]!.ready).toBe(false)
  })
})
