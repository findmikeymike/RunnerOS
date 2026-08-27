export const ARTIST_OS_LICENSE_SCHEMA_VERSION = 1 as const;
export const ARTIST_OS_APP_ID = 'com.findmikeymike.artistos' as const;
export const ARTIST_OS_PRODUCT = 'artist-os' as const;
export const ARTIST_OS_BASIC_EDITION = 'basic' as const;
export const ARTIST_OS_PREMIUM_EDITION = 'premium' as const;
export const ARTIST_OS_BASIC_PLAN = 'perpetual-basic-v1' as const;
export const ARTIST_OS_PREMIUM_PLAN = 'perpetual-premium-v1' as const;
export const ARTIST_OS_EDITION = ARTIST_OS_PREMIUM_EDITION;
export const ARTIST_OS_PLAN = ARTIST_OS_PREMIUM_PLAN;
export const ARTIST_OS_ISSUER = 'https://license.artistos.app' as const;
export const ARTIST_OS_SEAT_LIMIT = 3 as const;
export const ARTIST_OS_ENTITLEMENT_TYP = 'ARTIST_OS-ENTITLEMENT' as const;
export const ARTIST_OS_ENTITLEMENT_MAX_BYTES = 16 * 1024;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const VENDOR_LICENSE_ID = /^[1-9]\d{0,19}$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type ArtistOSDistributionChannel = 'direct' | 'mac-app-store' | 'development';
export type ArtistOSEntitlementStatus = 'active' | 'revoked';
export type ArtistOSEdition = typeof ARTIST_OS_BASIC_EDITION | typeof ARTIST_OS_PREMIUM_EDITION;
export type ArtistOSPlan = typeof ARTIST_OS_BASIC_PLAN | typeof ARTIST_OS_PREMIUM_PLAN;

export function planForArtistOSEdition(edition: ArtistOSEdition): ArtistOSPlan {
  return edition === ARTIST_OS_BASIC_EDITION ? ARTIST_OS_BASIC_PLAN : ARTIST_OS_PREMIUM_PLAN;
}

export interface ArtistOSProductIdentityV1 {
  schemaVersion: 1;
  appId: typeof ARTIST_OS_APP_ID;
  product: typeof ARTIST_OS_PRODUCT;
  edition: ArtistOSEdition;
  majorVersion: 1;
  distributionChannel: ArtistOSDistributionChannel;
}

export interface ArtistOSEntitlementV1 {
  schemaVersion: 1;
  issuer: typeof ARTIST_OS_ISSUER;
  audience: typeof ARTIST_OS_APP_ID;
  entitlementId: string;
  vendor: 'lemon-squeezy';
  vendorLicenseId: string;
  product: typeof ARTIST_OS_PRODUCT;
  edition: ArtistOSEdition;
  plan: ArtistOSPlan;
  majorVersion: 1;
  distributionChannel: 'direct';
  installationId: string;
  activationInstanceId: string;
  seatLimit: 3;
  status: ArtistOSEntitlementStatus;
  issuedAt: string;
  lastValidatedAt: string;
  refreshAfter: string;
}

export interface ArtistOSEntitlementBinding {
  installationId: string;
  appId: typeof ARTIST_OS_APP_ID;
  product: typeof ARTIST_OS_PRODUCT;
  majorVersion: 1;
  distributionChannel: 'direct';
}

export type ArtistOSEntitlementValidationCode =
  | 'INVALID_PAYLOAD'
  | 'WRONG_AUTHORITY'
  | 'WRONG_PRODUCT'
  | 'WRONG_CHANNEL'
  | 'WRONG_INSTALLATION'
  | 'INVALID_TIME';

export type ArtistOSEntitlementValidationResult =
  | { ok: true; entitlement: ArtistOSEntitlementV1 }
  | { ok: false; code: ArtistOSEntitlementValidationCode };

export interface ActivateEntitlementRequestV1 {
  schemaVersion: 1;
  email: string;
  licenseKey: string;
  installationId: string;
  appVersion: string;
  platform: 'macos';
  architecture: 'arm64' | 'x64';
  requestId: string;
}

export interface ValidateEntitlementRequestV1 extends ActivateEntitlementRequestV1 {
  activationInstanceId: string;
  signedEntitlement: string;
}

export type EntitlementFailureCode =
  | 'INVALID_REQUEST'
  | 'INVALID_LICENSE'
  | 'EMAIL_MISMATCH'
  | 'WRONG_PRODUCT'
  | 'SEAT_LIMIT_REACHED'
  | 'LICENSE_EXPIRED'
  | 'LICENSE_DISABLED'
  | 'INSTANCE_NOT_FOUND'
  | 'SERVICE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

const ENTITLEMENT_KEYS = [
  'activationInstanceId',
  'audience',
  'distributionChannel',
  'edition',
  'entitlementId',
  'installationId',
  'issuedAt',
  'issuer',
  'lastValidatedAt',
  'majorVersion',
  'plan',
  'product',
  'refreshAfter',
  'schemaVersion',
  'seatLimit',
  'status',
  'vendor',
  'vendorLicenseId',
] as const;

