import { readEntitlementServiceConfig } from './config.ts';
import { D1EntitlementStore } from './d1-store.ts';
import { entitlementVerificationKeyringFingerprint, loadEntitlementSigningMaterial } from './keys.ts';
import { LemonSqueezyLicenseVendor } from './lemon-vendor.ts';
import {
  consumeRequestLimits,
  deriveRequestAuthority,
  recordOperationalAudit,
  syncSigningKeyMetadata,
  type EntitlementAction,
} from './operational-controls.ts';
import { EntitlementService } from './service.ts';
import { D1WebhookInboxStore, processLemonWebhook } from './webhook.ts';

export interface EntitlementWorkerEnv {
  DB: D1Database;
  ARTIST_OS_LICENSE_ENVIRONMENT: string;
  LEMON_STORE_ID: string;
  LEMON_PRODUCT_ID: string;
  LEMON_VARIANT_ID_BASIC_V1: string;
  LEMON_VARIANT_ID_PREMIUM_V1: string;
  LEMON_API_KEY: string;
  LEMON_WEBHOOK_SECRET: string;
  ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: string;
  ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: string;
  ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: string;
}

const JSON_LIMIT = 32 * 1024;
const WEBHOOK_LIMIT = 256 * 1024;
export const ENTITLEMENT_WEBHOOK_PATH = '/v1/webhooks/lemonsqueezy';

export default {
  async fetch(request: Request, env: EntitlementWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json({ ok: true, status: 'live' }, 200);
    }
    const configResult = readEntitlementServiceConfig({
      ARTIST_OS_LICENSE_ENVIRONMENT: env.ARTIST_OS_LICENSE_ENVIRONMENT,
      LEMON_STORE_ID: env.LEMON_STORE_ID,
      LEMON_PRODUCT_ID: env.LEMON_PRODUCT_ID,
      LEMON_VARIANT_ID_BASIC_V1: env.LEMON_VARIANT_ID_BASIC_V1,
      LEMON_VARIANT_ID_PREMIUM_V1: env.LEMON_VARIANT_ID_PREMIUM_V1,
      LEMON_API_KEY: env.LEMON_API_KEY,
      LEMON_WEBHOOK_SECRET: env.LEMON_WEBHOOK_SECRET,
      ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: env.ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT,
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: env.ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT,
      ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: env.ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON,
    });
    if (!configResult.ok) {
      return actionForPath(url.pathname)
        ? publicFailure('SERVICE_UNAVAILABLE', true, crypto.randomUUID(), 503)
        : json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, 503);
    }
    const config = configResult.config;

    if (request.method === 'GET' && url.pathname === '/readyz') {
      try {
        const material = await loadEntitlementSigningMaterial(config);
        await syncSigningKeyMetadata(env.DB, config);
        const database = await env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>();
        if (database?.ready !== 1) throw new Error('D1 readiness probe failed');
        return json({
          ok: true,
          status: 'ready',
          environment: config.environment,
          currentKeyId: material.currentKeyId,
          verificationKeyringFingerprint: await entitlementVerificationKeyringFingerprint(config.verificationKeysJson),
        }, 200);
      } catch {
        return json({ ok: false, code: 'SERVICE_UNAVAILABLE' }, 503);
      }
    }

    if (request.method === 'POST' && url.pathname === ENTITLEMENT_WEBHOOK_PATH) {
      const rawBody = await readBoundedBody(request, WEBHOOK_LIMIT);
      if (!rawBody) return json({ ok: false, code: 'INVALID_EVENT' }, 400);
      const result = await processLemonWebhook({
        rawBody,
        signatureHex: request.headers.get('X-Signature'),
        eventName: request.headers.get('X-Event-Name'),
        secret: config.lemonWebhookSecret,
        environment: config.environment,
        expectedStoreId: config.lemonStoreId,
        store: new D1WebhookInboxStore(env.DB),
      });
      return json(result, result.ok ? 200 : 401);
    }

    const action = actionForPath(url.pathname);
    if (request.method !== 'POST' || action === null) {
      return json({ ok: false, code: 'NOT_FOUND' }, 404);
    }
    const body = await readJson(request, JSON_LIMIT);
    const authority = await deriveRequestAuthority(request, body);
    try {
      if (!await consumeRequestLimits(env.DB, config.environment, action, authority)) {
        await recordOperationalAudit(env.DB, config.environment, action, 'RATE_LIMITED', authority);
        return publicFailure('RATE_LIMITED', true, authority.correlationId, 429);
      }
      if (body === null) {
        await recordOperationalAudit(env.DB, config.environment, action, 'INVALID_REQUEST', authority);
        return publicFailure('INVALID_REQUEST', false, authority.correlationId, 400);
      }
      const material = await loadEntitlementSigningMaterial(config);
      await syncSigningKeyMetadata(env.DB, config);
      const service = new EntitlementService({
        environment: config.environment,
        storeId: config.lemonStoreId,
        productId: config.lemonProductId,
        variantIds: config.lemonVariantIdBasicV1
          ? { basic: config.lemonVariantIdBasicV1, premium: config.lemonVariantIdPremiumV1 }
          : { premium: config.lemonVariantIdPremiumV1 },
        store: new D1EntitlementStore(env.DB),
        vendor: new LemonSqueezyLicenseVendor(config.lemonApiKey),
        signingKeyId: material.currentKeyId,
        signingPrivateKey: material.currentPrivateKey,
        verificationKeyring: material.verificationKeyring,
      });
      const result = action === 'activate'
        ? await service.activate(body)
        : action === 'validate'
          ? await service.validate(body)
          : await service.deactivate(body);
      await recordOperationalAudit(env.DB, config.environment, action, result.ok ? 'SUCCEEDED' : result.code, authority);
      return result.ok
        ? json(result, 200, authority.correlationId)
        : publicFailure(result.code, result.retryable, authority.correlationId, httpStatus(result.code));
    } catch {
      try {
        await recordOperationalAudit(env.DB, config.environment, action, 'SERVICE_UNAVAILABLE', authority);
      } catch {
        // The public response stays safe even when the audit store itself is unavailable.
      }
      return publicFailure('SERVICE_UNAVAILABLE', true, authority.correlationId, 503);
    }
  },
};

