import { describe, expect, it } from 'bun:test'
import { socialAccountIdentityError, socialAccountReferenceError } from './social-account-reference'

const main = { platform: 'instagram', profile: 'MikeyMike' }

describe('social account posting identity validation', () => {
  it('requires a usable identity for every social platform', () => {
    for (const platform of ['instagram', 'tiktok', 'x', 'youtube']) {
      expect(socialAccountIdentityError({ platform })).toContain('exact posting handle')
      expect(socialAccountIdentityError({ platform, handle: ' @ ', accountUrl: ' ' })).toContain('exact posting handle')
      expect(socialAccountIdentityError({ platform, handle: '@artist' })).toBeNull()
    }
  })

  it('accepts a profile URL without requiring a duplicate handle', () => {
    expect(socialAccountIdentityError({ platform: 'instagram', accountUrl: 'https://instagram.com/artist' })).toBeNull()
  })

  it('preserves Spotify private workspace verification without a public handle', () => {
    expect(socialAccountIdentityError({ platform: 'spotify' })).toBeNull()
  })
})

describe('social account reference validation', () => {
  it('rejects duplicate adds even when the account is in another set', () => {
    expect(socialAccountReferenceError(main, [main], null)).toContain('already exists')
  })

  it('allows separate platform references and separate secondary accounts', () => {
    expect(socialAccountReferenceError({ ...main, platform: 'tiktok' }, [main], null)).toBeNull()
    expect(socialAccountReferenceError({ ...main, profile: 'mikey-fans' }, [main], null)).toBeNull()
  })

  it('preserves existing mixed-case references during editing', () => {
    expect(socialAccountReferenceError(main, [main], main)).toBeNull()
    expect(socialAccountReferenceError({ ...main, profile: 'mikeymike' }, [main], main)).toContain('cannot be changed')
    expect(socialAccountReferenceError({ ...main, platform: 'tiktok' }, [main], main)).toContain('cannot be changed')
  })

  it('rejects invalid browser references before saving', () => {
    for (const profile of ['', 'main account', '../main', '@main', '-main', 'a'.repeat(65)]) {
      expect(socialAccountReferenceError({ ...main, profile }, [], null)).toContain('No spaces')
    }
    expect(socialAccountReferenceError({ ...main, profile: 'main_2-account' }, [], null)).toBeNull()
    expect(socialAccountReferenceError({ ...main, profile: 'a'.repeat(64) }, [], null)).toBeNull()
  })
})
