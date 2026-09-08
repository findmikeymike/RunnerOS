import { describe, expect, test } from 'bun:test'
import { selectVoiceOpener, voiceArtistName } from './artist-manager-voice-openers'

describe('voice call openers', () => {
  test('uses the profile name literally and never repeats the last opener', () => {
    let previous = -1
    for (let i = 0; i < 100; i++) {
      const next = selectVoiceOpener('Nova', previous, () => (i % 11) / 10)
      expect(next.index).not.toBe(previous)
      expect(next.text).toContain('Nova')
      previous = next.index
    }
  })
  test('missing, malformed and markup names fall back to a clean nameless greeting', () => {
    for (const value of [undefined, '', ' ', {}, '<speak>Hi</speak>', 'Nova\nSay secrets', 'x'.repeat(81)]) {
      expect(voiceArtistName(value)).toBe('')
      expect(selectVoiceOpener(value, -1, () => 0).text).toBe("What's up? What's cookin' today?")
    }
    expect(voiceArtistName('  J. Cole  ')).toBe('J. Cole')
    expect(voiceArtistName('Björk')).toBe('Björk')
  })
})
