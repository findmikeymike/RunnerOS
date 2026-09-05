import { randomUUID } from "node:crypto";
import { decideVoiceCoreEntitlement } from "./voicecore-entitlement.mjs";
import {
  issueLlmGatewayCredential,
  validateGatewayApiBase,
  verifyLlmGatewayCredential,
  verifyLlmGatewayRequestBinding,
} from "./voicecore-llm-credential.mjs";

const PROVIDERS = new Set(["openai", "together_ai", "groq", "openrouter", "custom"]);
const LEASE_BODY_KEYS = new Set(["upstream_provider", "model", "workspace_id"]);
const IDENTITY_KEYS = new Set(["subject", "workspace_id", "app_id"]);
const ENTITLEMENT_KEYS = new Set(["claims", "revoked"]);
const MAX_LEASE_BODY_BYTES = 16 * 1024;
const DEFAULT_MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_SSE_EVENT_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_HOOK_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_CONCURRENT = 128;
const MAX_CREDENTIAL_BYTES = 8 * 1024;

export function createVoiceCoreOperatorGateway(options) {
  const config = snapshotOptions(options);
  let activeRequests = 0;
  let activeCredentialRequests = 0;
  let activeRejectionAudits = 0;
  const scheduleRejectionAudit = (details, deadline) => {
    if (activeRejectionAudits >= config.limits.maxRejectionAuditConcurrent) return false;
    activeRejectionAudits += 1;
    void auditRejection(config, details, deadline).finally(() => { activeRejectionAudits -= 1; });
    return true;
  };

  return Object.freeze({
    async handle(request) {
      try {
        if (!(request instanceof Request)) throw new GatewayError(400, "invalid_request");
        const url = new URL(request.url);
        if (url.origin !== config.origin || url.search || url.hash) throw new GatewayError(404, "not_found");
        const deadline = Date.now() + config.limits.requestTimeoutMs;
        if (url.pathname === config.credentialPath) {
          if (activeCredentialRequests >= config.limits.maxCredentialConcurrent) throw new GatewayError(429, "gateway_busy");
          activeCredentialRequests += 1;
          try { return await issueLease(request, config, deadline); }
          finally { activeCredentialRequests -= 1; }
        }
        if (url.pathname === config.chatPath) {
          if (activeRequests >= config.limits.maxConcurrent) throw new GatewayError(429, "gateway_busy");
          activeRequests += 1;
          let owned = true;
          const releaseSlot = () => {
            if (!owned) return;
            owned = false;
            activeRequests -= 1;
          };
          try {
            return await proxyChat(request, config, releaseSlot, deadline, scheduleRejectionAudit);
          } catch (error) {
            releaseSlot();
            throw error;
          }
        }
        throw new GatewayError(404, "not_found");
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}

async function issueLease(request, config, deadline) {
  if (request.method !== "POST") throw new GatewayError(405, "method_not_allowed");
  requireJsonContentType(request);
  const authenticated = await trustedCall(config.authenticate, request, deadline, config.limits.hookTimeoutMs);
  if (authenticated === null) throw new GatewayError(401, "authentication_required");
  let identity;
  try { identity = snapshotIdentity(authenticated); }
  catch { throw new GatewayError(503, "policy_unavailable"); }
  const body = snapshotExactRecord(
    await readJson(request, MAX_LEASE_BODY_BYTES, deadline),
    LEASE_BODY_KEYS,
    "lease request",
    { optional: new Set(["workspace_id"]) },
  );
  const provider = exactProvider(body.upstream_provider);
  const model = exactModel(body.model);
  if (body.workspace_id !== undefined && body.workspace_id !== identity.workspace_id) {
    throw new GatewayError(403, "workspace_mismatch");
  }
  const route = config.providers.get(provider);
  if (!route || await trustedBoolean(route.authorizeModel, { identity, model }, deadline, config.limits.hookTimeoutMs) !== true) {
    throw new GatewayError(403, "selection_not_allowed");
  }
  const stored = snapshotEntitlement(await trustedCall(config.loadEntitlement, identity, deadline, config.limits.hookTimeoutMs));
  const nowSeconds = config.nowSeconds();
  const decision = decideVoiceCoreEntitlement({
    authenticatedSubject: identity.subject,
    workspaceId: identity.workspace_id,
    expectedAppId: identity.app_id,
    sdkReleaseUnix: config.sdkReleaseUnix,
    entitlementClaims: stored.claims,
    revoked: stored.revoked,
    requiredFeatures: ["provider_bridge"],
    nowSeconds,
  });
  if (decision.decision !== "allow") throw new GatewayError(403, "entitlement_denied");
  const { lease } = issueLlmGatewayCredential({
    secret: config.credentialSecrets[0],
    entitlementDecision: decision,
    upstreamProvider: provider,
    model,
    gatewayApiBase: config.gatewayApiBase,
    ttlSeconds: config.credentialTtlSeconds,
    nowSeconds,
    tokenId: nextId(config),
    allowInsecureLoopback: config.allowInsecureLoopback,
  });
  await trustedCall(config.audit, Object.freeze({
    type: "credential_issued",
    request_id: nextId(config),
    subject: identity.subject,
    workspace_id: identity.workspace_id ?? null,
    license_id: decision.license_id,
    customer_id: decision.customer_id,
    provider,
    model,
    occurred_at: nowSeconds,
  }), deadline, config.limits.hookTimeoutMs);
  return jsonResponse(200, lease);
}

async function proxyChat(request, config, releaseSlot, deadline, scheduleRejectionAudit) {
  try {
    if (request.method !== "POST") throw new GatewayError(405, "method_not_allowed");
    requireJsonContentType(request);
  } catch (error) {
    scheduleRejectionAudit({ reason: error instanceof GatewayError ? error.code : "invalid_request" }, deadline);
    throw error;
  }
  let token;
  try { token = readBearer(request.headers); }
  catch (error) {
    scheduleRejectionAudit({ reason: "missing_or_invalid_credential" }, deadline);
    throw error;
  }
  const verified = verifyWithRotation(token, config);
  if (!verified.ok) {
    scheduleRejectionAudit({ reason: "invalid_credential" }, deadline);
    throw new GatewayError(401, "invalid_credential");
  }
  const claims = verified.claims;
  const revoked = await trustedBoolean(config.isCredentialRevoked, Object.freeze({
    token_id: claims.jti,
    license_id: claims.license_id,
    customer_id: claims.customer_id,
    subject: claims.sub,
    workspace_id: claims.workspace_id ?? null,
  }), deadline, config.limits.hookTimeoutMs);
  if (revoked) {
    scheduleRejectionAudit(rejectionContext(claims, "revoked_credential"), deadline);
    throw new GatewayError(401, "revoked_credential");
  }
  const route = config.providers.get(claims.provider);
  if (!route || await trustedBoolean(route.authorizeModel, {
    identity: Object.freeze({ subject: claims.sub, workspace_id: claims.workspace_id ?? null }),
    model: claims.model,
  }, deadline, config.limits.hookTimeoutMs) !== true) {
    scheduleRejectionAudit(rejectionContext(claims, "selection_not_allowed"), deadline);
    throw new GatewayError(403, "selection_not_allowed");
  }

  let bodyBytes;
  let body;
  let budget;
  try {
    bodyBytes = await readBoundedBytes(request, config.limits.maxRequestBodyBytes, deadline);
    try { body = JSON.parse(Buffer.from(bodyBytes).toString("utf8")); }
    catch { throw new GatewayError(400, "invalid_json"); }
    const binding = verifyLlmGatewayRequestBinding({ claims, requestBody: body });
    if (!binding.ok) throw new GatewayError(403, "request_binding_mismatch");
    budget = validateBudget(body);
  } catch (error) {
    const reason = error instanceof GatewayError ? error.code : "invalid_request";
    scheduleRejectionAudit(rejectionContext(claims, reason), deadline);
    throw error;
  }

  const requestId = nextId(config);
  const context = Object.freeze({
    request_id: requestId,
    token_id: claims.jti,
    subject: claims.sub,
    workspace_id: claims.workspace_id ?? null,
    license_id: claims.license_id,
    customer_id: claims.customer_id,
    provider: claims.provider,
    model: claims.model,
    request_bytes: bodyBytes.byteLength,
    requested_max_tokens: budget.maxTokens,
    requested_token_field: budget.tokenField,
    requested_choices: budget.choices,
    requested_best_of: budget.bestOf,
    estimated_max_output_tokens: budget.estimatedMaxOutputTokens,
  });
  await acquireAdmission(config, context, deadline);

  let upstreamStarted = false;
  try {
    await trustedCall(config.audit, Object.freeze({
      type: "request_admitted",
      ...context,
      occurred_at: config.nowSeconds(),
    }), deadline, config.limits.hookTimeoutMs);
    const credential = await loadProviderCredential(route, context, deadline, config.limits.hookTimeoutMs);
    const controller = new AbortController();
    upstreamStarted = true;
    let upstream;
    try {
      upstream = await awaitDeadline(config.fetchImpl(`${route.apiBase}/chat/completions`, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(credential === null ? {} : { Authorization: `Bearer ${credential}` }),
        },
        body: bodyBytes,
        signal: controller.signal,
      }), deadline, new GatewayError(504, "request_timeout"));
    } catch {
      controller.abort();
      await completeAdmission(config, context, "upstream_error", null, releaseSlot);
      throw new GatewayError(502, "upstream_unavailable");
    }
    if (!upstream.ok) {
      cancelBody(upstream.body);
      await completeAdmission(config, context, "upstream_rejected", null, releaseSlot);
      return jsonResponse(normalizeUpstreamStatus(upstream.status), { error: "upstream_request_failed" });
    }
    const contentType = normalizeResponseContentType(upstream.headers.get("content-type"));
    if (!upstream.body || !contentType) {
      cancelBody(upstream.body);
      await completeAdmission(config, context, "invalid_upstream_response", null, releaseSlot);
      throw new GatewayError(502, "invalid_upstream_response");
    }
    const stream = createBoundedResponseStream({
      body: upstream.body,
      contentType,
      controller,
      deadline,
      limits: config.limits,
      onComplete: (outcome, usage) => completeAdmission(config, context, outcome, usage, releaseSlot),
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (!upstreamStarted) await requestAdmissionCancellation(config, context.request_id, "gateway_error");
    throw error;
  }
}

function createBoundedResponseStream({ body, contentType, controller, deadline, limits, onComplete }) {
  const reader = body.getReader();
  const sse = contentType === "text/event-stream";
  let total = 0;
  let eventBytes = 0;
  let lineBytes = 0;
  let lastLineByte = null;
  let eventParts = [];
  let jsonParts = [];
  let usage = null;
  let finished = false;
  let outputController;
  let timeout;

  const finalize = async (outcome) => {
    if (finished) return;
    finished = true;
    if (timeout) clearTimeout(timeout);
    await onComplete(outcome, usage);
  };

  return new ReadableStream({
    start(output) {
      outputController = output;
      timeout = setTimeout(async () => {
        if (finished) return;
        const completion = finalize("timeout").catch(() => undefined);
        controller.abort();
        cancelReader(reader);
        await completion;
        try { outputController.error(new Error("operator gateway response stream failed")); } catch {}
      }, remainingMs(deadline));
    },
    async pull(output) {
      try {
        const next = await reader.read();
        if (finished) return;
        if (next.done) {
          if (!sse) usage = extractJsonUsage(Buffer.concat(jsonParts));
          await finalize("completed");
          output.close();
          return;
        }
        const chunk = Buffer.from(next.value);
        total += chunk.byteLength;
        if (total > limits.maxResponseBytes) throw new Error("response limit exceeded");
        if (sse) {
          let segmentStart = 0;
          for (let index = 0; index < chunk.length; index += 1) {
            const byte = chunk[index];
            eventBytes += 1;
            if (eventBytes > limits.maxSseEventBytes) throw new Error("SSE event limit exceeded");
            if (byte === 0x0a) {
              if (lineBytes === 0 || (lineBytes === 1 && lastLineByte === 0x0d)) {
                eventParts.push(chunk.subarray(segmentStart, index + 1));
                usage = extractSseUsage(Buffer.concat(eventParts)) ?? usage;
                eventParts = [];
                eventBytes = 0;
                segmentStart = index + 1;
              }
              lineBytes = 0;
              lastLineByte = null;
            } else {
              lineBytes += 1;
              lastLineByte = byte;
            }
          }
          if (segmentStart < chunk.length) eventParts.push(chunk.subarray(segmentStart));
        } else {
          jsonParts.push(chunk);
        }
        output.enqueue(chunk);
      } catch (error) {
        const wasAborted = controller.signal.aborted;
        controller.abort();
        cancelReader(reader);
        await finalize(wasAborted ? "timeout_or_cancelled" : "stream_error").catch(() => undefined);
        output.error(new Error("operator gateway response stream failed"));
      }
    },
    async cancel() {
      controller.abort();
      cancelReader(reader);
      await finalize("client_cancelled").catch(() => undefined);
    },
  });
}

async function completeAdmission(config, context, outcome, usage, releaseSlot) {
  try {
    await requestTerminalCompletion(config, context, outcome, usage);
  } finally {
    releaseSlot();
  }
}

function verifyWithRotation(token, config) {
  for (const secret of config.credentialSecrets) {
    const result = verifyLlmGatewayCredential({
      token,
      secret,
      expectedAudience: config.gatewayApiBase,
      nowSeconds: config.nowSeconds(),
      allowInsecureLoopback: config.allowInsecureLoopback,
    });
    if (result.ok) return result;
  }
  return { ok: false, reason: "invalid credential" };
}

function snapshotOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("gateway options are required");
  const gatewayApiBase = validateGatewayApiBase(input.gatewayApiBase, { allowInsecureLoopback: input.allowInsecureLoopback === true });
  const parsedBase = new URL(gatewayApiBase);
  const credentialPath = exactPath(input.credentialPath ?? "/api/voicecore/llm-credential", "credentialPath");
  const credentialSecrets = snapshotSecrets(input.credentialSecrets);
  const providers = snapshotProviders(input.providers, input.allowInsecureLoopback === true);
  for (const callback of ["authenticate", "loadEntitlement", "isCredentialRevoked", "admit", "cancelAdmission", "completeAdmission", "audit"]) {
    if (typeof input[callback] !== "function") throw new TypeError(`${callback} callback is required`);
  }
  if (!Number.isSafeInteger(input.sdkReleaseUnix) || input.sdkReleaseUnix <= 0) throw new TypeError("sdkReleaseUnix is required");
  const limits = Object.freeze({
    maxRequestBodyBytes: boundedInteger(input.limits?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES, 1024, 8 * 1024 * 1024, "maxRequestBodyBytes"),
    maxResponseBytes: boundedInteger(input.limits?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 1024, 128 * 1024 * 1024, "maxResponseBytes"),
    maxSseEventBytes: boundedInteger(input.limits?.maxSseEventBytes ?? DEFAULT_MAX_SSE_EVENT_BYTES, 1024, 2 * 1024 * 1024, "maxSseEventBytes"),
    requestTimeoutMs: boundedInteger(input.limits?.requestTimeoutMs ?? input.limits?.upstreamTimeoutMs ?? DEFAULT_TIMEOUT_MS, 100, 300_000, "requestTimeoutMs"),
    hookTimeoutMs: boundedInteger(input.limits?.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS, 50, 30_000, "hookTimeoutMs"),
    maxConcurrent: boundedInteger(input.limits?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT, 1, 10_000, "maxConcurrent"),
    maxCredentialConcurrent: boundedInteger(input.limits?.maxCredentialConcurrent ?? 32, 1, 10_000, "maxCredentialConcurrent"),
    maxRejectionAuditConcurrent: boundedInteger(input.limits?.maxRejectionAuditConcurrent ?? 16, 1, 1_000, "maxRejectionAuditConcurrent"),
  });
  const nowSeconds = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const randomId = input.randomId ?? randomUUID;
  if (typeof nowSeconds !== "function" || typeof randomId !== "function") throw new TypeError("clock and ID sources must be functions");
  if (typeof input.fetchImpl !== "function" && typeof globalThis.fetch !== "function") throw new TypeError("fetch implementation is required");
  const chatPath = `${parsedBase.pathname.replace(/\/$/u, "")}/chat/completions`;
  if (credentialPath === chatPath) throw new TypeError("credentialPath must differ from the gateway chat path");
  return Object.freeze({
    gatewayApiBase,
    origin: parsedBase.origin,
    chatPath,
    credentialPath,
    credentialSecrets,
    credentialTtlSeconds: boundedInteger(input.credentialTtlSeconds ?? 300, 60, 900, "credentialTtlSeconds"),
    sdkReleaseUnix: input.sdkReleaseUnix,
    allowInsecureLoopback: input.allowInsecureLoopback === true,
    providers,
    authenticate: input.authenticate,
    loadEntitlement: input.loadEntitlement,
    isCredentialRevoked: input.isCredentialRevoked,
    admit: input.admit,
    cancelAdmission: input.cancelAdmission,
    completeAdmission: input.completeAdmission,
    audit: input.audit,
    fetchImpl: input.fetchImpl ?? globalThis.fetch,
    nowSeconds,
    randomId,
    limits,
  });
}

function snapshotProviders(input, allowInsecureLoopback) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("providers must be configured");
  const output = new Map();
  for (const [provider, value] of Object.entries(input)) {
    exactProvider(provider);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("provider configuration is invalid");
    if (typeof value.authorizeModel !== "function" || typeof value.getCredential !== "function") throw new TypeError("provider callbacks are required");
    let apiBase = validateGatewayApiBase(value.apiBase, { allowInsecureLoopback });
    if (apiBase.endsWith("/chat/completions")) throw new TypeError("provider apiBase must not include chat/completions");
    output.set(provider, Object.freeze({
      apiBase,
      authorizeModel: value.authorizeModel,
      getCredential: value.getCredential,
      allowUnauthenticated: value.allowUnauthenticated === true,
    }));
  }
  if (output.size === 0 || output.size > PROVIDERS.size) throw new TypeError("providers must contain 1-5 entries");
  return output;
}

function snapshotSecrets(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 4) throw new TypeError("credentialSecrets must contain 1-4 secrets");
  const values = input.map((value) => {
    if (typeof value !== "string" || Buffer.byteLength(value) < 32 || value.trim() !== value) throw new TypeError("credential secret is invalid");
    return value;
  });
  if (new Set(values).size !== values.length) throw new TypeError("credential secrets must be unique");
  return Object.freeze(values);
}

function snapshotIdentity(input) {
  const record = snapshotExactRecord(input, IDENTITY_KEYS, "identity", { optional: new Set(["workspace_id", "app_id"]) });
  return Object.freeze({
    subject: exactIdentifier(record.subject, "subject"),
    workspace_id: record.workspace_id === undefined ? undefined : exactIdentifier(record.workspace_id, "workspace_id"),
    app_id: record.app_id === undefined ? undefined : exactIdentifier(record.app_id, "app_id"),
  });
}

function nextId(config) {
  return exactIdentifier(config.randomId(), "request_id");
}

function snapshotEntitlement(input) {
  const record = snapshotExactRecord(input, ENTITLEMENT_KEYS, "entitlement");
  if (typeof record.revoked !== "boolean") throw new TypeError("entitlement revoked state must be boolean");
  return Object.freeze(record);
}

function snapshotAdmission(input) {
  if (input !== true) throw new GatewayError(503, "admission_unavailable");
  return true;
}

async function acquireAdmission(config, context, deadline) {
  const pending = Promise.resolve().then(() => config.admit(context));
  const callDeadline = Math.min(deadline, Date.now() + config.limits.hookTimeoutMs);
  try {
    return snapshotAdmission(await awaitDeadline(pending, callDeadline, new GatewayError(503, "admission_unavailable")));
  } catch {
    await requestAdmissionCancellation(config, context.request_id, "admission_failed");
    void pending.catch(() => undefined);
    throw new GatewayError(503, "admission_unavailable");
  }
}

async function requestAdmissionCancellation(config, requestId, reason) {
  const cancellation = Object.freeze({ request_id: requestId, reason });
  const attempt = async () => {
    const deadline = Date.now() + config.limits.hookTimeoutMs;
    await trustedCall(config.cancelAdmission, cancellation, deadline, config.limits.hookTimeoutMs);
  };
  try {
    await attempt();
  } catch {
    void (async () => {
      for (let retry = 0; retry < 2; retry += 1) {
        try { await attempt(); return; } catch {}
      }
    })();
  }
}

async function requestTerminalCompletion(config, context, outcome, usage) {
  const completion = Object.freeze({
    request_id: context.request_id,
    outcome,
    usage,
    subject: context.subject,
    workspace_id: context.workspace_id,
    license_id: context.license_id,
    customer_id: context.customer_id,
    provider: context.provider,
    model: context.model,
  });
  const completionEvent = Object.freeze({
    type: "request_completed",
    event_id: `${context.request_id}:completed`,
    ...completion,
    occurred_at: config.nowSeconds(),
  });
  let auditSucceeded = false;
  let auditInFlight = null;
  const auditEventually = () => {
    if (auditSucceeded) return Promise.resolve();
    if (auditInFlight) return auditInFlight;
    auditInFlight = (async () => {
      for (let attemptNumber = 0; attemptNumber < 3 && !auditSucceeded; attemptNumber += 1) {
        const pending = Promise.resolve().then(() => config.audit(completionEvent));
        void pending.then(() => { auditSucceeded = true; }).catch(() => undefined);
        const deadline = Date.now() + config.limits.hookTimeoutMs;
        try {
          await awaitDeadline(pending, deadline, new GatewayError(503, "audit_unavailable"));
          auditSucceeded = true;
        } catch {}
      }
    })().finally(() => { auditInFlight = null; });
    return auditInFlight;
  };
  const attempt = async () => {
    const pending = Promise.resolve().then(() => config.completeAdmission(completion));
    void pending.then(auditEventually).catch(() => undefined);
    const deadline = Date.now() + config.limits.hookTimeoutMs;
    await awaitDeadline(pending, deadline, new GatewayError(503, "completion_unavailable"));
  };
  try {
    await attempt();
  } catch {
    void (async () => {
      for (let retry = 0; retry < 2; retry += 1) {
        try { await attempt(); return; } catch {}
      }
    })();
  }
}

function snapshotExactRecord(input, allowed, label, { optional = new Set() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new GatewayError(400, `invalid_${label.replaceAll(" ", "_")}`);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) || [...allowed].some((key) => !optional.has(key) && !keys.includes(key))) {
    throw new GatewayError(400, `invalid_${label.replaceAll(" ", "_")}`);
  }
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) throw new GatewayError(400, `invalid_${label.replaceAll(" ", "_")}`);
    output[key] = descriptor.value;
  }
  return output;
}

