import {
  CompactSign,
  compactVerify,
  importJWK,
  importPKCS8,
  type CryptoKey,
  type JWK,
  type KeyObject,
} from 'jose';
import type { EntitlementServiceConfigV1 } from './config.ts';

export type LoadedVerificationKey = CryptoKey | KeyObject | JWK | Uint8Array;

export interface EntitlementSigningMaterial {
  currentKeyId: string;
  currentPrivateKey: CryptoKey;
  verificationKeyring: Readonly<Record<string, LoadedVerificationKey>>;
}

export async function loadEntitlementSigningMaterial(
  config: EntitlementServiceConfigV1,
): Promise<EntitlementSigningMaterial> {
  const parsed = JSON.parse(config.verificationKeysJson) as Record<string, JWK>;
  const currentPublicJwk = parsed[config.signingKeyIdCurrent];
  if (!currentPublicJwk) throw new Error('Current entitlement verification key is missing');

  const currentPrivateKey = await importPKCS8(config.signingPrivateKeyCurrent, 'EdDSA');
  const entries = await Promise.all(Object.entries(parsed).map(async ([keyId, jwk]) => (
    [keyId, await importJWK(jwk, 'EdDSA')] as const
  )));
  const verificationKeyring = Object.freeze(Object.fromEntries(entries));
  const challenge = new TextEncoder().encode('artistos-entitlement-key-match-v1');
  const proof = await new CompactSign(challenge)
    .setProtectedHeader({ alg: 'EdDSA', kid: config.signingKeyIdCurrent })
    .sign(currentPrivateKey);
  try {
    await compactVerify(proof, verificationKeyring[config.signingKeyIdCurrent]!, { algorithms: ['EdDSA'] });
  } catch {
    throw new Error('Current entitlement signing key does not match its public key');
  }
  return {
    currentKeyId: config.signingKeyIdCurrent,
    currentPrivateKey,
    verificationKeyring,
  };
}

export async function entitlementVerificationKeyringFingerprint(verificationKeysJson: string): Promise<string> {
  const parsed = JSON.parse(verificationKeysJson) as Record<string, JWK>;
  const canonical = JSON.stringify(Object.fromEntries(
    Object.entries(parsed)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyId, jwk]) => [keyId, Object.fromEntries(Object.entries(jwk).sort(([left], [right]) => left.localeCompare(right)))]),
  ));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
