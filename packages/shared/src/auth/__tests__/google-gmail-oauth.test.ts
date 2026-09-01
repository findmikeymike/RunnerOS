import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'

import {
  exchangeGoogleOAuth,
  prepareGoogleOAuth,
  refreshGoogleToken,
  revokeGoogleToken,
} from '../google-oauth'

const originalFetch = globalThis.fetch
const gmailScopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
]

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Google Gmail installed-app OAuth', () => {
  it('creates high-entropy PKCE and one-time state values', () => {
    const first = prepareGoogleOAuth({
      service: 'gmail',
      callbackPort: 50001,
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
    const second = prepareGoogleOAuth({
      service: 'gmail',
      callbackPort: 50002,
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    const url = new URL(first.authUrl)
    expect(first.state).not.toBe(second.state)
    expect(first.state.length).toBeGreaterThanOrEqual(32)
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(first.codeVerifier).digest('base64url'),
    )
    expect(url.searchParams.get('scope')?.split(' ')).toEqual(gmailScopes)
  })

  it('requires an explicit loopback callback target', () => {
    expect(() => prepareGoogleOAuth({
      service: 'gmail',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })).toThrow('authorization failed')
  })

  it('validates granted scopes and gets the account from Gmail without an identity scope', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/token')) {
        return Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: gmailScopes.join(' '),
        })
      }
      return Response.json({ emailAddress: 'artist@example.com' })
    }) as typeof fetch

    const result = await exchangeGoogleOAuth({
      code: 'authorization-code',
      codeVerifier: 'verifier',
      redirectUri: 'http://127.0.0.1:50001/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      expectedScopes: gmailScopes,
      googleService: 'gmail',
    })

    expect(result.success).toBe(true)
    expect(result.email).toBe('artist@example.com')
    expect(result.grantedScopes).toEqual(gmailScopes)
    expect(calls[1]).toBe('https://gmail.googleapis.com/gmail/v1/users/me/profile')
  })

  it('keeps a valid Gmail grant when optional account metadata is unavailable', async () => {
    globalThis.fetch = (async (input) => {
      if (String(input).includes('/token')) {
        return Response.json({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          scope: gmailScopes.join(' '),
        })
      }
      return new Response(null, { status: 503 })
    }) as typeof fetch

    const result = await exchangeGoogleOAuth({
      code: 'authorization-code',
      codeVerifier: 'verifier',
      redirectUri: 'http://127.0.0.1:50001/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      expectedScopes: gmailScopes,
      googleService: 'gmail',
    })

    expect(result.success).toBe(true)
    expect(result.email).toBeUndefined()
    expect(result.accessToken).toBe('access-token')
    expect(result.refreshToken).toBe('refresh-token')
  })

  it('rejects a partial grant before storing tokens', async () => {
    globalThis.fetch = (async () => Response.json({
      access_token: 'do-not-store',
      scope: gmailScopes[0],
    })) as unknown as typeof fetch

    const result = await exchangeGoogleOAuth({
      code: 'authorization-code',
      codeVerifier: 'verifier',
      redirectUri: 'http://127.0.0.1:50001/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      expectedScopes: gmailScopes,
      googleService: 'gmail',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('both Gmail permissions')
    expect(result.error).not.toContain('do-not-store')
  })

  it('accepts an omitted token scope only for the exact state-bound request', async () => {
    globalThis.fetch = (async (input) => {
      if (String(input).includes('/token')) {
        return Response.json({ access_token: 'access-token', refresh_token: 'refresh-token' })
      }
      return Response.json({ emailAddress: 'artist@example.com' })
    }) as typeof fetch

    const result = await exchangeGoogleOAuth({
      code: 'authorization-code',
      codeVerifier: 'verifier',
      redirectUri: 'http://127.0.0.1:50001/callback',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      expectedScopes: gmailScopes,
      googleService: 'gmail',
    })

    expect(result.success).toBe(true)
    expect(result.grantedScopes).toEqual(gmailScopes)
  })

  it('surfaces revoked refresh tokens without exposing Google response bodies', async () => {
    globalThis.fetch = (async () => new Response(
      JSON.stringify({ error: 'invalid_grant', error_description: 'secret provider detail' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )) as unknown as typeof fetch

    await expect(refreshGoogleToken('refresh-token', 'client-id', 'client-secret'))
      .rejects.toThrow('expired or was revoked')
    try {
      await refreshGoogleToken('refresh-token', 'client-id', 'client-secret')
    } catch (error) {
      expect(String(error)).not.toContain('secret provider detail')
      expect(String(error)).not.toContain('refresh-token')
    }
  })

  it('revokes through Google without logging or returning the token', async () => {
    let body = ''
    globalThis.fetch = (async (_input, init) => {
      body = String(init?.body)
      return new Response(null, { status: 200 })
    }) as typeof fetch

    await revokeGoogleToken('refresh-token')
    expect(body).toBe('token=refresh-token')
  })

  it('treats an already-invalid grant as revoked', async () => {
    globalThis.fetch = (async () => new Response(null, { status: 400 })) as unknown as typeof fetch
    await expect(revokeGoogleToken('already-invalid-token')).resolves.toBeUndefined()
  })

  it('surfaces a clean revoke failure without exposing the token', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network failed with revoke-token')
    }) as unknown as typeof fetch

    await expect(revokeGoogleToken('revoke-token'))
      .rejects.toThrow('could not be reached')
  })
})
