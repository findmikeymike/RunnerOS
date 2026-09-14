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
