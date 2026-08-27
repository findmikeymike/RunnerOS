import {
  ARTIST_OS_ENTITLEMENT_MAX_BYTES,
  ARTIST_OS_ENTITLEMENT_TYP,
  isArtistOSKeyId,
  validateArtistOSEntitlement,
  type ArtistOSEntitlementBinding,
  type ArtistOSEntitlementV1,
  type ArtistOSEntitlementValidationCode,
} from '@craft-agent/shared/licensing';
import {
  compactVerify,
  decodeProtectedHeader,
  type CryptoKey,
  type JWK,
  type KeyObject,
} from 'jose';

export type ArtistOSEntitlementVerificationCode =
  | 'MALFORMED_TOKEN'
  | 'UNSUPPORTED_KEY'
  | 'INVALID_SIGNATURE'
  | ArtistOSEntitlementValidationCode;

export type ArtistOSEntitlementVerificationResult =
  | { ok: true; entitlement: ArtistOSEntitlementV1; keyId: string }
  | { ok: false; code: ArtistOSEntitlementVerificationCode };

export type ArtistOSEntitlementVerificationKey = CryptoKey | KeyObject | JWK | Uint8Array;
export type ArtistOSEntitlementKeyring = Readonly<Record<string, ArtistOSEntitlementVerificationKey>>;

export async function verifyArtistOSEntitlementToken(
  token: unknown,
  keyring: ArtistOSEntitlementKeyring,
  binding: ArtistOSEntitlementBinding,
  nowMs = Date.now(),
): Promise<ArtistOSEntitlementVerificationResult> {
  if (
    typeof token !== 'string'
    || new TextEncoder().encode(token).byteLength > ARTIST_OS_ENTITLEMENT_MAX_BYTES
    || token.split('.').length !== 3
  ) return { ok: false, code: 'MALFORMED_TOKEN' };

  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    return { ok: false, code: 'MALFORMED_TOKEN' };
  }

  const headerKeys = Object.keys(header).sort().join(',');
  if (
    headerKeys !== 'alg,kid,typ'
    || header.alg !== 'EdDSA'
    || header.typ !== ARTIST_OS_ENTITLEMENT_TYP
    || !isArtistOSKeyId(header.kid)
  ) return { ok: false, code: 'MALFORMED_TOKEN' };

  if (!Object.prototype.hasOwnProperty.call(keyring, header.kid)) {
    return { ok: false, code: 'UNSUPPORTED_KEY' };
  }

  let payloadBytes: Uint8Array;
  try {
    const verified = await compactVerify(token, keyring[header.kid]!, { algorithms: ['EdDSA'] });
    payloadBytes = verified.payload;
  } catch {
    return { ok: false, code: 'INVALID_SIGNATURE' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
  } catch {
    return { ok: false, code: 'MALFORMED_TOKEN' };
  }

  const validated = validateArtistOSEntitlement(payload, binding, nowMs);
  if (!validated.ok) return validated;
  return { ok: true, entitlement: validated.entitlement, keyId: header.kid };
}
