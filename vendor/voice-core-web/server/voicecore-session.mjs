import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { requireEntitlementDecision } from "./voicecore-entitlement.mjs";

export const VOICECORE_SESSION_HEADER = "x-voicecore-session";
export const VOICECORE_SESSION_QUERY_PARAM = "voice_core_session_token";
export const DEFAULT_SESSION_TTL_SECONDS = 15 * 60;
export const MIN_SESSION_TTL_SECONDS = 60;
export const MAX_SESSION_TTL_SECONDS = 15 * 60;
export const DEFAULT_REQUIRED_SCOPE = "voicecore:web";
export const SESSION_TOKEN_TYPE = "voicecore_web_session_v1";

const TOKEN_VERSION = "vcs1";
const DEFAULT_AUDIENCE = "voicecore:web";
const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_BYTES = 8 * 1024;
const CLOCK_SKEW_SECONDS = 30;
const CLAIM_KEYS = new Set([
  "typ", "sub", "aud", "scope", "iat", "nbf", "exp", "jti", "license_id",
  "customer_id", "workspace_id", "app_version",
]);
const VERIFIED_SESSION_CLAIMS = new WeakSet();

export function issueVoiceCoreSessionToken({
  secret,
  keyId,
  entitlementDecision,
  appVersion,
  scope = [DEFAULT_REQUIRED_SCOPE],
  audience = DEFAULT_AUDIENCE,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
  tokenId = randomUUID(),
}) {
  validateSecret(secret);
  const kid = identifier(keyId, "keyId", 64, /^[A-Za-z0-9_-]+$/u);
  const ttl = validateTtl(ttlSeconds);
  const now = timestamp(nowSeconds, "nowSeconds");
  const decision = requireEntitlementDecision(entitlementDecision, { requiredFeature: "web_runtime", nowSeconds: now });
  if (decision.valid_until !== null && now + ttl > decision.valid_until) throw new Error("session lifetime exceeds the entitlement validity window");
  const claims = {
    typ: SESSION_TOKEN_TYPE,
    sub: decision.subject,
    aud: identifier(audience, "audience", 256),
    scope: validateScope(scope),
    iat: now,
    nbf: now,
    exp: now + ttl,
    jti: identifier(tokenId, "tokenId", 256),
    license_id: decision.license_id,
    customer_id: decision.customer_id,
    workspace_id: decision.workspace_id,
    app_version: appVersion === undefined ? null : identifier(appVersion, "appVersion", 256),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signed = `${TOKEN_VERSION}.${kid}.${payload}`;
  const token = `${signed}.${sign(secret, signed).toString("base64url")}`;
  if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) throw new Error("Voice Core session token exceeds the size limit");
  return { token, claims: freezeClaims(claims) };
}

/**
 * @param {{token:string|null, keys:Record<string,string>, requiredScope?:string, expectedAudience?:string, nowSeconds?:number, isRevoked?:(identity:Readonly<{token_id:string,license_id:string,subject:string}>)=>boolean}} input
 * @returns {{ok:true,claims:any}|{ok:false,reason:string}}
 */
export function verifyVoiceCoreSessionToken({
  token,
  keys,
  requiredScope = DEFAULT_REQUIRED_SCOPE,
  expectedAudience = DEFAULT_AUDIENCE,
  nowSeconds = Math.floor(Date.now() / 1000),
  isRevoked = undefined,
}) {
  if (typeof token !== "string" || token.length === 0 || Buffer.byteLength(token) > MAX_TOKEN_BYTES || token.trim() !== token) return rejected("malformed token");
  const segments = token.split(".");
  if (segments.length !== 4 || segments.some((segment) => !canonicalBase64OrId(segment))) return rejected("malformed token");
  const [version, keyId, payload, encodedSignature] = segments;
  if (version !== TOKEN_VERSION || !/^[A-Za-z0-9_-]{1,64}$/u.test(keyId) || !canonicalBase64(payload) || !canonicalBase64(encodedSignature)) return rejected("malformed token");
  const keyring = snapshotKeyring(keys);
  const secret = keyring.get(keyId);
  if (!secret) return rejected("unknown key");
  const signed = `${version}.${keyId}.${payload}`;
  const expected = sign(secret, signed);
  const actual = Buffer.from(encodedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return rejected("bad signature");
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return rejected("invalid payload"); }
  const reason = validateClaims(claims, { requiredScope, expectedAudience, nowSeconds });
  if (reason) return rejected(reason);
  if (isRevoked !== undefined) {
    if (typeof isRevoked !== "function") throw new TypeError("isRevoked must be a synchronous trusted-store callback");
    let revoked;
    try {
      revoked = isRevoked(Object.freeze({ token_id: claims.jti, license_id: claims.license_id, subject: claims.sub }));
    } catch {
      return rejected("revocation check failed");
    }
    if (typeof revoked !== "boolean") return rejected("invalid revocation result");
    if (revoked) return rejected("revoked token");
  }
  const verified = freezeClaims(claims);
  VERIFIED_SESSION_CLAIMS.add(verified);
  return { ok: true, claims: verified };
}

export function isVerifiedVoiceCoreSessionClaims(claims) {
  return Boolean(claims && VERIFIED_SESSION_CLAIMS.has(claims));
}