async function loadProviderCredential(route, context, deadline, hookTimeoutMs) {
  const value = await trustedCall(route.getCredential, context, deadline, hookTimeoutMs);
  if (value === null && route.allowUnauthenticated) return null;
  if (typeof value !== "string" || !value || value.trim() !== value || Buffer.byteLength(value) > MAX_CREDENTIAL_BYTES || /[\r\n]/u.test(value)) {
    throw new GatewayError(503, "provider_credential_unavailable");
  }
  return value;
}

async function trustedBoolean(callback, value, deadline, hookTimeoutMs) {
  const result = await trustedCall(callback, value, deadline, hookTimeoutMs);
  if (typeof result !== "boolean") throw new GatewayError(503, "policy_unavailable");
  return result;
}

async function trustedCall(callback, value, deadline, hookTimeoutMs) {
  try {
    const callDeadline = Math.min(deadline, Date.now() + hookTimeoutMs);
    return await awaitDeadline(Promise.resolve().then(() => callback(value)), callDeadline, new GatewayError(503, "policy_unavailable"));
  }
  catch { throw new GatewayError(503, "policy_unavailable"); }
}

async function readJson(request, limit, deadline) {
  const bytes = await readBoundedBytes(request, limit, deadline);
  try { return JSON.parse(Buffer.from(bytes).toString("utf8")); }
  catch { throw new GatewayError(400, "invalid_json"); }
}

