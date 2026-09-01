import { describe, expect, it } from 'bun:test'

import { createCallbackServer, validateOAuthCallback } from '../callback-server'

describe('OAuth callback validation', () => {
  it('accepts only the callback bound to the expected state nonce', () => {
    expect(validateOAuthCallback({ query: { state: 'expected', code: 'code' } }, 'expected'))
      .toEqual({ code: 'code' })
    expect(() => validateOAuthCallback({ query: { state: 'wrong', code: 'code' } }, 'expected'))
      .toThrow('could not be verified')
    expect(() => validateOAuthCallback({ query: { code: 'code' } }, 'expected'))
      .toThrow('could not be verified')
  })

  it('maps denied consent to a clean user-facing error', () => {
    expect(validateOAuthCallback({
      query: { state: 'expected', error: 'access_denied', error_description: 'private provider details' },
    }, 'expected')).toEqual({ error: 'Access was denied.' })
  })

  it('uses an OS-assigned 127.0.0.1 port and times out', async () => {
    const server = await createCallbackServer({ timeoutMs: 10 })
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await expect(server.promise).rejects.toThrow('timed out')
    server.close()
  })
})
