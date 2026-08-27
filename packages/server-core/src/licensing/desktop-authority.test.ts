import { describe, expect, test } from 'bun:test';
import { CompactSign, exportJWK, generateKeyPair } from 'jose';
import {
  ARTIST_OS_APP_ID,
  ARTIST_OS_EDITION,
  ARTIST_OS_ISSUER,
  ARTIST_OS_PLAN,
  ARTIST_OS_PRODUCT,
  type ArtistOSEntitlementV1,
} from '@craft-agent/shared/licensing';
import {
  DesktopEntitlementAuthority,
  type DesktopEntitlementAuthorityOptions,
  type DesktopEntitlementServiceClient,
  type DesktopLicenseRecordStore,
  type DesktopLicenseRecordV1,
} from './desktop-authority.ts';

const installationId = '123e4567-e89b-42d3-a456-426614174000';
const entitlementId = '223e4567-e89b-42d3-a456-426614174000';
const activationInstanceId = '323e4567-e89b-42d3-a456-426614174000';
const now = Date.parse('2026-08-22T18:00:00.000Z');

describe('LIC3 desktop entitlement authority', () => {
  test('keeps a valid perpetual entitlement authorized when refresh service is unavailable', async () => {
    const fixture = await createFixture();
    fixture.store.value = await fixture.record();
    const authority = fixture.authority({
      validate: async () => ({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true }),
    });

    expect(await authority.initialize()).toMatchObject({ state: 'REFRESH_DUE', authorized: true });
    expect(await authority.refresh()).toMatchObject({ ok: false, snapshot: { state: 'SERVICE_UNAVAILABLE', authorized: true } });
    expect(fixture.store.value).not.toBeNull();
  });

  test('verifies service authority before storing activation and never exposes secrets in snapshots', async () => {
    const fixture = await createFixture();
    const token = await fixture.sign({ refreshAfter: '2026-09-22T18:00:00.000Z' });
    const authority = fixture.authority({
      activate: async () => ({ ok: true, signedEntitlement: token, maskedEmail: 'w***@example.com', lastFour: '1234', seatLimit: 3, status: 'active', refreshAfter: '2026-09-22T18:00:00.000Z' }),
    });
    await authority.initialize();

    const result = await authority.activate({ schemaVersion: 1, email: 'writer@example.com', licenseKey: 'LICENSE-KEY-1234' });
    expect(result).toMatchObject({ ok: true, snapshot: { state: 'ACTIVE', authorized: true, maskedEmail: 'w***@example.com', licenseLastFour: '1234' } });
    expect(JSON.stringify(result)).not.toContain('LICENSE-KEY');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(fixture.store.value).toMatchObject({ licenseKey: 'LICENSE-KEY-1234', signedEntitlement: token });
  });

  test('quarantines an invalid protected record instead of replacing it', async () => {
    const fixture = await createFixture();
    fixture.store.value = { schemaVersion: 1, licenseKey: 'secret' };
    const authority = fixture.authority();

    expect(await authority.initialize()).toMatchObject({ state: 'CORRUPT', authorized: false });
    expect(fixture.store.quarantined).toBe(1);
    expect(fixture.store.removed).toBe(0);
  });

  test('durably records terminal revocation before denying paid execution', async () => {
    const fixture = await createFixture();
    fixture.store.value = await fixture.record();
    let writeFinished = false;
    fixture.store.beforeWrite = async () => { await Promise.resolve(); writeFinished = true; };
    const authority = fixture.authority({
      validate: async () => ({ ok: false, code: 'LICENSE_DISABLED', retryable: false }),
    });
    await authority.initialize();

    const result = await authority.refresh();
    expect(writeFinished).toBe(true);
    expect(result).toMatchObject({ ok: false, snapshot: { state: 'REVOKED', authorized: false } });
    expect(fixture.store.value).toMatchObject({ revocationCode: 'LICENSE_DISABLED' });
  });

  test('coalesces concurrent activation commands into one service request', async () => {
    const fixture = await createFixture();
    const token = await fixture.sign({ refreshAfter: '2026-09-22T18:00:00.000Z' });
    let calls = 0;
    const authority = fixture.authority({
      activate: async () => {
        calls += 1;
        await Promise.resolve();
        return { ok: true, signedEntitlement: token, maskedEmail: 'w***@example.com', lastFour: '1234', seatLimit: 3, status: 'active', refreshAfter: '2026-09-22T18:00:00.000Z' };
      },
    });
    await authority.initialize();
    const input = { schemaVersion: 1 as const, email: 'writer@example.com', licenseKey: 'LICENSE-KEY-1234' };

    await Promise.all([authority.activate(input), authority.activate(input)]);
    expect(calls).toBe(1);
  });

  test('does not coalesce a different activation request into the active command', async () => {
    const fixture = await createFixture();
    const token = await fixture.sign({ refreshAfter: '2026-09-22T18:00:00.000Z' });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const authority = fixture.authority({
      activate: async () => {
        await blocked;
        return { ok: true, signedEntitlement: token, maskedEmail: 'w***@example.com', lastFour: '1234', seatLimit: 3, status: 'active', refreshAfter: '2026-09-22T18:00:00.000Z' };
      },
    });
    await authority.initialize();
    const first = authority.activate({ schemaVersion: 1, email: 'writer@example.com', licenseKey: 'LICENSE-KEY-1234' });
    const second = await authority.activate({ schemaVersion: 1, email: 'other@example.com', licenseKey: 'DIFFERENT-KEY-9999' });
    release();
    await first;
    expect(second.ok).toBe(false);
  });

  test('retains the prior offline authority when a refresh token is malformed', async () => {
    const fixture = await createFixture();
    fixture.store.value = await fixture.record();
    const authority = fixture.authority({
      validate: async () => ({ ok: true, signedEntitlement: 'not-a-jws', maskedEmail: 'w***@example.com', lastFour: '1234', seatLimit: 3, status: 'active', refreshAfter: '2026-09-22T18:00:00.000Z' }),
    });
    await authority.initialize();
    expect(await authority.refresh()).toMatchObject({ ok: false, snapshot: { state: 'SERVICE_UNAVAILABLE', authorized: true } });
    expect(fixture.store.value).toMatchObject({ signedEntitlement: expect.stringContaining('.') });
  });
});

