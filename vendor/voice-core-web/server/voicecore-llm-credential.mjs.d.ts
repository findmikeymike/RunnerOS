export const LLM_CREDENTIAL_SCHEMA_VERSION: 1;
export const LLM_GATEWAY_TOKEN_TYPE: "voicecore_llm_gateway_v1";
export const LLM_GATEWAY_SCOPE: "voicecore:llm";
export const DEFAULT_LLM_CREDENTIAL_TTL_SECONDS: number;
export const MIN_LLM_CREDENTIAL_TTL_SECONDS: number;
export const MAX_LLM_CREDENTIAL_TTL_SECONDS: number;

export type LlmGatewayProvider =
  | "openai"
  | "together_ai"
  | "groq"
  | "openrouter"
  | "custom";

export type LlmGatewayCredentialClaims = Readonly<{
  typ: "voicecore_llm_gateway_v1";
  sub: string;
  aud: string;
  scope: readonly ["voicecore:llm"];
  provider: LlmGatewayProvider;
  model: string;
  iat: number;
  exp: number;
  jti: string;
  license_id: string;
  customer_id: string;
  workspace_id?: string;
}>;

declare const verifiedClaimsBrand: unique symbol;
export type VerifiedLlmGatewayCredentialClaims = LlmGatewayCredentialClaims & Readonly<{
  [verifiedClaimsBrand]: true;
}>;

export type LlmGatewayCredentialLease = Readonly<{
  schema_version: 1;
  credential_kind: "gateway_session";
  runtime_provider: "custom";
  upstream_provider: LlmGatewayProvider;
  api_base: string;
  model: string;
  auth_token: string;
  issued_at: string;
  expires_at: string;
  refresh_after: string;
  expires_in_seconds: number;
}>;

export function issueLlmGatewayCredential(args: {
  secret: string;
  entitlementDecision: EntitlementDecision;
  upstreamProvider: LlmGatewayProvider;
  model: string;
  gatewayApiBase: string;
  ttlSeconds?: number;
  nowSeconds?: number;
  tokenId?: string;
  allowInsecureLoopback?: boolean;
}): {
  lease: LlmGatewayCredentialLease;
  claims: LlmGatewayCredentialClaims;
};

export function verifyLlmGatewayCredential(args: {
  token: string;
  secret: string;
  expectedAudience: string;
  expectedProvider?: LlmGatewayProvider;
  expectedModel?: string;
  nowSeconds?: number;
  allowInsecureLoopback?: boolean;
}):
  | { ok: true; claims: VerifiedLlmGatewayCredentialClaims }
  | { ok: false; reason: string };

export function verifyLlmGatewayRequestBinding(args: {
  claims: VerifiedLlmGatewayCredentialClaims;
  requestBody: Record<string, unknown>;
}): { ok: true } | { ok: false; reason: string };

export function parseLlmGatewayCredentialLease(
  input: unknown,
  options?: {
    expectedApiBase?: string;
    expectedProvider?: LlmGatewayProvider;
    expectedModel?: string;
    nowMilliseconds?: number;
    allowInsecureLoopback?: boolean;
  },
): LlmGatewayCredentialLease;

export function validateGatewayApiBase(
  value: string,
  options?: { allowInsecureLoopback?: boolean },
): string;
import type { EntitlementDecision } from "./voicecore-entitlement.mjs";
