import type { ArtistOSEdition, ArtistOSPlan } from './contract.ts';

export type ArtistOSLicenseState =
  | 'UNLICENSED'
  | 'ACTIVATING'
  | 'ACTIVE'
  | 'REFRESH_DUE'
  | 'SERVICE_UNAVAILABLE'
  | 'SEAT_LIMIT_REACHED'
  | 'REVOKED'
  | 'CORRUPT';

export interface ArtistOSLicenseSnapshotV1 {
  schemaVersion: 1;
  state: ArtistOSLicenseState;
  authorized: boolean;
  development: boolean;
  maskedEmail: string | null;
  licenseLastFour: string | null;
  edition: ArtistOSEdition | null;
  plan: ArtistOSPlan | null;
  seatLimit: 3 | null;
  lastValidatedAt: string | null;
  refreshAfter: string | null;
  safeMessage: string | null;
}

export interface ArtistOSActivateInputV1 {
  schemaVersion: 1;
  email: string;
  licenseKey: string;
}

export type ArtistOSLicenseLinkKind = 'buy' | 'recover' | 'manage' | 'support' | 'privacy';

export type ArtistOSLicenseCommandResultV1 =
  | { ok: true; snapshot: ArtistOSLicenseSnapshotV1 }
  | { ok: false; snapshot: ArtistOSLicenseSnapshotV1 };

export function validateArtistOSActivateInput(input: unknown): input is ArtistOSActivateInputV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join('\0') !== ['email', 'licenseKey', 'schemaVersion'].join('\0')) return false;
  return record.schemaVersion === 1
    && typeof record.email === 'string'
    && record.email === record.email.trim()
    && record.email.length >= 3
    && record.email.length <= 320
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)
    && typeof record.licenseKey === 'string'
    && record.licenseKey === record.licenseKey.trim()
    && record.licenseKey.length >= 8
    && record.licenseKey.length <= 256;
}
