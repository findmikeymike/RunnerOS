import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireEntitlementDecision } from "./voicecore-entitlement.mjs";

export const LLM_CREDENTIAL_SCHEMA_VERSION = 1;
export const LLM_GATEWAY_TOKEN_TYPE = "voicecore_llm_gateway_v1";
export const LLM_GATEWAY_SCOPE = "voicecore:llm";
export const DEFAULT_LLM_CREDENTIAL_TTL_SECONDS = 5 * 60;
export const MIN_LLM_CREDENTIAL_TTL_SECONDS = 60;
export const MAX_LLM_CREDENTIAL_TTL_SECONDS = 15 * 60;

const MAX_TOKEN_BYTES = 8 * 1024;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_MODEL_LENGTH = 512;
const MIN_SECRET_BYTES = 32;
const CLOCK_SKEW_SECONDS = 30;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/u;
const BEARER_TOKEN = /^[A-Za-z0-9._~+/-]+=*$/u;
const PROVIDERS = new Set(["openai", "together_ai", "groq", "openrouter", "custom"]);
const CLAIM_KEYS = new Set([
  "typ",
  "sub",
  "aud",
  "scope",
  "provider",
  "model",
  "iat",
  "exp",
  "jti",
  "workspace_id",
  "license_id",
  "customer_id",
]);
const LEASE_KEYS = new Set([
  "schema_version",
  "credential_kind",
  "runtime_provider",
  "upstream_provider",
  "api_base",
  "model",
  "auth_token",
  "issued_at",
  "expires_at",
  "refresh_after",
  "expires_in_seconds",
]);
const VERIFIED_GATEWAY_CLAIMS = new WeakSet();

/**
 * Issue a short-lived credential accepted by an operator-owned LLM gateway.
 * This is never a cloud-provider API key. The gateway keeps that key server-side.
 */
export function issueLlmGatewayCredential({
  secret,
  entitlementDecision,
  upstreamProvider,
  model,
  gatewayApiBase,
  ttlSeconds = DEFAULT_LLM_CREDENTIAL_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
  tokenId = randomUUID(),
  allowInsecureLoopback = false,
}) {
  validateSecret(secret);
  const provider = validateProvider(upstreamProvider);
  const selectedModel = validateModel(model);
  const apiBase = validateGatewayApiBase(gatewayApiBase, { allowInsecureLoopback });
  const ttl = validateTtl(ttlSeconds);
  const issuedAt = validateTimestamp(nowSeconds, "nowSeconds");
  const decision = requireEntitlementDecision(entitlementDecision, {
    requiredFeature: "provider_bridge",
    nowSeconds: issuedAt,
  });
  if (decision.valid_until !== null && issuedAt + ttl > decision.valid_until) {
    throw new Error("gateway credential lifetime exceeds the entitlement validity window");
  }
  const jti = validateIdentifier(tokenId, "tokenId");

  const claims = {
    typ: LLM_GATEWAY_TOKEN_TYPE,
    sub: decision.subject,
    aud: apiBase,
    scope: [LLM_GATEWAY_SCOPE],
    provider,
    model: selectedModel,
    iat: issuedAt,
    exp: issuedAt + ttl,
    jti,
    license_id: decision.license_id,
    customer_id: decision.customer_id,
    ...(decision.workspace_id ? { workspace_id: decision.workspace_id } : {}),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = sign(secret, payload).toString("base64url");
  const authToken = `${payload}.${signature}`;
  if (Buffer.byteLength(authToken, "utf8") > MAX_TOKEN_BYTES) {
    throw new Error("LLM gateway credential exceeds the token size limit");
  }

  const refreshAt = issuedAt + Math.max(30, Math.floor(ttl * 2 / 3));
  return {
    lease: Object.freeze({
      schema_version: LLM_CREDENTIAL_SCHEMA_VERSION,
      credential_kind: "gateway_session",
      runtime_provider: "custom",
      upstream_provider: provider,
      api_base: apiBase,
      model: selectedModel,
      auth_token: authToken,
      issued_at: new Date(issuedAt * 1000).toISOString(),
      expires_at: new Date(claims.exp * 1000).toISOString(),
      refresh_after: new Date(refreshAt * 1000).toISOString(),
      expires_in_seconds: ttl,
    }),
    claims: freezeClaims(claims),
  };
}

/** Verify a gateway bearer and its exact deployment/provider/model binding. */
export function verifyLlmGatewayCredential({
  token,
  secret,
  expectedAudience,
  expectedProvider,
  expectedModel,
  nowSeconds = Math.floor(Date.now() / 1000),
  allowInsecureLoopback = false,
}) {
  validateSecret(secret);
  let audience;
  try {
    audience = validateGatewayApiBase(expectedAudience, { allowInsecureLoopback });
  } catch {
    throw new Error("expectedAudience must be a valid gateway API base");
  }
  if (typeof token !== "string" || token.length === 0 || Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
    return rejected("malformed credential");
  }
  const segments = token.split(".");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return rejected("malformed credential");
  }

  const [payload, encodedSignature] = segments;
  if (!isCanonicalBase64Url(payload) || !isCanonicalBase64Url(encodedSignature)) {
    return rejected("malformed credential");
  }
  let actualSignature;
  try {
    actualSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    return rejected("invalid credential");
  }
  const expectedSignature = sign(secret, payload);
  if (
    actualSignature.length !== expectedSignature.length
    || !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return rejected("invalid credential");
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return rejected("invalid credential");
  }
  const claimsError = validateClaims(claims, {
    audience,
    expectedProvider,
    expectedModel,
    nowSeconds,
  });
  if (claimsError) return rejected(claimsError);
  const verifiedClaims = freezeClaims(claims);
  VERIFIED_GATEWAY_CLAIMS.add(verifiedClaims);
  return { ok: true, claims: verifiedClaims };
}

