import { describe, expect, test } from 'bun:test';
import { processLemonWebhook, type WebhookInboxStore, type WebhookLifecycleRecord } from './webhook.ts';

describe('LIC2 Lemon webhook authority', () => {
  test('verifies raw bytes, deduplicates replay, and refuses stale overwrite', async () => {
    const store = new MemoryWebhookStore();
    const secret = 'test-webhook-secret-at-least-16';
    const newer = body('2026-08-22T18:00:00.000Z', 'disabled');
    const older = body('2026-08-22T17:00:00.000Z', 'active');
    expect(await process(newer, secret, store)).toEqual({ ok: true, result: 'APPLIED' });
    expect(await process(newer, secret, store)).toEqual({ ok: true, result: 'REPLAY' });
    expect(await process(older, secret, store)).toEqual({ ok: true, result: 'STALE' });
    expect(store.lifecycle?.status).toBe('disabled');
  });

  test('rejects modified bodies and wrong environment', async () => {
    const store = new MemoryWebhookStore();
    const secret = 'test-webhook-secret-at-least-16';
    const rawBody = body('2026-08-22T18:00:00.000Z', 'active');
    const signatureHex = await hmac(rawBody, secret);
    const modified = new TextEncoder().encode(`${new TextDecoder().decode(rawBody)} `);
    expect(await processLemonWebhook({ rawBody: modified, signatureHex, eventName: 'license_key_updated', secret, environment: 'test', expectedStoreId: '1', store })).toEqual({ ok: false, code: 'INVALID_SIGNATURE' });
    expect(await processLemonWebhook({ rawBody, signatureHex, eventName: 'license_key_updated', secret, environment: 'production', expectedStoreId: '1', store })).toEqual({ ok: false, code: 'WRONG_ENVIRONMENT' });
  });

  test('accepts refund lifecycle events and projects order identity for revocation', async () => {
    const store = new MemoryWebhookStore();
    const secret = 'test-webhook-secret-at-least-16';
    const rawBody = orderRefundBody('2026-08-22T18:00:00.000Z');
    expect(await processLemonWebhook({
      rawBody,
      signatureHex: await hmac(rawBody, secret),
      eventName: 'order_refunded',
      secret,
      environment: 'test',
      expectedStoreId: '1',
      store,
    })).toEqual({ ok: true, result: 'APPLIED' });
    expect(store.lifecycle).toMatchObject({
      vendorLicenseId: null,
      vendorOrderId: '9001',
      status: 'refunded',
    });
  });

  test('accepts Lemon microsecond timestamps without weakening UTC validation', async () => {
    const store = new MemoryWebhookStore();
    const secret = 'test-webhook-secret-at-least-16';
    const rawBody = body('2026-08-22T18:00:00.000000Z', 'active');
    expect(await processLemonWebhook({
      rawBody,
      signatureHex: await hmac(rawBody, secret),
      eventName: 'license_key_updated',
      secret,
      environment: 'test',
      expectedStoreId: '1',
      store,
    })).toEqual({ ok: true, result: 'APPLIED' });

    const invalid = body('2026-08-22T18:00:00.0000000Z', 'active');
    expect(await processLemonWebhook({
      rawBody: invalid,
      signatureHex: await hmac(invalid, secret),
      eventName: 'license_key_updated',
      secret,
      environment: 'test',
      expectedStoreId: '1',
      store,
    })).toEqual({ ok: false, code: 'INVALID_EVENT' });
  });

  test('accepts a fraudulent order projection for durable chargeback revocation', async () => {
    const store = new MemoryWebhookStore();
    const secret = 'test-webhook-secret-at-least-16';
    const rawBody = orderBody('order_created', 'fraudulent', '2026-08-22T18:00:00.000Z');
    expect(await processLemonWebhook({
      rawBody, signatureHex: await hmac(rawBody, secret), eventName: 'order_created',
      secret, environment: 'test', expectedStoreId: '1', store,
    })).toEqual({ ok: true, result: 'APPLIED' });
    expect(store.lifecycle).toMatchObject({ vendorOrderId: '9001', status: 'fraudulent' });
  });

  test('rejects a signed event when the payload event or store does not match the route authority', async () => {
    const store = new MemoryWebhookStore();
    const secret = 'test-webhook-secret-at-least-16';
    const wrongEvent = new TextEncoder().encode(JSON.stringify({
      meta: { test_mode: true, event_name: 'license_key_created' },
      data: { id: '1234', attributes: { store_id: 1, order_id: 9001, status: 'active', updated_at: '2026-08-22T18:00:00.000Z' } },
    }));
    expect(await processLemonWebhook({
      rawBody: wrongEvent, signatureHex: await hmac(wrongEvent, secret), eventName: 'license_key_updated',
      secret, environment: 'test', expectedStoreId: '1', store,
    })).toEqual({ ok: false, code: 'INVALID_EVENT' });
    const wrongStore = body('2026-08-22T18:00:00.000Z', 'active', 2);
    expect(await processLemonWebhook({
      rawBody: wrongStore, signatureHex: await hmac(wrongStore, secret), eventName: 'license_key_updated',
      secret, environment: 'test', expectedStoreId: '1', store,
    })).toEqual({ ok: false, code: 'INVALID_EVENT' });
  });
});

class MemoryWebhookStore implements WebhookInboxStore {
  readonly results = new Map<string, 'APPLIED' | 'STALE'>();
  lifecycle: WebhookLifecycleRecord | null = null;

  async getResult(identity: string) { return this.results.get(identity) ?? null; }

  async record(input: { eventIdentity: string; lifecycle: WebhookLifecycleRecord }): Promise<'APPLIED' | 'STALE'> {
    const applies = !this.lifecycle
      || input.lifecycle.vendorUpdatedAt > this.lifecycle.vendorUpdatedAt
      || (input.lifecycle.vendorUpdatedAt === this.lifecycle.vendorUpdatedAt && input.lifecycle.eventDigest > this.lifecycle.eventDigest);
    const result = applies ? 'APPLIED' : 'STALE';
    this.results.set(input.eventIdentity, result);
    if (applies) this.lifecycle = input.lifecycle;
    return result;
  }
}

function body(updatedAt: string, status: string, storeId = 1): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    meta: { test_mode: true, event_name: 'license_key_updated' },
    data: { id: '1234', attributes: { store_id: storeId, order_id: 9001, status, updated_at: updatedAt } },
  }));
}

function orderRefundBody(updatedAt: string): Uint8Array {
  return orderBody('order_refunded', 'refunded', updatedAt);
}

function orderBody(eventName: string, status: string, updatedAt: string): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    meta: { test_mode: true, event_name: eventName },
    data: { id: '9001', attributes: { store_id: 1, status, updated_at: updatedAt } },
  }));
}

async function process(rawBody: Uint8Array, secret: string, store: WebhookInboxStore) {
  return processLemonWebhook({
    rawBody,
    signatureHex: await hmac(rawBody, secret),
    eventName: 'license_key_updated',
    secret,
    environment: 'test',
    expectedStoreId: '1',
    store,
  });
}

async function hmac(rawBody: Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, rawBody));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
