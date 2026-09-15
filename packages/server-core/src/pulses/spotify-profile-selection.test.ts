import { describe, expect, test } from 'bun:test'
import { selectSpotifyPulseProfile, spotifyArtistIdFromProfile } from './spotify-profile-selection'

const a = '12345678901234567890AB'
const b = 'abcdefghijklmnopqrstuv'
const saved = (profile: string, accountUrl = 'https://open.spotify.com/user/artist-user') => ({ platform: 'spotify', profile, accountUrl })

describe('Spotify Pulse profile selection', () => {
  test('selects one saved profile, independently of cached ready status', () => {
    expect(selectSpotifyPulseProfile({ profiles: [{ ...saved('main'), ready: false }, { platform: 'instagram', profile: 'ig' }] })).toBe('main')
    expect(selectSpotifyPulseProfile({ profiles: [saved('artist', `https://open.spotify.com/artist/${a}?si=123`)] })).toBe('artist')
    expect(selectSpotifyPulseProfile({ profiles: [saved('main'), saved('main')] })).toBe('main')
  })
  test('requires a valid Spotify identity URL', () => {
    for (const accountUrl of ['', 'https://evil.test/user/x', 'https://open.spotify.com.evil.test/user/x', 'https://open.spotify.com/playlist/x', 'https://open.spotify.com/artist/short', 'https://name@open.spotify.com/user/x']) {
      expect(() => selectSpotifyPulseProfile({ profiles: [saved('main', accountUrl)] })).toThrow('Settings')
    }
    for (const catalog of [null, {}, { profiles: {} }, { profiles: [null, saved(' ')] }]) expect(() => selectSpotifyPulseProfile(catalog)).toThrow('Settings')
  })
  test('refuses to choose between saved profiles', () => {
    expect(() => selectSpotifyPulseProfile({ profiles: [saved('one'), saved('two')] })).toThrow('Multiple saved')
  })
})

describe('Spotify artist identity selection', () => {
  test('canonical artist field takes priority over other social links', () => {
    expect(spotifyArtistIdFromProfile({ spotifyProfile: `https://open.spotify.com/artist/${a}?si=abc`, socialLinks: `https://open.spotify.com/artist/${b}` })).toBe(a)
    expect(spotifyArtistIdFromProfile({ spotifyProfile: `spotify:artist:${a}` })).toBe(a)
  })
  test('falls back to a unique artist social link when canonical field has none', () => {
    expect(spotifyArtistIdFromProfile({ spotifyProfile: 'https://open.spotify.com/user/a', socialLinks: `Spotify: https://open.spotify.com/artist/${b}.\nWebsite https://example.com` })).toBe(b)
    expect(spotifyArtistIdFromProfile({ socialLinks: `https://open.spotify.com/artist/${a} spotify:artist:${a}` })).toBe(a)
  })
  test('rejects ambiguity in canonical field rather than falling back', () => {
    expect(() => spotifyArtistIdFromProfile({ spotifyProfile: `spotify:artist:${a} spotify:artist:${b}`, socialLinks: `spotify:artist:${a}` })).toThrow('multiple Spotify artists')
    expect(() => spotifyArtistIdFromProfile({ socialLinks: `https://open.spotify.com/artist/${a}\nhttps://open.spotify.com/artist/${b}` })).toThrow('multiple Spotify artists')
  })
  test('rejects user, playlist, lookalike-host, malformed and overlong IDs', () => {
    for (const spotifyProfile of ['', a, `https://open.spotify.com/user/${a}`, `https://open.spotify.com/playlist/${a}`, `https://open.spotify.com.evil.test/artist/${a}`, `spotify:artist:${a}Z`, 'https://open.spotify.com/artist/short']) {
      expect(() => spotifyArtistIdFromProfile({ spotifyProfile })).toThrow('Add the artist')
    }
  })
})
