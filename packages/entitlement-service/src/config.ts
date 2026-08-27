export interface EntitlementServiceConfigV1 {
  environment: 'test' | 'production';
  lemonStoreId: string;
  lemonProductId: string;
  lemonVariantIdBasicV1: string | null;
  lemonVariantIdPremiumV1: string;
  lemonApiKey: string;
  lemonWebhookSecret: string;
  signingKeyIdCurrent: string;
  signingPrivateKeyCurrent: string;
  verificationKeysJson: string;
}

export type EntitlementServiceConfigResult =
  | { ok: true; config: EntitlementServiceConfigV1 }
  | { ok: false; missing: string[] };

const REQUIRED = [
  'ARTIST_OS_LICENSE_ENVIRONMENT',
  'LEMON_STORE_ID',
  'LEMON_PRODUCT_ID',
  'LEMON_VARIANT_ID_BASIC_V1',
  'LEMON_VARIANT_ID_PREMIUM_V1',
  'LEMON_API_KEY',
  'LEMON_WEBHOOK_SECRET',
  'ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT',
  'ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT',
  'ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON',
] as const;

export function readEntitlementServiceConfig(
  env: Readonly<Record<string, string | undefined>>,
): EntitlementServiceConfigResult {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());
  if (missing.length > 0) return { ok: false, missing: [...missing] };
  const environment = env.ARTIST_OS_LICENSE_ENVIRONMENT;
  if (environment !== 'test' && environment !== 'production') {
    return { ok: false, missing: ['ARTIST_OS_LICENSE_ENVIRONMENT(test|production)'] };
  }
  if (![env.LEMON_STORE_ID, env.LEMON_PRODUCT_ID, env.LEMON_VARIANT_ID_PREMIUM_V1].every(isPositiveId)) {
    return { ok: false, missing: ['LEMON_STORE_ID, LEMON_PRODUCT_ID, and LEMON_VARIANT_ID_PREMIUM_V1(positive integers)'] };
  }
  const basicVariantId = env.LEMON_VARIANT_ID_BASIC_V1!.trim();
  if (basicVariantId !== 'disabled' && !isPositiveId(basicVariantId)) {
    return { ok: false, missing: ['LEMON_VARIANT_ID_BASIC_V1(positive integer|disabled)'] };
  }
  if (basicVariantId !== 'disabled' && basicVariantId === env.LEMON_VARIANT_ID_PREMIUM_V1) {
    return { ok: false, missing: ['LEMON_VARIANT_ID_*(distinct Basic and Premium variants)'] };
  }
  try {
    const keys: unknown = JSON.parse(env.ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON!);
    if (!isVerificationKeyMap(keys)) {
      return { ok: false, missing: ['ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON(public Ed25519 JWK map)'] };
    }
    if (!Object.prototype.hasOwnProperty.call(keys, env.ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT!)) {
      return { ok: false, missing: ['ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT(present in verification map)'] };
    }
  } catch {
    return { ok: false, missing: ['ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON(valid JSON)'] };
  }
  return {
    ok: true,
    config: {
      environment,
      lemonStoreId: env.LEMON_STORE_ID!,
      lemonProductId: env.LEMON_PRODUCT_ID!,
      lemonVariantIdBasicV1: basicVariantId === 'disabled' ? null : basicVariantId,
      lemonVariantIdPremiumV1: env.LEMON_VARIANT_ID_PREMIUM_V1!,
      lemonApiKey: env.LEMON_API_KEY!,
      lemonWebhookSecret: env.LEMON_WEBHOOK_SECRET!,
      signingKeyIdCurrent: env.ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT!,
      signingPrivateKeyCurrent: env.ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT!,
      verificationKeysJson: env.ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON!,
    },
  };
}

function isPositiveId(value: string | undefined): boolean {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

interface PublicEd25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
}

function isVerificationKeyMap(input: unknown): input is Record<string, PublicEd25519Jwk> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const entries = Object.entries(input as Record<string, unknown>);
  return entries.length > 0 && entries.every(([keyId, value]) => (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)
    && isPublicEd25519Jwk(value)
  ));
}

function isPublicEd25519Jwk(input: unknown): input is PublicEd25519Jwk {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return Object.keys(record).sort().join(',') === 'crv,kty,x'
    && record.kty === 'OKP'
    && record.crv === 'Ed25519'
    && typeof record.x === 'string'
    && /^[A-Za-z0-9_-]{43}$/.test(record.x);
}