export function readVoiceCoreSessionHeader(headers) {
  const value = headers?.[VOICECORE_SESSION_HEADER];
  if (typeof value === "string" && value.trim() === value && value) return value;
  if (Array.isArray(value)) {
    const candidates = value.filter((entry) => typeof entry === "string" && entry.trim() === entry && entry);
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

export function readVoiceCoreSessionQuery(urlString) {
  const url = new URL(urlString ?? "/", "http://localhost");
  const values = url.searchParams.getAll(VOICECORE_SESSION_QUERY_PARAM);
  return values.length === 1 && values[0] && values[0].trim() === values[0] ? values[0] : null;
}

export function buildVoiceCoreSessionResponse(args) {
  const { token, claims } = issueVoiceCoreSessionToken(args);
  return Object.freeze({
    session_token: token,
    expires_at: new Date(claims.exp * 1000).toISOString(),
    expires_in_seconds: claims.exp - claims.iat,
  });
}

export function buildVoiceCoreSessionKeyring({ currentKeyId, currentSecret, previousKeysJson = undefined }) {
  const previous = parsePreviousKeys(previousKeysJson);
  const current = identifier(currentKeyId, "currentKeyId", 64, /^[A-Za-z0-9_-]+$/u);
  if (Object.prototype.hasOwnProperty.call(previous, current)) throw new TypeError("previous session keys must not contain the current key ID");
  return validateVoiceCoreSessionKeys({ [current]: currentSecret, ...previous });
}

export function validateVoiceCoreSessionKeys(keys) {
  return Object.freeze(Object.fromEntries(snapshotKeyring(keys)));
}

export function clampVoiceCoreSessionTtl(value) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) throw new RangeError("session TTL must be finite");
  return Math.max(MIN_SESSION_TTL_SECONDS, Math.min(MAX_SESSION_TTL_SECONDS, Math.trunc(parsed)));
}

export function parseJsonRecord(text) {
  if (!text?.trim()) return {};
  try { const parsed = JSON.parse(text); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}

export function isTruthy(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function validateClaims(input, { requiredScope, expectedAudience, nowSeconds }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "invalid claims";
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  if (keys.length !== CLAIM_KEYS.size || keys.some((key) => !CLAIM_KEYS.has(key)) || keys.some((key) => !("value" in descriptors[key]) || !descriptors[key].enumerable)) return "invalid claims";
  try {
    if (input.typ !== SESSION_TOKEN_TYPE) return "invalid claims";
    identifier(input.sub, "sub", 256);
    identifier(input.aud, "aud", 256);
    if (input.aud !== expectedAudience) return "wrong audience";
    const scopes = validateScope(input.scope);
    if (!scopes.includes(requiredScope)) return "missing scope";
    const now = timestamp(nowSeconds, "nowSeconds");
    const iat = timestamp(input.iat, "iat");
    const nbf = timestamp(input.nbf, "nbf");
    const exp = timestamp(input.exp, "exp");
    if (nbf < iat || exp <= nbf || exp - iat > MAX_SESSION_TTL_SECONDS || iat > now + CLOCK_SKEW_SECONDS) return "invalid timing";
    if (nbf > now + CLOCK_SKEW_SECONDS) return "not yet valid";
    if (exp <= now) return "expired token";
    identifier(input.jti, "jti", 256);
    identifier(input.license_id, "license_id", 128);
    identifier(input.customer_id, "customer_id", 128);
    if (input.workspace_id !== null) identifier(input.workspace_id, "workspace_id", 256);
    if (input.app_version !== null) identifier(input.app_version, "app_version", 256);
  } catch { return "invalid claims"; }
  return null;
}

function snapshotKeyring(keys) {
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw new TypeError("keys must be a key-ID to secret record");
  const descriptors = Object.getOwnPropertyDescriptors(keys);
  const entries = Object.entries(descriptors);
  if (entries.length === 0 || entries.length > 4) throw new TypeError("keys must contain 1-4 entries");
  const output = new Map();
  for (const [keyId, descriptor] of entries) {
    identifier(keyId, "keyId", 64, /^[A-Za-z0-9_-]+$/u);
    if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError("keys must contain enumerable data properties only");
    validateSecret(descriptor.value);
    output.set(keyId, descriptor.value);
  }
  return output;
}

function parsePreviousKeys(text) {
  if (text === undefined || text === null || text === "") return {};
  if (typeof text !== "string" || text.trim() !== text) throw new TypeError("previous session keys must be canonical JSON");
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new TypeError("previous session keys must be valid JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("previous session keys must be a key-ID to secret JSON object");
  return parsed;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < MIN_SECRET_BYTES) throw new TypeError("session secret must contain at least 32 bytes of cryptographic entropy");
}

function validateTtl(value) {
  if (!Number.isSafeInteger(value) || value < MIN_SESSION_TTL_SECONDS || value > MAX_SESSION_TTL_SECONDS) throw new RangeError(`session TTL must be ${MIN_SESSION_TTL_SECONDS}-${MAX_SESSION_TTL_SECONDS} seconds`);
  return value;
}

function validateScope(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new TypeError("scope is invalid");
  const output = value.map((item) => identifier(item, "scope", 128));
  if (new Set(output).size !== output.length) throw new TypeError("scope contains duplicates");
  return output;
}

function identifier(value, label, maximum, pattern = /^[!-~]+$/u) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value || !pattern.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive Unix timestamp`);
  return value;
}

function canonicalBase64OrId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value); }
function canonicalBase64(value) { return canonicalBase64OrId(value) && Buffer.from(value, "base64url").toString("base64url") === value; }
function sign(secret, value) { return createHmac("sha256", secret).update(value).digest(); }
function freezeClaims(claims) { return Object.freeze({ ...claims, scope: Object.freeze([...claims.scope]) }); }
/** @returns {{ok:false,reason:string}} */
function rejected(reason) { return { ok: false, reason }; }
