import type { ArtistOSLicenseSnapshotV1 } from '@craft-agent/shared/licensing';

export const AUTOMATIC_LICENSE_REFRESH_BACKOFF_MS = 6 * 60 * 60_000;

export function shouldAutomaticallyRefreshLicense(
  snapshot: ArtistOSLicenseSnapshotV1,
  lastAttemptAt: number | null,
  now = Date.now(),
): boolean {
  if (snapshot.development || !snapshot.authorized || snapshot.refreshAfter === null) return false;
  const refreshAfter = Date.parse(snapshot.refreshAfter);
  if (!Number.isFinite(refreshAfter) || refreshAfter > now) return false;
  return lastAttemptAt === null || now - lastAttemptAt >= AUTOMATIC_LICENSE_REFRESH_BACKOFF_MS;
}
