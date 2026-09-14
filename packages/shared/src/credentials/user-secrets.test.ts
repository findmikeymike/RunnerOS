import { describe, expect, test } from 'bun:test';
import { accountToCredentialId, credentialIdToAccount } from './types.ts';
import { publicMediaSettingValue, isValidUserSecretName, maskSecretValue, normalizeUserSecretName } from './manager.ts';

describe('user secret credentials', () => {
  test('round-trips user_secret ids by env var name', () => {
    const id = { type: 'user_secret' as const, name: 'ZERO_PRIVATE_KEY' };
    const account = credentialIdToAccount(id);

    expect(account).toBe('user_secret::ZERO_PRIVATE_KEY');
    expect(accountToCredentialId(account)).toEqual(id);
  });

  test('normalizes and validates env-style names', () => {
    expect(normalizeUserSecretName(' zero_private_key ')).toBe('ZERO_PRIVATE_KEY');
    expect(isValidUserSecretName('ZERO_PRIVATE_KEY')).toBe(true);
    expect(isValidUserSecretName('1_BAD')).toBe(false);
    expect(isValidUserSecretName('bad-name')).toBe(false);
  });

  test('masks secret values without exposing the full string', () => {
    expect(maskSecretValue('sk-or-v1-example-secret')).toBe('sk-o••••cret');
    expect(maskSecretValue('short')).toBe('••••');
  });
});


describe('public media setting summaries', () => {
  test('returns saved provider and priority choices', () => {
    expect(publicMediaSettingValue('MEDIA_IMAGE_PROVIDER', 'wavespeed')).toBe('wavespeed');
    expect(publicMediaSettingValue('MEDIA_VIDEO_PROVIDER', 'auto')).toBe('auto');
    expect(publicMediaSettingValue('MEDIA_PROVIDER_STRATEGY', 'quality')).toBe('quality');
  });
  test('never exposes credentials or unexpected values', () => {
    expect(publicMediaSettingValue('FAL_API_KEY', 'secret')).toBeUndefined();
    expect(publicMediaSettingValue('MEDIA_IMAGE_PROVIDER', 'unexpected-secret')).toBeUndefined();
    expect(publicMediaSettingValue('constructor', 'secret')).toBeUndefined();
  });
});
