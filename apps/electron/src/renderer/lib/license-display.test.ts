import { describe, expect, test } from 'bun:test';
import type { ArtistOSLicenseSnapshotV1 } from '@craft-agent/shared/licensing';
import { describeLicense, shouldOpenFirstRunActivation } from './license-display';

const base: ArtistOSLicenseSnapshotV1 = {
  schemaVersion: 1,
  state: 'UNLICENSED',
  authorized: false,
  development: false,
  maskedEmail: null,
  licenseLastFour: null,
  edition: null,
  plan: null,
  seatLimit: null,
  lastValidatedAt: null,
  refreshAfter: null,
  safeMessage: null,
};

describe('Artist OS license display copy', () => {
  test('shows the securely issued edition without embedding a price', () => {
    expect(describeLicense({ ...base, state: 'ACTIVE', authorized: true, edition: 'basic', plan: 'perpetual-basic-v1' }).title).toBe('Artist OS Basic');
    expect(describeLicense({ ...base, state: 'ACTIVE', authorized: true, edition: 'premium', plan: 'perpetual-premium-v1' }).title).toBe('Artist OS Premium');
  });

  test('preserves lifetime offline access during service downtime', () => {
    const display = describeLicense({ ...base, state: 'SERVICE_UNAVAILABLE', authorized: true });
    expect(display.title).toContain('offline');
    expect(display.detail).toContain('remains active');
  });

  test('keeps files readable and exportable after revocation', () => {
    expect(describeLicense({ ...base, state: 'REVOKED' }).detail).toContain('readable and exportable');
  });

  test('opens activation once for an unlicensed production install', () => {
    expect(shouldOpenFirstRunActivation(base, false)).toBe(true);
    expect(shouldOpenFirstRunActivation(base, true)).toBe(false);
    expect(shouldOpenFirstRunActivation({ ...base, development: true, authorized: true }, false)).toBe(false);
  });
});
