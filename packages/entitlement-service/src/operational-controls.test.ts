import { describe, expect, test } from 'bun:test';
import { consumeRequestLimits, deriveRequestAuthority, syncSigningKeyMetadata } from './operational-controls.ts';

describe('entitlement operational controls', () => {
  test('uses coarse hashed network and license subjects without retaining raw authority', async () => {
    const first = await deriveRequestAuthority(new Request('https://license.artistos.app', {
      headers: { 'CF-Connecting-IP': '192.0.2.10' },
    }), { licenseKey: 'TOP-SECRET-LICENSE' }, '123e4567-e89b-42d3-a456-426614174000');
    const sameNetwork = await deriveRequestAuthority(new Request('https://license.artistos.app', {
      headers: { 'CF-Connecting-IP': '192.0.2.99' },
    }), { licenseKey: 'OTHER-LICENSE-KEY' });
    expect(first.networkSha256).toBe(sameNetwork.networkSha256);
    expect(first.licenseSha256).not.toBe(sameNetwork.licenseSha256);
    expect(JSON.stringify(first)).not.toContain('TOP-SECRET-LICENSE');
    expect(JSON.stringify(first)).not.toContain('192.0.2');
  });

  test('canonicalizes whitespace before deriving the per-license rate-limit subject', async () => {
    const request = new Request('https://license.artistos.app');
    const plain = await deriveRequestAuthority(request, { licenseKey: 'LICENSE-1234' });
    const padded = await deriveRequestAuthority(request, { licenseKey: '  LICENSE-1234\n' });
    expect(padded.licenseSha256).toBe(plain.licenseSha256);
  });

  test('enforces network and license dimensions independently', async () => {
    const counts = new Map<string, number>();
    const db = countingD1(counts);
    const authority = { correlationId: crypto.randomUUID(), networkSha256: 'network', licenseSha256: 'license' };
    for (let index = 0; index < 10; index += 1) {
      expect(await consumeRequestLimits(db, 'production', 'activate', authority, 0)).toBe(true);
    }
    expect(await consumeRequestLimits(db, 'production', 'activate', authority, 0)).toBe(false);
    expect(counts.get('network')).toBe(11);
    expect(counts.get('license')).toBe(11);
  });

  test('refuses to strand a historic perpetual signing key', async () => {
    const db = {
      prepare() {
        return {
          bind() { return this; },
          async all() { return { success: true, results: [{ key_id: 'historic', public_key_sha256: 'a'.repeat(64) }] }; },
        };
      },
    } as unknown as D1Database;
    await expect(syncSigningKeyMetadata(db, {
      environment: 'production',
      lemonStoreId: '1', lemonProductId: '2', lemonVariantIdBasicV1: '3', lemonVariantIdPremiumV1: '4',
      lemonApiKey: 'api', lemonWebhookSecret: 'webhook', signingKeyIdCurrent: 'current',
      signingPrivateKeyCurrent: 'private',
      verificationKeysJson: JSON.stringify({ current: { kty: 'OKP', crv: 'Ed25519', x: 'x'.repeat(43) } }),
    })).rejects.toThrow('Historic entitlement verification key is missing');
  });
});

function countingD1(counts: Map<string, number>): D1Database {
  return {
    prepare() {
      let values: unknown[] = [];
      return {
        bind(...next: unknown[]) { values = next; return this; },
        async first() {
          const dimension = String(values[1]);
          const count = (counts.get(dimension) ?? 0) + 1;
          counts.set(dimension, count);
          return { request_count: count };
        },
      };
    },
  } as unknown as D1Database;
}
