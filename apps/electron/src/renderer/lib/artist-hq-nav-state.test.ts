import { describe, expect, test } from 'bun:test'
import { getArtistHqNavActiveState, isConciergeSessionLike } from './artist-hq-nav-state'

describe('isConciergeSessionLike', () => {
  test('detects concierge sessions from launch receipt origin', () => {
    expect(isConciergeSessionLike({
      conciergeSlug: '@concierge',
      launchReceipt: { origin: 'concierge' },
    })).toBe(true)
  })

  test('detects older HNIC sessions by display name fallback', () => {
    expect(isConciergeSessionLike({
      conciergeSlug: '@concierge',
      name: 'HNIC chat session',
    })).toBe(true)
  })
})

describe('getArtistHqNavActiveState', () => {
  test('does not highlight HQ while the HNIC chat session is active', () => {
    expect(getArtistHqNavActiveState({
      isArtistHQWorkspace: true,
      isSessionsNavigation: true,
      artistHqHash: '',
      hasSessionRoute: true,
      isConciergeChat: true,
    })).toMatchObject({
      hqHomeActive: false,
      hqSessionsActive: false,
    })
  })

  test('highlights HQ when an explicit HQ tab is open over a stale HNIC session route', () => {
    expect(getArtistHqNavActiveState({
      isArtistHQWorkspace: true,
      isSessionsNavigation: true,
      artistHqHash: '#artist-hq/home',
      hasSessionRoute: true,
      isConciergeChat: true,
    })).toMatchObject({
      hqHomeActive: true,
      hqSessionsActive: false,
    })
  })

  test('highlights HQ only for the HQ home tab', () => {
    expect(getArtistHqNavActiveState({
      isArtistHQWorkspace: true,
      isSessionsNavigation: true,
      artistHqHash: '#artist-hq/home',
      hasSessionRoute: false,
      isConciergeChat: false,
    })).toMatchObject({
      hqHomeActive: true,
      hqSessionsActive: false,
    })
  })

  test('highlights Sessions only for normal HQ session browsing', () => {
    expect(getArtistHqNavActiveState({
      isArtistHQWorkspace: true,
      isSessionsNavigation: true,
      artistHqHash: '',
      hasSessionRoute: true,
      isConciergeChat: false,
    })).toMatchObject({
      hqHomeActive: false,
      hqSessionsActive: true,
    })
  })
})
