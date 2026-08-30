import { describe, expect, test } from 'bun:test'
import {
  isAllowedVoiceProxyOrigin,
  voiceProxyTokensMatch,
  withVoiceProxyAccessToken,
} from './artist-manager-voice-proxy'

describe('artist manager voice proxy security', () => {
  test('only accepts packaged or literal loopback renderer origins', () => {
    expect(isAllowedVoiceProxyOrigin(undefined)).toBe(true)
    expect(isAllowedVoiceProxyOrigin('null')).toBe(true)
    expect(isAllowedVoiceProxyOrigin('file://')).toBe(true)
    expect(isAllowedVoiceProxyOrigin('http://127.0.0.1:5173')).toBe(true)
    expect(isAllowedVoiceProxyOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedVoiceProxyOrigin('https://evil.example')).toBe(false)
  })

  test('requires the exact per-launch access token', () => {
    expect(voiceProxyTokensMatch('correct', 'correct')).toBe(true)
    expect(voiceProxyTokensMatch('wrong', 'correct')).toBe(false)
    expect(voiceProxyTokensMatch(null, 'correct')).toBe(false)
  })

  test('adds the access token without corrupting the websocket URL', () => {
    const url = new URL(withVoiceProxyAccessToken('ws://127.0.0.1:3210/inworld', 'secret'))
    expect(url.protocol).toBe('ws:')
    expect(url.searchParams.get('artist_manager_voice_token')).toBe('secret')
  })
})
