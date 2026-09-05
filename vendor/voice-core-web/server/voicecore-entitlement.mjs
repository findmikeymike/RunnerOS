export const ENTITLEMENT_DECISION_SCHEMA_VERSION = 1;
export const ENTITLEMENT_PRODUCT = "convo-sdk";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_TERM_SECONDS = 5 * 366 * 24 * 60 * 60;
const MAX_GRACE_SECONDS = 45 * 24 * 60 * 60;
const CLAIM_KEYS = new Set([
  "schema_version", "license_id", "customer_id", "product", "tier", "license_kind",
  "app_ids", "features", "issued_at", "not_before", "runtime_expires_at",
  "grace_expires_at", "maintenance_expires_at", "support_expires_at",
]);
const ALLOWED_FEATURES = new Set([
  "voice_runtime", "provider_bridge", "pocket_tts", "voice_clone", "web_runtime", "enterprise",
]);
const APPROVED_DECISIONS = new WeakSet();

/**
 * @param {{authenticatedSubject:string, workspaceId?:string, expectedAppId?:string, sdkReleaseUnix:number, entitlementClaims:Record<string, unknown>, revoked:boolean, requiredFeatures?:string[], nowSeconds?:number}} input
 * @returns {any}
 */
export function decideVoiceCoreEntitlement({
  authenticatedSubject,
  workspaceId,
  expectedAppId,
  sdkReleaseUnix,
  entitlementClaims,
  revoked,
  requiredFeatures = [],
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const subject = identifier(authenticatedSubject, "authenticatedSubject", 256);
  const workspace = workspaceId === undefined ? null : identifier(workspaceId, "workspaceId", 256);
  const appId = expectedAppId === undefined ? null : identifier(expectedAppId, "expectedAppId", 255);
  const now = timestamp(nowSeconds, "nowSeconds");
  const release = timestamp(sdkReleaseUnix, "sdkReleaseUnix");
  if (typeof revoked !== "boolean") throw new TypeError("revoked must be a boolean from the trusted entitlement store");
  const required = list(requiredFeatures, "requiredFeatures", 32, 64, ALLOWED_FEATURES);
  const claims = validateClaims(entitlementClaims);

  let reason = null;
  let runtimeState = "active";
  if (revoked) reason = "revoked";
  else if (claims.not_before > now + MAX_CLOCK_SKEW_SECONDS) reason = "not_yet_valid";
  else if (claims.issued_at > now + MAX_CLOCK_SKEW_SECONDS) reason = "invalid_issue_time";
  else if (claims.maintenance_expires_at < release) reason = "maintenance_expired";
  else if (claims.app_ids.length > 0 && (!appId || !claims.app_ids.includes(appId))) reason = "app_mismatch";
  else if (required.some((feature) => !claims.features.includes(feature))) reason = "missing_feature";
  else if (claims.license_kind === "term" && now >= claims.grace_expires_at) reason = "expired";
  else if (claims.license_kind === "term" && now >= claims.runtime_expires_at) runtimeState = "grace";
  else if (claims.license_kind === "perpetual") runtimeState = "perpetual";

  if (reason) {
    return Object.freeze({
      schema_version: ENTITLEMENT_DECISION_SCHEMA_VERSION,
      decision: "deny",
      reason,
      subject,
      workspace_id: workspace,
      license_id: claims.license_id,
      evaluated_at: now,
    });
  }

  const decision = Object.freeze({
    schema_version: ENTITLEMENT_DECISION_SCHEMA_VERSION,
    decision: "allow",
    reason: null,
    subject,
    workspace_id: workspace,
    license_id: claims.license_id,
    customer_id: claims.customer_id,
    tier: claims.tier,
    license_kind: claims.license_kind,
    runtime_state: runtimeState,
    valid_until: claims.license_kind === "term" ? claims.grace_expires_at : null,
    features: Object.freeze([...claims.features]),
    evaluated_at: now,
  });
  APPROVED_DECISIONS.add(decision);
  return decision;
}

/** @param {any} decision @param {{requiredFeature?:string, nowSeconds?:number, maximumAgeSeconds?:number}} [options] @returns {any} */
export function requireEntitlementDecision(decision, {
  requiredFeature,
  nowSeconds = Math.floor(Date.now() / 1000),
  maximumAgeSeconds = 30,
} = {}) {
  if (!decision || !APPROVED_DECISIONS.has(decision) || decision.decision !== "allow") {
    throw new Error("an approved EntitlementDecision from the current process is required");
  }
  if (requiredFeature !== undefined) {
    const feature = identifier(requiredFeature, "requiredFeature", 64);
    if (!decision.features.includes(feature)) throw new Error(`EntitlementDecision does not grant ${feature}`);
  }
  const now = timestamp(nowSeconds, "nowSeconds");
  if (!Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 0 || maximumAgeSeconds > 300) throw new RangeError("maximumAgeSeconds must be 0-300");
  if (decision.evaluated_at > now || now - decision.evaluated_at > maximumAgeSeconds) throw new Error("EntitlementDecision is stale");
  return decision;
}

function validateClaims(input) {
  const claims = snapshotExactRecord(input, CLAIM_KEYS, "entitlementClaims");
  if (claims.schema_version !== 2) throw new TypeError("unsupported entitlement schema");
  if (claims.product !== ENTITLEMENT_PRODUCT) throw new TypeError("wrong entitlement product");
  claims.license_id = identifier(claims.license_id, "license_id", 128);
  claims.customer_id = identifier(claims.customer_id, "customer_id", 128);
  claims.tier = identifier(claims.tier, "tier", 64);
  claims.app_ids = list(claims.app_ids, "app_ids", 32, 255);
  claims.features = list(claims.features, "features", 32, 64, ALLOWED_FEATURES);
  if (claims.features.length === 0) throw new TypeError("features must not be empty");
  claims.issued_at = timestamp(claims.issued_at, "issued_at");
  claims.not_before = timestamp(claims.not_before, "not_before");
  claims.maintenance_expires_at = timestamp(claims.maintenance_expires_at, "maintenance_expires_at");
  claims.support_expires_at = nullableTimestamp(claims.support_expires_at, "support_expires_at");
  if (claims.not_before < claims.issued_at || claims.maintenance_expires_at < claims.issued_at || (claims.support_expires_at !== null && claims.support_expires_at < claims.issued_at)) {
    throw new TypeError("invalid entitlement time ordering");
  }
  if (claims.license_kind === "perpetual") {
    if (claims.runtime_expires_at !== null || claims.grace_expires_at !== null) throw new TypeError("perpetual entitlement must have null runtime deadlines");
  } else if (claims.license_kind === "term") {
    claims.runtime_expires_at = timestamp(claims.runtime_expires_at, "runtime_expires_at");
    claims.grace_expires_at = timestamp(claims.grace_expires_at, "grace_expires_at");
    if (claims.runtime_expires_at <= claims.not_before || claims.runtime_expires_at - claims.issued_at > MAX_TERM_SECONDS || claims.grace_expires_at < claims.runtime_expires_at || claims.grace_expires_at - claims.runtime_expires_at > MAX_GRACE_SECONDS) {
      throw new TypeError("invalid term entitlement deadlines");
    }
  } else {
    throw new TypeError("license_kind must be term or perpetual");
  }
  return claims;
}

function snapshotExactRecord(input, expected, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Object.keys(descriptors);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) throw new TypeError(`${label} has an invalid shape`);
  const output = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} must contain enumerable data properties only`);
    output[key] = descriptor.value;
  }
  return output;
}

function identifier(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value || !/^[!-~]+$/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function list(value, label, maximumItems, maximumLength, allowlist) {
  if (!Array.isArray(value) || value.length > maximumItems) throw new TypeError(`${label} is invalid`);
  const output = value.map((item) => identifier(item, label, maximumLength));
  if (new Set(output).size !== output.length || (allowlist && output.some((item) => !allowlist.has(item)))) throw new TypeError(`${label} is invalid`);
  return output;
}

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive Unix timestamp`);
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}
