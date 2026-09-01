import { describe, expect, it } from 'bun:test'
import {
  validateSetupTestInput,
  isLoopbackBaseUrl,
  normalizeOmniRouteBaseUrl,
  setupTestRequiresApiKey,
  validateOmniRouteEndpoint,
} from './connection-setup-logic'

describe('validateSetupTestInput', () => {
  it('rejects pi custom endpoint tests without piAuthProvider', () => {
    const result = validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.error).toContain('requires selecting a provider preset')
    }
  })

  it('allows pi custom endpoint tests with piAuthProvider', () => {
    expect(validateSetupTestInput({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
      piAuthProvider: 'openai',
    })).toEqual({ valid: true })
  })
})

describe('setup test API key requirements', () => {
  it('detects loopback base URLs', () => {
    expect(isLoopbackBaseUrl('http://localhost:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('http://[::1]:11434/v1')).toBe(true)
    expect(isLoopbackBaseUrl('https://api.openai.com/v1')).toBe(false)
  })

  it('requires API key for non-loopback setup tests', () => {
    expect(setupTestRequiresApiKey('https://api.anthropic.com')).toBe(true)
    expect(setupTestRequiresApiKey('https://example.com/v1')).toBe(true)
  })

  it('allows keyless setup tests for loopback endpoints', () => {
    expect(setupTestRequiresApiKey('http://localhost:11434/v1')).toBe(false)
    expect(setupTestRequiresApiKey('http://127.0.0.1:11434/v1')).toBe(false)
  })
})

describe('OmniRoute endpoint handling', () => {
  it('adds /v1 to a bare server origin', () => {
    expect(normalizeOmniRouteBaseUrl('https://gateway.example.com/')).toBe('https://gateway.example.com/v1')
  })

  it('preserves an explicit reverse-proxy path', () => {
    expect(normalizeOmniRouteBaseUrl('https://gateway.example.com/artist/v1/')).toBe('https://gateway.example.com/artist/v1')
  })

  it('allows HTTPS remotely and HTTP only on loopback', () => {
    expect(validateOmniRouteEndpoint('https://gateway.example.com')).toEqual({
      valid: true,
      baseUrl: 'https://gateway.example.com/v1',
    })
    expect(validateOmniRouteEndpoint('http://localhost:20128')).toEqual({
      valid: true,
      baseUrl: 'http://localhost:20128/v1',
    })
    expect(validateOmniRouteEndpoint('http://gateway.example.com')).toEqual({
      valid: false,
      error: 'Remote OmniRoute servers must use HTTPS. HTTP is allowed only for localhost.',
    })
  })

  it('rejects missing, malformed, and credential-bearing URLs', () => {
    expect(validateOmniRouteEndpoint()).toEqual({ valid: false, error: 'OmniRoute server URL is required.' })
    expect(validateOmniRouteEndpoint('not a url')).toEqual({ valid: false, error: 'Enter a valid OmniRoute server URL.' })
    expect(validateOmniRouteEndpoint('https://user:pass@gateway.example.com')).toEqual({
      valid: false,
      error: 'OmniRoute credentials must use the API key field, not the server URL.',
    })
  })
})
