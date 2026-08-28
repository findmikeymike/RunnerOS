import { describe, expect, it } from 'bun:test';
import { toPiTransportCredential } from './pi-auth-credential.ts';

describe('toPiTransportCredential', () => {
  const stored = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: 1234,
  };

  it('preserves OpenAI Codex subscription OAuth', () => {
    expect(toPiTransportCredential('openai-codex', stored)).toEqual({
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: 1234,
    });
  });

  it('preserves GitHub Copilot OAuth', () => {
    expect(toPiTransportCredential('github-copilot', stored).type).toBe('oauth');
  });

  it('keeps bearer-token providers on the API-key transport', () => {
    expect(toPiTransportCredential('anthropic', stored)).toEqual({
      type: 'api_key',
      key: 'access-token',
    });
  });
});
