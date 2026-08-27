import { describe, expect, test } from 'bun:test';
import {
  ARTIST_OS_APP_ID,
  ARTIST_OS_PRODUCT,
  validateActivateEntitlementRequest,
  validateArtistOSEntitlement,
  type ArtistOSEntitlementBinding,
  type ArtistOSEntitlementV1,
} from './contract.ts';

const binding: ArtistOSEntitlementBinding = {
  installationId: '42dbdbd4-72ff-4a84-908b-3ca394f56544',
  appId: ARTIST_OS_APP_ID,
  product: ARTIST_OS_PRODUCT,
  majorVersion: 1,
  distributionChannel: 'direct',
};

const entitlement: ArtistOSEntitlementV1 = {
  schemaVersion: 1,
  issuer: 'https://license.artistos.app',
  audience: 'com.findmikeymike.artistos',
  entitlementId: '4b230a15-47d4-4ba5-bd77-4908a5374118',
  vendor: 'lemon-squeezy',
  vendorLicenseId: '1234',
  product: 'artist-os',
  edition: 'premium',
  plan: 'perpetual-premium-v1',
  majorVersion: 1,
  distributionChannel: 'direct',
  installationId: binding.installationId,
  activationInstanceId: '79b23346-5159-4a63-a887-41f3e97eca70',
  seatLimit: 3,
  status: 'active',
  issuedAt: '2026-08-22T17:00:00.000Z',
  lastValidatedAt: '2026-08-22T17:00:00.000Z',
  refreshAfter: '2026-08-23T17:00:00.000Z',
};

describe('ArtistOS licensing contract', () => {
  test('accepts the exact perpetual direct entitlement', () => {
    expect(validateArtistOSEntitlement(entitlement, binding, Date.parse('2026-08-22T17:00:01.000Z'))).toEqual({
      ok: true,
      entitlement,
    });
  });

  test('accepts Basic and Premium only when the tier and perpetual plan match', () => {
    const basic = { ...entitlement, edition: 'basic', plan: 'perpetual-basic-v1' } as const;
    expect(validateArtistOSEntitlement(basic, binding, Date.parse('2026-08-22T17:00:01.000Z'))).toMatchObject({ ok: true });
    expect(validateArtistOSEntitlement(
      { ...basic, plan: 'perpetual-premium-v1' },
      binding,
      Date.parse('2026-08-22T17:00:01.000Z'),
    )).toEqual({ ok: false, code: 'WRONG_PRODUCT' });
  });

  test.each([
    ['extra field', { ...entitlement, extra: true }, 'INVALID_PAYLOAD'],
    ['wrong audience', { ...entitlement, audience: 'other.app' }, 'WRONG_AUTHORITY'],
    ['wrong product', { ...entitlement, product: 'other' }, 'WRONG_PRODUCT'],
    ['wrong channel', { ...entitlement, distributionChannel: 'development' }, 'WRONG_CHANNEL'],
    ['wrong installation', { ...entitlement, installationId: crypto.randomUUID() }, 'WRONG_INSTALLATION'],
    ['future issued', { ...entitlement, issuedAt: '2026-08-22T17:06:00.000Z' }, 'INVALID_TIME'],
    ['inverted refresh', { ...entitlement, refreshAfter: '2026-08-21T17:00:00.000Z' }, 'INVALID_TIME'],
  ] as const)('rejects %s', (_name, value, code) => {
    expect(validateArtistOSEntitlement(value, binding, Date.parse('2026-08-22T17:00:00.000Z'))).toEqual({ ok: false, code });
  });

  test('accepts strict activation input and rejects renderer-added authority fields', () => {
    const request = {
      schemaVersion: 1,
      email: 'writer@example.com',
      licenseKey: 'ABCD-EFGH-IJKL',
      installationId: binding.installationId,
      appVersion: '1.0.0',
      platform: 'macos',
      architecture: 'arm64',
      requestId: 'request-1',
    };
    expect(validateActivateEntitlementRequest(request)).toBe(true);
    expect(validateActivateEntitlementRequest({ ...request, product: 'artist-os' })).toBe(false);
    expect(validateActivateEntitlementRequest({ ...request, email: 'not-an-email' })).toBe(false);
    expect(validateActivateEntitlementRequest({ ...request, email: ' writer@example.com ' })).toBe(false);
  });

  test('rejects impossible calendar dates', () => {
    expect(validateArtistOSEntitlement(
      { ...entitlement, issuedAt: '2026-02-31T17:00:00.000Z' },
      binding,
      Date.parse('2026-03-03T17:00:00.000Z'),
    )).toEqual({ ok: false, code: 'INVALID_TIME' });
  });
});
