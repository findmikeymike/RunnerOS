import { describe, expect, test } from 'bun:test';
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import { verifyArtistOSEntitlementToken } from '../../server-core/src/licensing/entitlement-verify.ts';
import type { ArtistOSEntitlementBinding, ArtistOSEntitlementV1 } from '@craft-agent/shared/licensing';
import { readEntitlementServiceConfig } from './config.ts';
import { FakeLicenseVendor } from './fake-vendor.ts';
import { loadEntitlementSigningMaterial } from './keys.ts';
import { signArtistOSEntitlement } from './signing.ts';

const binding: ArtistOSEntitlementBinding = {
  installationId: '42dbdbd4-72ff-4a84-908b-3ca394f56544',
  appId: 'com.findmikeymike.artistos',
  product: 'artist-os',
  majorVersion: 1,
  distributionChannel: 'direct',
};

describe('LIC1 signing and fake vendor proof', () => {
  test('fake vendor enforces three seats and frees exactly one', async () => {
    const vendor = new FakeLicenseVendor();
    vendor.seed({
      id: '1234', testMode: true, orderId: '5678', orderStatus: 'paid', key: 'test-key', email: 'writer@example.com',
      storeId: '1', productId: '2', variantId: '3', activationLimit: 3, status: 'inactive', expiresAt: null,
    });
    const created = [];
    for (let index = 0; index < 3; index += 1) created.push(await vendor.activate('test-key', `installation-${index}`));
    expect(created.every((entry) => entry.valid)).toBe(true);
    expect((await vendor.activate('test-key', 'installation-4')).valid).toBe(false);
    expect((await vendor.deactivate('test-key', created[1]!.instance!.id)).activationUsage).toBe(2);
    expect((await vendor.activate('test-key', 'installation-4')).valid).toBe(true);
  });

  test('signed entitlement verifies with its exact installation binding', async () => {
    const keys = await generateKeyPair('EdDSA');
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
    const token = await signArtistOSEntitlement(entitlement, 'key-1', keys.privateKey, Date.parse(entitlement.issuedAt));
    expect(await verifyArtistOSEntitlementToken(token, { 'key-1': keys.publicKey }, binding, Date.parse(entitlement.issuedAt))).toMatchObject({ ok: true, keyId: 'key-1' });
  });

  test('configuration fails closed without secrets and separates test from production', () => {
    expect(readEntitlementServiceConfig({})).toEqual({ ok: false, missing: expect.arrayContaining(['LEMON_API_KEY', 'LEMON_WEBHOOK_SECRET']) });
    const result = readEntitlementServiceConfig({
      ARTIST_OS_LICENSE_ENVIRONMENT: 'test',
      LEMON_STORE_ID: '1',
      LEMON_PRODUCT_ID: '2',
      LEMON_VARIANT_ID_BASIC_V1: '3',
      LEMON_VARIANT_ID_PREMIUM_V1: '4',
      LEMON_API_KEY: 'secret',
      LEMON_WEBHOOK_SECRET: 'secret',
      ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: 'key-1',
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: 'private',
      ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: '{"key-1":{"kty":"OKP","crv":"Ed25519","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}',
    });
    expect(result).toMatchObject({ ok: true, config: { environment: 'test', lemonStoreId: '1' } });
    expect(readEntitlementServiceConfig({
      ARTIST_OS_LICENSE_ENVIRONMENT: 'test',
      LEMON_STORE_ID: '1',
      LEMON_PRODUCT_ID: '2',
      LEMON_VARIANT_ID_BASIC_V1: 'disabled',
      LEMON_VARIANT_ID_PREMIUM_V1: '4',
      LEMON_API_KEY: 'secret',
      LEMON_WEBHOOK_SECRET: 'secret',
      ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: 'key-1',
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: 'private',
      ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: '{"key-1":{"kty":"OKP","crv":"Ed25519","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}',
    })).toMatchObject({ ok: true, config: { lemonVariantIdBasicV1: null, lemonVariantIdPremiumV1: '4' } });
    expect(readEntitlementServiceConfig({
      ARTIST_OS_LICENSE_ENVIRONMENT: 'test',
      LEMON_STORE_ID: '1',
      LEMON_PRODUCT_ID: '2',
      LEMON_VARIANT_ID_BASIC_V1: 'not-an-id',
      LEMON_VARIANT_ID_PREMIUM_V1: '4',
      LEMON_API_KEY: 'secret',
      LEMON_WEBHOOK_SECRET: 'secret',
      ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: 'key-1',
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: 'private',
      ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: '{"key-1":{"kty":"OKP","crv":"Ed25519","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}',
    })).toMatchObject({ ok: false, missing: ['LEMON_VARIANT_ID_BASIC_V1(positive integer|disabled)'] });
    expect(readEntitlementServiceConfig({
      ARTIST_OS_LICENSE_ENVIRONMENT: 'test',
      LEMON_STORE_ID: '1',
      LEMON_PRODUCT_ID: '2',
      LEMON_VARIANT_ID_BASIC_V1: '3',
      LEMON_VARIANT_ID_PREMIUM_V1: '4',
      LEMON_API_KEY: 'secret',
      LEMON_WEBHOOK_SECRET: 'secret',
      ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: 'missing-key',
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: 'private',
      ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: '{"key-1":{"kty":"OKP","crv":"Ed25519","x":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}}',
    })).toMatchObject({ ok: false });
  });

  test('boot material proves the private key matches the declared current public key', async () => {
    const current = await generateKeyPair('EdDSA', { extractable: true });
    const other = await generateKeyPair('EdDSA', { extractable: true });
    const publicJwk = await exportJWK(current.publicKey);
    const config = {
      environment: 'test' as const,
      lemonStoreId: '1',
      lemonProductId: '2',
      lemonVariantIdBasicV1: '3',
      lemonVariantIdPremiumV1: '4',
      lemonApiKey: 'secret',
      lemonWebhookSecret: 'secret',
      signingKeyIdCurrent: 'key-1',
      signingPrivateKeyCurrent: await exportPKCS8(current.privateKey),
      verificationKeysJson: JSON.stringify({ 'key-1': publicJwk }),
    };
    await expect(loadEntitlementSigningMaterial(config)).resolves.toMatchObject({ currentKeyId: 'key-1' });
    await expect(loadEntitlementSigningMaterial({
      ...config,
      signingPrivateKeyCurrent: await exportPKCS8(other.privateKey),
    })).rejects.toThrow('does not match');
  });
});