export function validateArtistOSEntitlement(
  input: unknown,
  binding: ArtistOSEntitlementBinding,
  nowMs = Date.now(),
): ArtistOSEntitlementValidationResult {
  if (!isExactRecord(input, ENTITLEMENT_KEYS)) return { ok: false, code: 'INVALID_PAYLOAD' };
  if (
    input.schemaVersion !== ARTIST_OS_LICENSE_SCHEMA_VERSION
    || input.issuer !== ARTIST_OS_ISSUER
    || input.audience !== binding.appId
  ) return { ok: false, code: 'WRONG_AUTHORITY' };
  if (
    input.product !== binding.product
    || !isArtistOSEdition(input.edition)
    || input.plan !== planForArtistOSEdition(input.edition)
    || input.majorVersion !== binding.majorVersion
  ) return { ok: false, code: 'WRONG_PRODUCT' };
  if (input.distributionChannel !== binding.distributionChannel) {
    return { ok: false, code: 'WRONG_CHANNEL' };
  }
  if (input.installationId !== binding.installationId) {
    return { ok: false, code: 'WRONG_INSTALLATION' };
  }
  if (
    !isUuidV4(input.entitlementId)
    || input.vendor !== 'lemon-squeezy'
    || typeof input.vendorLicenseId !== 'string'
    || !VENDOR_LICENSE_ID.test(input.vendorLicenseId)
    || !isUuid(input.activationInstanceId)
    || input.seatLimit !== ARTIST_OS_SEAT_LIMIT
    || (input.status !== 'active' && input.status !== 'revoked')
  ) return { ok: false, code: 'INVALID_PAYLOAD' };

  const issuedAt = parseStrictUtc(input.issuedAt);
  const lastValidatedAt = parseStrictUtc(input.lastValidatedAt);
  const refreshAfter = parseStrictUtc(input.refreshAfter);
  if (
    issuedAt === null
    || lastValidatedAt === null
    || refreshAfter === null
    || lastValidatedAt > issuedAt
    || issuedAt > refreshAfter
    || issuedAt > nowMs + 5 * 60_000
  ) return { ok: false, code: 'INVALID_TIME' };

  return { ok: true, entitlement: input as unknown as ArtistOSEntitlementV1 };
}

export function validateActivateEntitlementRequest(input: unknown): input is ActivateEntitlementRequestV1 {
  const keys = ['appVersion', 'architecture', 'email', 'installationId', 'licenseKey', 'platform', 'requestId', 'schemaVersion'] as const;
  if (!isExactRecord(input, keys)) return false;
  return input.schemaVersion === 1
    && typeof input.email === 'string'
    && input.email.length >= 3
    && input.email.length <= 320
    && input.email === input.email.trim()
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
    && typeof input.licenseKey === 'string'
    && input.licenseKey.length >= 8
    && input.licenseKey.length <= 256
    && isUuidV4(input.installationId)
    && typeof input.appVersion === 'string'
    && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?$/.test(input.appVersion)
    && input.platform === 'macos'
    && (input.architecture === 'arm64' || input.architecture === 'x64')
    && typeof input.requestId === 'string'
    && REQUEST_ID.test(input.requestId);
}

export function validateValidateEntitlementRequest(input: unknown): input is ValidateEntitlementRequestV1 {
  const keys = [
    'activationInstanceId',
    'appVersion',
    'architecture',
    'email',
    'installationId',
    'licenseKey',
    'platform',
    'requestId',
    'schemaVersion',
    'signedEntitlement',
  ] as const;
  if (!isExactRecord(input, keys)) return false;
  return validateActivateEntitlementRequest({
    schemaVersion: input.schemaVersion,
    email: input.email,
    licenseKey: input.licenseKey,
    installationId: input.installationId,
    appVersion: input.appVersion,
    platform: input.platform,
    architecture: input.architecture,
    requestId: input.requestId,
  })
    && isUuid(input.activationInstanceId)
    && typeof input.signedEntitlement === 'string'
    && input.signedEntitlement.length > 0
    && new TextEncoder().encode(input.signedEntitlement).byteLength <= ARTIST_OS_ENTITLEMENT_MAX_BYTES;
}

export function isArtistOSKeyId(value: unknown): value is string {
  return typeof value === 'string' && KEY_ID.test(value);
}

export function isArtistOSEdition(value: unknown): value is ArtistOSEdition {
  return value === ARTIST_OS_BASIC_EDITION || value === ARTIST_OS_PREMIUM_EDITION;
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseStrictUtc(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  return new Date(parsed).toISOString() === normalized ? parsed : null;
}

function isExactRecord<const T extends readonly string[]>(
  input: unknown,
  keys: T,
): input is Record<T[number], unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const actual = Object.keys(input as Record<string, unknown>).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
