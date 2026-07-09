import { describe, expect, test } from 'bun:test'
import { hasLoggedInSignal, isSocialPlatformUrl, socialLoginUrl } from '../social-account-browser'

describe('Spotify social-account browser verification', () => {
  test('opens Spotify for Artists for login and accepts Spotify-owned surfaces', () => {
    expect(socialLoginUrl('spotify')).toBe('https://artists.spotify.com/')
    expect(isSocialPlatformUrl('spotify', 'https://artists.spotify.com/c/artist/home')).toBe(true)
    expect(isSocialPlatformUrl('spotify', 'https://open.spotify.com/collection/playlists')).toBe(true)
    expect(isSocialPlatformUrl('spotify', 'https://spotify.com.evil.example/collection')).toBe(false)
  })

  test('recognizes authenticated Spotify surfaces conservatively', () => {
    expect(hasLoggedInSignal('spotify', '', 'https://artists.spotify.com/c/artist/audience')).toBe(true)
    expect(hasLoggedInSignal('spotify', '', 'https://open.spotify.com/collection/playlists')).toBe(true)
    expect(hasLoggedInSignal('spotify', 'Account settings', 'https://artists.spotify.com/')).toBe(true)
  })

  test('does not mistake branding or a public playlist for a logged-in session', () => {
    expect(hasLoggedInSignal('spotify', 'Spotify for Artists — Log in', 'https://artists.spotify.com/')).toBe(false)
    expect(hasLoggedInSignal('spotify', 'Your Library Create playlist', 'https://open.spotify.com/playlist/abc')).toBe(false)
    expect(hasLoggedInSignal('spotify', 'Account settings', 'https://evil.example/?next=//artists.spotify.com/home')).toBe(false)
    expect(isSocialPlatformUrl('spotify', 'https://evil.example/?next=//artists.spotify.com/home')).toBe(false)
  })
})