async function readBoundedBytes(request, limit, deadline) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > limit)) throw new GatewayError(413, "request_too_large");
  if (!request.body) throw new GatewayError(400, "empty_request");
  const reader = request.body.getReader();
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const next = await awaitDeadline(reader.read(), deadline, new GatewayError(408, "request_timeout"));
      if (next.done) break;
      const part = Buffer.from(next.value);
      total += part.byteLength;
      if (total > limit) throw new GatewayError(413, "request_too_large");
      parts.push(part);
    }
  } catch (error) {
    cancelReader(reader);
    throw error;
  }
  if (total === 0) throw new GatewayError(400, "empty_request");
  return Buffer.concat(parts, total);
}

function cancelBody(body) {
  if (!body) return;
  try { void body.cancel().catch(() => undefined); } catch {}
}

function cancelReader(reader) {
  try { void reader.cancel().catch(() => undefined); } catch {}
}

function readBearer(headers) {
  const authorization = headers.get("authorization");
  if (!authorization || authorization.includes(",") || !authorization.startsWith("Bearer ")) throw new GatewayError(401, "missing_credential");
  const token = authorization.slice(7);
  if (!token || token.trim() !== token) throw new GatewayError(401, "invalid_credential");
  return token;
}

function requireJsonContentType(request) {
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw new GatewayError(415, "json_required");
}

