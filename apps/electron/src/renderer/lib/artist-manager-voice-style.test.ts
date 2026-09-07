import { describe, expect, test } from 'bun:test'
import {
  ARTIST_MANAGER_VOICE_STYLES,
  buildArtistManagerVoiceStylePrompt,
  normalizeArtistManagerVoiceStyle,
} from './artist-manager-voice-style'

describe('Artist Manager voice styles', () => {
  test('offers three distinct, stable styles with Sharp as the default', () => {
    expect(ARTIST_MANAGER_VOICE_STYLES.map((style) => style.id)).toEqual(['sharp', 'high-energy', 'laid-back'])
    expect(normalizeArtistManagerVoiceStyle(undefined)).toBe('sharp')
    expect(normalizeArtistManagerVoiceStyle('high-energy')).toBe('high-energy')
    expect(normalizeArtistManagerVoiceStyle('unknown')).toBe('sharp')
  })

  test('keeps every style natural, action-oriented, and subtly independent', () => {
    for (const style of ARTIST_MANAGER_VOICE_STYLES) {
      const prompt = buildArtistManagerVoiceStylePrompt(style.id)
      expect(prompt).toContain('This changes delivery only')
      expect(prompt).toContain('ask for the next concrete move')
      expect(prompt).toContain('Very occasionally')
      expect(prompt).toContain('big labels')
      expect(prompt).toContain('Never turn it into a slogan')
      expect(prompt).toContain('Never force it')
    }
  })

  test('calibrates casual speech without copying a public personality', () => {
    const prompt = buildArtistManagerVoiceStylePrompt('high-energy')
    expect(prompt).toContain('Yo, the single is slated for the 6th')
    expect(prompt).not.toMatch(/Gary Vee/i)
  })
})