async function createFixture() {
  const keys = await generateKeyPair('Ed25519');
  const publicJwk = await exportJWK(keys.publicKey);
  const store = new MemoryRecordStore();
  const sign = async (overrides: Partial<ArtistOSEntitlementV1> = {}) => {
    const entitlement: ArtistOSEntitlementV1 = {
      schemaVersion: 1,
      issuer: ARTIST_OS_ISSUER,
      audience: ARTIST_OS_APP_ID,
      entitlementId,
      vendor: 'lemon-squeezy',
      vendorLicenseId: '1234',
      product: ARTIST_OS_PRODUCT,
      edition: ARTIST_OS_EDITION,
      plan: ARTIST_OS_PLAN,
      majorVersion: 1,
      distributionChannel: 'direct',
      installationId,
      activationInstanceId,
      seatLimit: 3,
      status: 'active',
      issuedAt: '2026-08-22T17:00:00.000Z',
      lastValidatedAt: '2026-08-22T17:00:00.000Z',
      refreshAfter: '2026-08-22T17:30:00.000Z',
      ...overrides,
    };
    return new CompactSign(new TextEncoder().encode(JSON.stringify(entitlement)))
      .setProtectedHeader({ alg: 'EdDSA', typ: 'ARTIST_OS-ENTITLEMENT', kid: 'test-key' })
      .sign(keys.privateKey);
  };
  const record = async (): Promise<DesktopLicenseRecordV1> => ({
    schemaVersion: 1,
    installationId,
    purchaseEmail: 'writer@example.com',
    licenseKey: 'LICENSE-KEY-1234',
    signedEntitlement: await sign(),
    maskedEmail: 'w***@example.com',
    licenseLastFour: '1234',
    revokedAt: null,
    revocationCode: null,
  });
  const authority = (overrides: Partial<DesktopEntitlementServiceClient> = {}) => {
    const service: DesktopEntitlementServiceClient = {
      activate: async () => ({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true }),
      validate: async () => ({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true }),
      deactivate: async () => ({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true }),
      ...overrides,
    };
    const options: DesktopEntitlementAuthorityOptions = {
      packaged: true,
      appVersion: '1.0.0',
      architecture: 'arm64',
      keyring: { 'test-key': publicJwk },
      installationStore: { getOrCreate: async () => installationId },
      recordStore: store,
      service,
      now: () => now,
      randomUuid: () => '423e4567-e89b-42d3-a456-426614174000',
    };
    return new DesktopEntitlementAuthority(options);
  };
  return { authority, record, sign, store };
}

class MemoryRecordStore implements DesktopLicenseRecordStore {
  value: unknown | null = null;
  quarantined = 0;
  removed = 0;
  beforeWrite: (() => Promise<void>) | null = null;
  async read() { return structuredClone(this.value); }
  async write(record: DesktopLicenseRecordV1) {
    await this.beforeWrite?.();
    this.value = structuredClone(record);
  }
  async remove() { this.removed += 1; this.value = null; }
  async quarantine() { this.quarantined += 1; }
}