/**
 * Validate the model on a chat-completions request against the signed lease.
 * Request byte limits, authentication, quotas, and provider routing remain gateway duties.
 */
export function verifyLlmGatewayRequestBinding({ claims, requestBody }) {
  if (!claims || !VERIFIED_GATEWAY_CLAIMS.has(claims)) {
    return rejected("invalid credential claims");
  }
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    return rejected("invalid chat request");
  }
  if (requestBody.model !== claims.model) {
    return rejected("model does not match credential");
  }
  return { ok: true };
}

/**
 * Strictly parse an authenticated broker response before configuring a client.
 * This validates shape and binding, not the gateway signature; clients trust the
 * authenticated HTTPS broker response and the gateway verifies the bearer.
 */
export function parseLlmGatewayCredentialLease(input, {
  expectedApiBase,
  expectedProvider,
  expectedModel,
  nowMilliseconds = Date.now(),
  allowInsecureLoopback = false,
} = {}) {
  const lease = snapshotLeaseRecord(input);
  if (
    lease.schema_version !== LLM_CREDENTIAL_SCHEMA_VERSION
    || lease.credential_kind !== "gateway_session"
    || lease.runtime_provider !== "custom"
  ) {
    throw new Error("unsupported LLM credential lease");
  }
  const provider = validateProvider(lease.upstream_provider);
  const apiBase = validateGatewayApiBase(lease.api_base, { allowInsecureLoopback });
  const model = validateModel(lease.model);
  const authToken = validateGatewayBearer(lease.auth_token);
  const lifetime = validateTtl(lease.expires_in_seconds);
  const issuedAtText = validateExactString(lease.issued_at, "issued_at", 64);
  const refreshAfterText = validateExactString(lease.refresh_after, "refresh_after", 64);
  const expiresAtText = validateExactString(lease.expires_at, "expires_at", 64);
  const issuedAt = parseCanonicalIsoTimestamp(issuedAtText, "issued_at");
  const refreshAfter = parseCanonicalIsoTimestamp(refreshAfterText, "refresh_after");
  const expiresAt = parseCanonicalIsoTimestamp(expiresAtText, "expires_at");
  if (!Number.isFinite(nowMilliseconds) || nowMilliseconds < 0) {
    throw new Error("nowMilliseconds must be a positive timestamp");
  }
  if (
    expiresAt - issuedAt !== lifetime * 1000
    || refreshAfter <= issuedAt
    || refreshAfter >= expiresAt
    || expiresAt <= nowMilliseconds
    || issuedAt > nowMilliseconds + CLOCK_SKEW_SECONDS * 1000
  ) {
    throw new Error("invalid LLM credential lease timing");
  }
  if (
    expectedApiBase !== undefined
    && apiBase !== validateGatewayApiBase(expectedApiBase, { allowInsecureLoopback })
  ) {
    throw new Error("LLM credential lease API base mismatch");
  }
  if (expectedProvider !== undefined && provider !== validateProvider(expectedProvider)) {
    throw new Error("LLM credential lease provider mismatch");
  }
  if (expectedModel !== undefined && model !== validateModel(expectedModel)) {
    throw new Error("LLM credential lease model mismatch");
  }
  return Object.freeze({
    schema_version: LLM_CREDENTIAL_SCHEMA_VERSION,
    credential_kind: "gateway_session",
    runtime_provider: "custom",
    upstream_provider: provider,
    api_base: apiBase,
    model,
    auth_token: authToken,
    issued_at: issuedAtText,
    expires_at: expiresAtText,
    refresh_after: refreshAfterText,
    expires_in_seconds: lifetime,
  });
}

