import type { EntitlementDecision } from "./voicecore-entitlement.mjs";

export const VOICECORE_SESSION_HEADER: string;
export const VOICECORE_SESSION_QUERY_PARAM: string;
export const DEFAULT_SESSION_TTL_SECONDS: number;
export const MIN_SESSION_TTL_SECONDS: number;
export const MAX_SESSION_TTL_SECONDS: number;
export const DEFAULT_REQUIRED_SCOPE: string;
export const SESSION_TOKEN_TYPE: string;

export type VoiceCoreSessionClaims = Readonly<{
  typ: string;
  sub: string;
  aud: string;
  scope: readonly string[];
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
  license_id: string;
  customer_id: string;
  workspace_id: string | null;
  app_version: string | null;
}>;

export function issueVoiceCoreSessionToken(args: {
  secret: string;
  keyId: string;
  entitlementDecision: EntitlementDecision;
  appVersion?: string;
  scope?: string[];
  audience?: string;
  ttlSeconds?: number;
  nowSeconds?: number;
  tokenId?: string;
}): { token: string; claims: VoiceCoreSessionClaims };

export function verifyVoiceCoreSessionToken(args: {
  token: string | null;
  keys: Record<string, string>;
  requiredScope?: string;
  expectedAudience?: string;
  nowSeconds?: number;
  isRevoked?: (identity: Readonly<{ token_id: string; license_id: string; subject: string }>) => boolean;
}): { ok: true; claims: VoiceCoreSessionClaims } | { ok: false; reason: string };

export function isVerifiedVoiceCoreSessionClaims(claims: unknown): claims is VoiceCoreSessionClaims;
export function buildVoiceCoreSessionKeyring(args: {
  currentKeyId: string;
  currentSecret: string;
  previousKeysJson?: string;
}): Readonly<Record<string, string>>;
export function validateVoiceCoreSessionKeys(keys: Readonly<Record<string, string>>): Readonly<Record<string, string>>;
export function clampVoiceCoreSessionTtl(value: unknown): number;
export function readVoiceCoreSessionHeader(headers: Record<string, string | string[] | undefined>): string | null;
export function readVoiceCoreSessionQuery(urlString: string | undefined): string | null;
export function buildVoiceCoreSessionResponse(args: Parameters<typeof issueVoiceCoreSessionToken>[0]): Readonly<{
  session_token: string;
  expires_at: string;
  expires_in_seconds: number;
}>;
export function parseJsonRecord(text: string | undefined): Record<string, unknown>;
export function isTruthy(value: string | undefined): boolean;