async function readJson(request: Request, limit: number): Promise<unknown | null> {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return null;
  const bytes = await readBoundedBody(request, limit);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(next.value);
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function httpStatus(code: string): number {
  if (code === 'SEAT_LIMIT_REACHED') return 409;
  if (code === 'RATE_LIMITED') return 429;
  if (code === 'SERVICE_UNAVAILABLE') return 503;
  if (code === 'INTERNAL_ERROR') return 500;
  return 400;
}

function actionForPath(path: string): EntitlementAction | null {
  if (path === '/v1/entitlements/activate') return 'activate';
  if (path === '/v1/entitlements/validate') return 'validate';
  if (path === '/v1/entitlements/deactivate') return 'deactivate';
  return null;
}

function publicFailure(code: string, retryable: boolean, correlationId: string, status: number): Response {
  return json({
    ok: false,
    schemaVersion: 1,
    code,
    retryable,
    correlationId,
    safeMessage: safeMessage(code),
  }, status, correlationId);
}

function safeMessage(code: string): string {
  if (code === 'SEAT_LIMIT_REACHED') return 'All licensed installations are already in use.';
  if (code === 'RATE_LIMITED') return 'Too many license requests. Wait a moment and try again.';
  if (code === 'SERVICE_UNAVAILABLE') return 'The license service is temporarily unavailable.';
  if (code === 'LICENSE_DISABLED') return 'This purchase is no longer active.';
  return 'The license request could not be completed.';
}

function json(body: unknown, status: number, correlationId?: string): Response {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      ...(correlationId ? { 'X-Correlation-ID': correlationId } : {}),
    },
  });
}
