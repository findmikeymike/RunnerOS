import {
  ARTIST_OS_ENTITLEMENT_TYP,
  isArtistOSKeyId,
  validateArtistOSEntitlement,
  type ArtistOSEntitlementBinding,
  type ArtistOSEntitlementV1,
} from '@craft-agent/shared/licensing';
import { CompactSign, type CryptoKey, type JWK, type KeyObject } from 'jose';

export type EntitlementSigningKey = CryptoKey | KeyObject | JWK | Uint8Array;

export async function signArtistOSEntitlement(
  entitlement: ArtistOSEntitlementV1,
  keyId: string,
  privateKey: EntitlementSigningKey,
  nowMs = Date.now(),
): Promise<string> {
  if (!isArtistOSKeyId(keyId)) throw new Error('Invalid entitlement signing key ID');
  const binding: ArtistOSEntitlementBinding = {
    installationId: entitlement.installationId,
    appId: entitlement.audience,
    product: entitlement.product,
    majorVersion: entitlement.majorVersion,
    distributionChannel: entitlement.distributionChannel,
  };
  const validated = validateArtistOSEntitlement(entitlement, binding, nowMs);
  if (!validated.ok) throw new Error(`Invalid entitlement payload: ${validated.code}`);
  return new CompactSign(new TextEncoder().encode(JSON.stringify(validated.entitlement)))
    .setProtectedHeader({ alg: 'EdDSA', kid: keyId, typ: ARTIST_OS_ENTITLEMENT_TYP })
    .sign(privateKey);
}