export function validateGatewayApiBase(value, { allowInsecureLoopback = false } = {}) {
  const exact = validateExactString(value, "gatewayApiBase", 2048);
  if (!/^[\x21-\x7e]+$/u.test(exact)) {
    throw new Error("gatewayApiBase must use visible ASCII URL syntax");
  }
  let parsed;
  try {
    parsed = new URL(exact);
  } catch {
    throw new Error("gatewayApiBase must be an absolute URL");
  }
  const loopback = parsed.hostname === "localhost"
    || parsed.hostname === "127.0.0.1"
    || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(allowInsecureLoopback && loopback && parsed.protocol === "http:")) {
    throw new Error("gatewayApiBase must use HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("gatewayApiBase must not contain credentials, query, or fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

function validateClaims(claims, { audience, expectedProvider, expectedModel, nowSeconds }) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    return "invalid credential claims";
  }
  if (Object.keys(claims).some((key) => !CLAIM_KEYS.has(key))) {
    return "invalid credential claims";
  }
  try {
    validateIdentifier(claims.sub, "sub");
    validateIdentifier(claims.jti, "jti");
    validateIdentifier(claims.license_id, "license_id");
    validateIdentifier(claims.customer_id, "customer_id");
    if (claims.workspace_id !== undefined) validateIdentifier(claims.workspace_id, "workspace_id");
    validateProvider(claims.provider);
    validateModel(claims.model);
  } catch {
    return "invalid credential claims";
  }
  if (claims.typ !== LLM_GATEWAY_TOKEN_TYPE || claims.aud !== audience) {
    return "credential binding mismatch";
  }
  if (!Array.isArray(claims.scope) || claims.scope.length !== 1 || claims.scope[0] !== LLM_GATEWAY_SCOPE) {
    return "credential scope mismatch";
  }
  if (expectedProvider !== undefined && claims.provider !== expectedProvider) {
    return "credential binding mismatch";
  }
  if (expectedModel !== undefined && claims.model !== expectedModel) {
    return "credential binding mismatch";
  }
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || !Number.isInteger(nowSeconds)) {
    return "invalid credential time";
  }
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS || claims.exp <= claims.iat) {
    return "invalid credential time";
  }
  if (claims.exp - claims.iat > MAX_LLM_CREDENTIAL_TTL_SECONDS) {
    return "credential lifetime exceeds policy";
  }
  if (claims.exp <= nowSeconds) {
    return "expired credential";
  }
  return null;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("LLM credential signing secret must be at least 32 bytes");
  }
}

function validateProvider(value) {
  const provider = validateExactString(value, "upstreamProvider", MAX_IDENTIFIER_BYTES);
  if (!PROVIDERS.has(provider)) throw new Error("unsupported upstreamProvider");
  return provider;
}

function validateModel(value) {
  const model = validateExactString(value, "model", MAX_MODEL_LENGTH);
  if (!/^[\x21-\x7e]+$/u.test(model)) throw new Error("model must use visible ASCII");
  return model;
}

function validateIdentifier(value, name) {
  return validateExactString(value, name, MAX_IDENTIFIER_BYTES);
}

function validateExactString(value, name, maxBytes) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty exact-trimmed string`);
  }
  if (Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${name} is invalid or too long`);
  }
  return value;
}

function validateTtl(value) {
  if (
    !Number.isInteger(value)
    || value < MIN_LLM_CREDENTIAL_TTL_SECONDS
    || value > MAX_LLM_CREDENTIAL_TTL_SECONDS
  ) {
    throw new Error(
      `ttlSeconds must be ${MIN_LLM_CREDENTIAL_TTL_SECONDS}-${MAX_LLM_CREDENTIAL_TTL_SECONDS}`,
    );
  }
  return value;
}

function validateTimestamp(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function parseCanonicalIsoTimestamp(value, name) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${name} must be a canonical ISO timestamp`);
  }
  return milliseconds;
}

function validateGatewayBearer(value) {
  const token = validateExactString(value, "auth_token", MAX_TOKEN_BYTES);
  if (!BEARER_TOKEN.test(token)) {
    throw new Error("auth_token must use standard bearer-token syntax");
  }
  return token;
}

function snapshotLeaseRecord(input) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("shape");
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new Error("prototype");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== LEASE_KEYS.size
      || keys.some((key) => typeof key !== "string" || !LEASE_KEYS.has(key))
    ) {
      throw new Error("keys");
    }
    const snapshot = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !("value" in descriptor)) throw new Error("descriptor");
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    throw new Error("invalid LLM credential lease shape");
  }
}

function sign(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest();
}

function isCanonicalBase64Url(value) {
  if (!BASE64URL_SEGMENT.test(value)) return false;
  try {
    return Buffer.from(value, "base64url").toString("base64url") === value;
  } catch {
    return false;
  }
}

function freezeClaims(claims) {
  return Object.freeze({ ...claims, scope: Object.freeze([...claims.scope]) });
}

function rejected(reason) {
  return { ok: false, reason };
}
