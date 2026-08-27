import { describe, expect, test } from 'bun:test';
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';
import worker, { ENTITLEMENT_WEBHOOK_PATH, type EntitlementWorkerEnv } from './worker.ts';

describe('LIC6 entitlement worker production boundary', () => {
  test('uses the single canonical Lemon webhook path', async () => {
    const env = await environment();
    const legacy = await worker.fetch(new Request('https://license.artistos.app/v1/webhooks/lemon-squeezy', {
      method: 'POST',
    }), env);
    expect(ENTITLEMENT_WEBHOOK_PATH).toBe('/v1/webhooks/lemonsqueezy');
    expect(legacy.status).toBe(404);
  });

  test('uses canonical entitlement paths and returns safe correlated failures', async () => {
    const env = await environment();
    const legacy = await worker.fetch(new Request('https://license.artistos.app/v1/activate', { method: 'POST' }), env);
    expect(legacy.status).toBe(404);
    const response = await worker.fetch(new Request('https://license.artistos.app/v1/entitlements/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), env);
    expect(response.status).toBe(400);
    expect(response.headers.get('X-Correlation-ID')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: 'INVALID_REQUEST',
      correlationId: response.headers.get('X-Correlation-ID'),
      safeMessage: expect.any(String),
    });
  });

  test('distinguishes liveness from configured key and D1 readiness', async () => {
    const valid = await environment();
    expect(await responseJson(worker.fetch(new Request('https://license.artistos.app/healthz'), {
      ...valid,
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: '',
    }))).toEqual({ status: 200, body: { ok: true, status: 'live' } });
    expect(await responseJson(worker.fetch(new Request('https://license.artistos.app/readyz'), valid)))
      .toMatchObject({ status: 200, body: {
        ok: true, status: 'ready', environment: 'production', currentKeyId: 'prod-2026-01',
        verificationKeyringFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      } });
    expect((await worker.fetch(new Request('https://license.artistos.app/readyz'), {
      ...valid,
      ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: '',
    })).status).toBe(503);
  });

  test('records the public correlation when an internal request fails', async () => {
    const valid = await environment();
    const prepared: string[] = [];
    const base = readyDatabase();
    const failing = {
      ...base,
      prepare(sql: string) {
        prepared.push(sql);
        const statement = base.prepare(sql);
        if (sql.includes('SELECT key_id, public_key_sha256')) {
          return { ...statement, bind() { return this; }, async all() { throw new Error('signing metadata unavailable'); } };
        }
        return statement;
      },
    } as unknown as D1Database;
    const response = await worker.fetch(new Request('https://license.artistos.app/v1/entitlements/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: 'LICENSE-1234' }),
    }), { ...valid, DB: failing });
    const body = await response.json() as { correlationId: string };
    const headerCorrelationId = response.headers.get('X-Correlation-ID');
    expect(response.status).toBe(503);
    expect(headerCorrelationId).not.toBeNull();
    expect(body.correlationId).toBe(headerCorrelationId!);
    expect(prepared.some((sql) => sql.includes('INSERT INTO operational_audit'))).toBe(true);
  });
});

async function environment(): Promise<EntitlementWorkerEnv> {
  const keys = await generateKeyPair('EdDSA', { extractable: true });
  return {
    DB: readyDatabase(),
    ARTIST_OS_LICENSE_ENVIRONMENT: 'production',
    LEMON_STORE_ID: '1',
    LEMON_PRODUCT_ID: '2',
    LEMON_VARIANT_ID_BASIC_V1: 'disabled',
    LEMON_VARIANT_ID_PREMIUM_V1: '4',
    LEMON_API_KEY: 'production-api-key',
    LEMON_WEBHOOK_SECRET: 'production-webhook-secret',
    ARTIST_OS_ENTITLEMENT_KEY_ID_CURRENT: 'prod-2026-01',
    ARTIST_OS_ENTITLEMENT_SIGNING_KEY_CURRENT: await exportPKCS8(keys.privateKey),
    ARTIST_OS_ENTITLEMENT_VERIFICATION_KEYS_JSON: JSON.stringify({
      'prod-2026-01': await exportJWK(keys.publicKey),
    }),
  };
}

function readyDatabase(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('SELECT 1 AS ready')) return { ready: 1 };
          if (sql.includes('RETURNING request_count')) return { request_count: 1 };
          return null;
        },
        async run() { return { success: true, meta: { changes: 1 } }; },
        async all() { return { success: true, results: [] }; },
      };
    },
    async batch(statements: D1PreparedStatement[]) {
      return statements.map(() => ({ success: true, meta: { changes: 1 } })) as D1Result[];
    },
  } as unknown as D1Database;
}

async function responseJson(response: Promise<Response>): Promise<{ status: number; body: unknown }> {
  const resolved = await response;
  return { status: resolved.status, body: await resolved.json() };
}