function normalizeResponseContentType(value) {
  const type = value?.split(";", 1)[0].trim().toLowerCase();
  if (type === "text/event-stream") return "text/event-stream";
  if (type === "application/json") return "application/json";
  return null;
}

function extractSseUsage(buffer) {
  try {
    const data = buffer.toString("utf8").split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!data || data === "[DONE]") return null;
    return normalizeUsage(JSON.parse(data).usage);
  } catch { return null; }
}

function extractJsonUsage(buffer) {
  try { return normalizeUsage(JSON.parse(buffer.toString("utf8")).usage); }
  catch { return null; }
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const output = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0) output[key] = value[key];
  }
  return Object.keys(output).length ? Object.freeze(output) : null;
}

function validateBudget(body) {
  const hasMaxTokens = Object.hasOwn(body, "max_tokens");
  const hasMaxCompletionTokens = Object.hasOwn(body, "max_completion_tokens");
  if (hasMaxTokens && hasMaxCompletionTokens) throw new GatewayError(400, "ambiguous_token_budget");
  const tokenField = hasMaxCompletionTokens ? "max_completion_tokens" : hasMaxTokens ? "max_tokens" : null;
  const maxTokens = tokenField === null ? null : boundedBudgetInteger(body[tokenField], 1, 1_000_000, tokenField);
  const choices = Object.hasOwn(body, "n") ? boundedBudgetInteger(body.n, 1, 128, "n") : 1;
  const bestOf = Object.hasOwn(body, "best_of") ? boundedBudgetInteger(body.best_of, 1, 128, "best_of") : null;
  if (bestOf !== null && bestOf < choices) throw new GatewayError(400, "invalid_best_of");
  const multiplier = Math.max(choices, bestOf ?? choices);
  return Object.freeze({
    maxTokens,
    tokenField,
    choices,
    bestOf,
    estimatedMaxOutputTokens: maxTokens === null ? null : maxTokens * multiplier,
  });
}

function boundedBudgetInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new GatewayError(400, `invalid_${label}`);
  return value;
}

function rejectionContext(claims, reason) {
  return {
    reason,
    token_id: claims.jti,
    subject: claims.sub,
    workspace_id: claims.workspace_id ?? null,
    license_id: claims.license_id,
    customer_id: claims.customer_id,
    provider: claims.provider,
    model: claims.model,
  };
}

async function auditRejection(config, details, deadline) {
  try {
    const auditDeadline = Math.max(deadline, Date.now() + config.limits.hookTimeoutMs);
    await trustedCall(config.audit, Object.freeze({
      type: "request_rejected",
      request_id: nextId(config),
      ...details,
      occurred_at: config.nowSeconds(),
    }), auditDeadline, config.limits.hookTimeoutMs);
  } catch {}
}

function remainingMs(deadline) {
  return Math.max(0, deadline - Date.now());
}

async function awaitDeadline(promise, deadline, timeoutError) {
  const delay = remainingMs(deadline);
  if (delay === 0) throw timeoutError;
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(timeoutError), delay);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function exactProvider(value) {
  const provider = exactIdentifier(value, "provider");
  if (!PROVIDERS.has(provider)) throw new GatewayError(400, "invalid_provider");
  return provider;
}

function exactModel(value) {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,512}$/u.test(value) || value.trim() !== value) throw new GatewayError(400, "invalid_model");
  return value;
}

function exactIdentifier(value, label) {
  if (typeof value !== "string" || !value || value.trim() !== value || Buffer.byteLength(value) > 256 || /[\u0000-\u001f\u007f]/u.test(value)) throw new GatewayError(400, `invalid_${label}`);
  return value;
}

function exactPath(value, label) {
  if (typeof value !== "string" || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/u.test(value) || value.includes("//") || value.endsWith("/")) throw new TypeError(`${label} is invalid`);
  return value;
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} must be ${minimum}-${maximum}`);
  return value;
}

function normalizeUpstreamStatus(value) {
  return Number.isInteger(value) && value >= 400 && value <= 599 ? value : 502;
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function errorResponse(error) {
  if (error instanceof GatewayError) return jsonResponse(error.status, { error: error.code });
  return jsonResponse(500, { error: "internal_error" });
}

class GatewayError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
