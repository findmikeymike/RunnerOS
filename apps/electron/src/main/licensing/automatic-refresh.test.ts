import { describe, expect, test } from 'bun:test';
import type { ArtistOSLicenseSnapshotV1 } from '@craft-agent/shared/licensing';
import { AUTOMATIC_LICENSE_REFRESH_BACKOFF_MS, shouldAutomaticallyRefreshLicense } from './automatic-refresh';

const due: ArtistOSLicenseSnapshotV1 = {
  schemaVersion: 1,
  state: 'REFRESH_DUE',
  authorized: true,
  development: false,
  maskedEmail: 'w***@example.com',
  licenseLastFour: '1234',
  edition: 'premium',
  plan: 'perpetual-premium-v1',
  seatLimit: 3,
  lastValidatedAt: '2026-08-21T00:00:00.000Z',
  refreshAfter: '2026-08-22T00:00:00.000Z',
  safeMessage: null,
};

describe('automatic desktop license refresh', () => {
  test('runs only for an authorized due production entitlement', () => {
    const now = Date.parse('2026-08-22T01:00:00.000Z');
    expect(shouldAutomaticallyRefreshLicense(due, null, now)).toBe(true);
    expect(shouldAutomaticallyRefreshLicense({ ...due, authorized: false }, null, now)).toBe(false);
    expect(shouldAutomaticallyRefreshLicense({ ...due, development: true }, null, now)).toBe(false);
    expect(shouldAutomaticallyRefreshLicense({ ...due, refreshAfter: '2026-08-23T00:00:00.000Z' }, null, now)).toBe(false);
  });

  test('backs off repeated startup and resume attempts for at least six hours', () => {
    const now = Date.parse('2026-08-22T07:00:00.000Z');
    expect(shouldAutomaticallyRefreshLicense(due, now - AUTOMATIC_LICENSE_REFRESH_BACKOFF_MS + 1, now)).toBe(false);
    expect(shouldAutomaticallyRefreshLicense(due, now - AUTOMATIC_LICENSE_REFRESH_BACKOFF_MS, now)).toBe(true);
  });
});
