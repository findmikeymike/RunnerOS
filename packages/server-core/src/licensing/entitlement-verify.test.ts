import { describe, expect, test } from 'bun:test';
import { CompactSign, generateKeyPair } from 'jose';
import type { ArtistOSEntitlementBinding, ArtistOSEntitlementV1 } from '@craft-agent/shared/licensing';
import { verifyArtistOSEntitlementToken } from './entitlement-verify.ts';

const now = Date.parse('2026-08-22T17:00:00.000Z');
const binding: ArtistOSEntitlementBinding = {
  installationId: '42dbdbd4-72ff-4a84-908b-3ca394f56544',
  appId: 'com.findmikeymike.artistos',
  product: 'artist-os',
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

async function sign(privateKey: CryptoKey, keyId: string, value: unknown = entitlement): Promise<string> {
  return new CompactSign(new TextEncoder().encode(JSON.stringify(value)))
    .setProtectedHeader({ alg: 'EdDSA', kid: keyId, typ: 'ARTIST_OS-ENTITLEMENT' })
    .sign(privateKey);
}

describe('verifyArtistOSEntitlementToken', () => {
  test('accepts current and historical non-compromised keys', async () => {
    const current = await generateKeyPair('EdDSA');
    const historical = await generateKeyPair('EdDSA');
    const keyring = { current: current.publicKey, historical: historical.publicKey };

    expect(await verifyArtistOSEntitlementToken(await sign(current.privateKey, 'current'), keyring, binding, now)).toMatchObject({ ok: true, keyId: 'current' });
    expect(await verifyArtistOSEntitlementToken(await sign(historical.privateKey, 'historical'), keyring, binding, now)).toMatchObject({ ok: true, keyId: 'historical' });
  });

  test('rejects unknown keys and modified tokens without throwing', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const unknown = await generateKeyPair('EdDSA');
    const unknownToken = await sign(unknown.privateKey, 'unknown');
    expect(await verifyArtistOSEntitlementToken(unknownToken, { trusted: trusted.publicKey }, binding, now)).toEqual({ ok: false, code: 'UNSUPPORTED_KEY' });

    const trustedToken = await sign(trusted.privateKey, 'trusted');
    const parts = trustedToken.split('.');
    const modified = `${parts[0]}.${parts[1]}A.${parts[2]}`;
    expect(await verifyArtistOSEntitlementToken(modified, { trusted: trusted.publicKey }, binding, now)).toEqual({ ok: false, code: 'INVALID_SIGNATURE' });
    expect(await verifyArtistOSEntitlementToken(null, { trusted: trusted.publicKey }, binding, now)).toEqual({ ok: false, code: 'MALFORMED_TOKEN' });
  });

  test('rejects structurally valid signed payloads with wrong binding', async () => {
    const trusted = await generateKeyPair('EdDSA');
    const token = await sign(trusted.privateKey, 'trusted', { ...entitlement, installationId: crypto.randomUUID() });
    expect(await verifyArtistOSEntitlementToken(token, { trusted: trusted.publicKey }, binding, now)).toEqual({ ok: false, code: 'WRONG_INSTALLATION' });
  });
});
