import { describe, expect, it } from 'bun:test'
import {
  ARTIST_OS_PERMISSION_MODES,
  ARTIST_OS_PERMISSION_MODE_COPY,
  normalizeArtistPermissionMode,
} from './artist-permission-modes'

describe('Artist OS permission modes', () => {
  it('offers only approval-gated work and autonomous work', () => {
    expect(ARTIST_OS_PERMISSION_MODES).toEqual(['ask', 'allow-all'])
    expect(ARTIST_OS_PERMISSION_MODE_COPY.ask.label).toBe('Approval Mode')
    expect(ARTIST_OS_PERMISSION_MODE_COPY['allow-all'].label).toBe('Go Mode')
  })

  it('moves legacy read-only sessions into approval mode', () => {
    expect(normalizeArtistPermissionMode('safe')).toBe('ask')
    expect(normalizeArtistPermissionMode('ask')).toBe('ask')
    expect(normalizeArtistPermissionMode('allow-all')).toBe('allow-all')
  })
})
