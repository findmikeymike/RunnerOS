import { describe, expect, test } from 'bun:test'
import {
  findSpotifyUserAccountUrl,
  findSpotifyAdsManagerAccountId,
  hasLoggedInSignal,
  isSocialPlatformUrl,
  socialLoginUrl,
} from '../social-account-browser'

describe('Spotify social-account browser verification', () => {
  test('opens Spotify for Artists and accepts only Spotify-owned surfaces', () => {
    expect(socialLoginUrl('spotify')).toBe('https://artists.spotify.com/')
    expect(socialLoginUrl('spotify', 'web-player')).toBe('https://open.spotify.com/collection/playlists')
    expect(isSocialPlatformUrl('spotify', 'https://artists.spotify.com/c/artist/home')).toBe(true)
    expect(isSocialPlatformUrl('spotify', 'https://open.spotify.com/collection/playlists')).toBe(true)
    expect(isSocialPlatformUrl('spotify', 'https://spotify.com.evil.example/collection')).toBe(false)
  })

  test('extracts only stable Spotify user identity URLs from the web player', () => {
    expect(findSpotifyUserAccountUrl([
      'https://open.spotify.com/collection/playlists',
      'https://open.spotify.com/user/31abcDEF_123',
      'https://example.com/user/not-spotify',
    ])).toBe('https://open.spotify.com/user/31abcDEF_123')
    expect(findSpotifyUserAccountUrl(['https://open.spotify.com/artist/abc'])).toBeNull()
  })

  test('extracts Spotify Ads Manager account ids only from account-specific evidence', () => {
    expect(findSpotifyAdsManagerAccountId({
      currentUrl: 'https://adsmanager.spotify.com/campaigns?adAccountId=account_1234',
    })).toBe('account_1234')
    expect(findSpotifyAdsManagerAccountId({
      links: ['https://adsmanager.spotify.com/advertisers/8b4f19a7-1111-4444-9999-aabbccddeeff/campaigns'],
    })).toBe('8b4f19a7-1111-4444-9999-aabbccddeeff')
    expect(findSpotifyAdsManagerAccountId({
      currentUrl: 'https://adsmanager.spotify.com/campaigns',
      text: 'Ad account ID: artist-ads-main',
    })).toBe('artist-ads-main')
    expect(findSpotifyAdsManagerAccountId({
      currentUrl: 'https://adsmanager.spotify.com/campaigns/possibly-a-campaign-id',
    })).toBeNull()
    expect(findSpotifyAdsManagerAccountId({
      currentUrl: 'https://evil.example/advertisers/account_1234',
    })).toBeNull()
  })

  test('recognizes authenticated surfaces without treating public pages as login proof', () => {
    expect(hasLoggedInSignal('spotify', '', 'https://artists.spotify.com/c/artist/audience')).toBe(true)
    expect(hasLoggedInSignal('spotify', '', 'https://open.spotify.com/collection/playlists')).toBe(true)
    expect(hasLoggedInSignal('spotify', '', 'https://artists.spotify.com/home')).toBe(false)
    expect(hasLoggedInSignal('spotify', 'Spotify for Artists - Log in', 'https://artists.spotify.com/')).toBe(false)
    expect(hasLoggedInSignal('spotify', 'Your Library Create playlist', 'https://open.spotify.com/playlist/abc')).toBe(false)
  })
})
