import { describe, expect, test } from 'bun:test'
import { adaptCredentialForPiSdk, type PiCredential } from './adapt-credential.ts'

/**
 * These pin the two shapes that stopped resolving when the Pi SDK began
 * resolving stored credentials strictly by type. Both were failing silently in
 * the sense that nothing crashed — the provider simply reported itself
 * unconfigured and every prompt failed at request time.
 */

describe('adaptCredentialForPiSdk', () => {
  test('rewraps a bearer token as oauth for an OAuth-only provider', () => {
    // We do the OAuth exchange in the main process and ship the access token as
    // an api_key. openai-codex declares oauth but no apiKey in the SDK catalog,
    // so stored as-is it resolves to nothing.
    const result = adaptCredentialForPiSdk('openai-codex', { type: 'api_key', key: 'sk-token' })

    expect(result).toEqual({
      type: 'oauth',
      access: 'sk-token',
      refresh: '',
      expires: Number.MAX_SAFE_INTEGER,
    })
  })

  test('the rewrapped credential never expires, so the SDK never tries to refresh it', () => {
    // Refresh is owned by the main process, which pushes new tokens via
    // token_update. A real expiry here would hand that job to the SDK, which has
    // no refresh token to use.
    const result = adaptCredentialForPiSdk('openai-codex', { type: 'api_key', key: 'sk-token' })

    expect(result).not.toBeNull()
    expect((result as { expires: number }).expires).toBe(Number.MAX_SAFE_INTEGER)
    expect((result as { refresh: string }).refresh).toBe('')
  })

  test('leaves api_key alone for providers that actually accept one', () => {
    const credential: PiCredential = { type: 'api_key', key: 'sk-anthropic' }

    expect(adaptCredentialForPiSdk('anthropic', credential)).toEqual(credential)
  })

  test('stores nothing for IAM, so Bedrock resolves from the injected AWS environment', () => {
    // Storing an IAM credential shadows ambient resolution, and the SDK has no
    // handler for the shape either — the net effect was Bedrock reporting itself
    // unconfigured despite valid keys being present at spawn.
    const result = adaptCredentialForPiSdk('amazon-bedrock', {
      type: 'iam',
      accessKeyId: 'AKIA_EXAMPLE',
      secretAccessKey: 'secret',
      region: 'us-east-1',
    })

    expect(result).toBeNull()
  })

  test('passes oauth credentials through untouched', () => {
    const credential: PiCredential = { type: 'oauth', access: 'a', refresh: 'r', expires: 123 }

    expect(adaptCredentialForPiSdk('anthropic', credential)).toEqual(credential)
  })
})
