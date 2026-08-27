export interface WebhookLifecycleRecord {
  environment: 'test' | 'production';
  vendorLicenseId: string | null;
  vendorOrderId: string | null;
  status: string;
  vendorUpdatedAt: string;
  eventDigest: string;
  updatedAt: string;
}

export interface WebhookInboxStore {
  getResult(eventIdentity: string): Promise<'APPLIED' | 'STALE' | null>;
  record(input: {
    eventIdentity: string;
    environment: 'test' | 'production';
    eventName: string;
    bodySha256: string;
    lifecycle: WebhookLifecycleRecord;
    receivedAt: string;
  }): Promise<'APPLIED' | 'STALE'>;
}

export interface ProcessWebhookInput {
  rawBody: Uint8Array;
  signatureHex: string | null;
  eventName: string | null;
  secret: string;
  environment: 'test' | 'production';
  expectedStoreId: string;
  store: WebhookInboxStore;
  now?: Date;
}

export type ProcessWebhookResult =
  | { ok: true; result: 'APPLIED' | 'STALE' | 'REPLAY' }
  | { ok: false; code: 'INVALID_SIGNATURE' | 'INVALID_EVENT' | 'WRONG_ENVIRONMENT' };

export async function processLemonWebhook(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
  if (!input.eventName || !isSupportedEventName(input.eventName)) return { ok: false, code: 'INVALID_EVENT' };
  if (!await verifyHmac(input.rawBody, input.signatureHex, input.secret)) return { ok: false, code: 'INVALID_SIGNATURE' };
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody));
  } catch {
    return { ok: false, code: 'INVALID_EVENT' };
  }
  const parsed = parseLifecycle(input.eventName, payload, input.expectedStoreId);
  if (!parsed) return { ok: false, code: 'INVALID_EVENT' };
  if (parsed.testMode !== (input.environment === 'test')) return { ok: false, code: 'WRONG_ENVIRONMENT' };
  const bodySha256 = await sha256Hex(input.rawBody);
  const eventIdentity = `${input.environment}:${input.eventName}:${bodySha256}`;
  if (await input.store.getResult(eventIdentity)) return { ok: true, result: 'REPLAY' };
  const now = (input.now ?? new Date()).toISOString();
  const result = await input.store.record({
    eventIdentity,
    environment: input.environment,
    eventName: input.eventName,
    bodySha256,
    lifecycle: {
      environment: input.environment,
      vendorLicenseId: parsed.vendorLicenseId,
      vendorOrderId: parsed.vendorOrderId,
      status: parsed.status,
      vendorUpdatedAt: parsed.vendorUpdatedAt,
      eventDigest: bodySha256,
      updatedAt: now,
    },
    receivedAt: now,
  });
  return { ok: true, result };
}

export class D1WebhookInboxStore implements WebhookInboxStore {
  constructor(private readonly db: D1Database) {}

  async getResult(eventIdentity: string): Promise<'APPLIED' | 'STALE' | null> {
    const row = await this.db.prepare('SELECT result FROM webhook_inbox WHERE event_identity = ?').bind(eventIdentity).first<{ result: string }>();
    return row?.result === 'APPLIED' || row?.result === 'STALE' ? row.result : null;
  }

  async record(input: {
    eventIdentity: string; environment: 'test' | 'production'; eventName: string; bodySha256: string;
    lifecycle: WebhookLifecycleRecord; receivedAt: string;
  }): Promise<'APPLIED' | 'STALE'> {
    const statements = [
      this.db.prepare(`
      INSERT OR IGNORE INTO webhook_inbox (
        event_identity, environment, event_name, body_sha256, vendor_license_id, vendor_order_id,
        vendor_updated_at, result, received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.eventIdentity, input.environment, input.eventName, input.bodySha256,
      input.lifecycle.vendorLicenseId, input.lifecycle.vendorOrderId,
      input.lifecycle.vendorUpdatedAt, 'STALE', input.receivedAt,
    ),
    ];
    if (input.lifecycle.vendorLicenseId) {
      statements.push(this.db.prepare(`
      INSERT INTO license_lifecycle (
        environment, vendor_license_id, vendor_order_id, status, vendor_updated_at, event_digest, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(environment, vendor_license_id) DO UPDATE SET
        vendor_order_id=COALESCE(excluded.vendor_order_id, license_lifecycle.vendor_order_id),
        status=excluded.status, vendor_updated_at=excluded.vendor_updated_at,
        event_digest=excluded.event_digest, updated_at=excluded.updated_at
      WHERE excluded.vendor_updated_at > license_lifecycle.vendor_updated_at
         OR (excluded.vendor_updated_at = license_lifecycle.vendor_updated_at
             AND excluded.event_digest > license_lifecycle.event_digest)
    `).bind(
      input.environment, input.lifecycle.vendorLicenseId, input.lifecycle.vendorOrderId, input.lifecycle.status,
      input.lifecycle.vendorUpdatedAt, input.lifecycle.eventDigest, input.lifecycle.updatedAt,
    ));
    }
    statements.push(...this.authorityStatements(input.lifecycle));
    await this.db.batch(statements);
    const result = input.lifecycle.vendorLicenseId
      ? await this.currentLifecycleResult(input.environment, input.lifecycle.vendorLicenseId, input.lifecycle.eventDigest)
      : input.lifecycle.vendorOrderId
        ? await this.currentOrderLifecycleResult(input.environment, input.lifecycle.vendorOrderId, input.lifecycle.eventDigest)
        : 'STALE';
    await this.db.prepare('UPDATE webhook_inbox SET result = ? WHERE event_identity = ?')
      .bind(result, input.eventIdentity).run();
    return result;
  }

  private async currentLifecycleResult(
    environment: 'test' | 'production',
    vendorLicenseId: string,
    eventDigest: string,
  ): Promise<'APPLIED' | 'STALE'> {
    const current = await this.db.prepare(`
      SELECT event_digest FROM license_lifecycle
      WHERE environment = ? AND vendor_license_id = ?
    `).bind(environment, vendorLicenseId).first<{ event_digest: string }>();
    return current?.event_digest === eventDigest ? 'APPLIED' : 'STALE';
  }

  private async currentOrderLifecycleResult(
    environment: 'test' | 'production',
    vendorOrderId: string,
    eventDigest: string,
  ): Promise<'APPLIED' | 'STALE'> {
    const current = await this.db.prepare(`
      SELECT event_digest FROM order_lifecycle
      WHERE environment = ? AND vendor_order_id = ?
    `).bind(environment, vendorOrderId).first<{ event_digest: string }>();
    return current?.event_digest === eventDigest ? 'APPLIED' : 'STALE';
  }

  private authorityStatements(lifecycle: WebhookLifecycleRecord): D1PreparedStatement[] {
    if (lifecycle.vendorLicenseId) {
      return [this.db.prepare(`
        UPDATE activation_bindings
        SET vendor_order_id = COALESCE(NULLIF(vendor_order_id, ''), ?),
        status = CASE WHEN ? = 'active' AND NOT EXISTS (
          SELECT 1 FROM order_lifecycle orders
          WHERE orders.environment = activation_bindings.environment
            AND orders.vendor_order_id = COALESCE(NULLIF(activation_bindings.vendor_order_id, ''), ?)
            AND orders.status IN ('refunded', 'partial_refund', 'fraudulent')
        ) THEN 'active' ELSE 'revoked' END,
        updated_at = ?
        WHERE environment = ? AND vendor_license_id = ?
          AND EXISTS (
            SELECT 1 FROM license_lifecycle licenses
            WHERE licenses.environment = activation_bindings.environment
              AND licenses.vendor_license_id = activation_bindings.vendor_license_id
              AND licenses.event_digest = ?
          )
      `).bind(lifecycle.vendorOrderId, lifecycle.status, lifecycle.vendorOrderId,
        lifecycle.updatedAt, lifecycle.environment, lifecycle.vendorLicenseId, lifecycle.eventDigest)];
    }
    if (lifecycle.vendorOrderId && isOrderStatus(lifecycle.status)) {
      return [
        this.db.prepare(`
          INSERT INTO order_lifecycle (
            environment, vendor_order_id, status, vendor_updated_at, event_digest, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(environment, vendor_order_id) DO UPDATE SET
            status=excluded.status, vendor_updated_at=excluded.vendor_updated_at,
            event_digest=excluded.event_digest, updated_at=excluded.updated_at
          WHERE excluded.vendor_updated_at > order_lifecycle.vendor_updated_at
             OR (excluded.vendor_updated_at = order_lifecycle.vendor_updated_at
                 AND CASE excluded.status
                   WHEN 'fraudulent' THEN 5 WHEN 'refunded' THEN 4 WHEN 'partial_refund' THEN 3
                   WHEN 'paid' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END
                   > CASE order_lifecycle.status
                   WHEN 'fraudulent' THEN 5 WHEN 'refunded' THEN 4 WHEN 'partial_refund' THEN 3
                   WHEN 'paid' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END)
             OR (excluded.vendor_updated_at = order_lifecycle.vendor_updated_at
                 AND excluded.status = order_lifecycle.status
                 AND excluded.event_digest > order_lifecycle.event_digest)
        `).bind(lifecycle.environment, lifecycle.vendorOrderId, lifecycle.status,
          lifecycle.vendorUpdatedAt, lifecycle.eventDigest, lifecycle.updatedAt),
        this.db.prepare(`
          UPDATE activation_bindings SET status='revoked', updated_at=?
          WHERE environment=? AND vendor_order_id=?
            AND ? IN ('refunded', 'partial_refund', 'fraudulent')
            AND EXISTS (
              SELECT 1 FROM order_lifecycle orders
              WHERE orders.environment=activation_bindings.environment
                AND orders.vendor_order_id=activation_bindings.vendor_order_id
                AND orders.event_digest=?
            )
        `).bind(lifecycle.updatedAt, lifecycle.environment,
          lifecycle.vendorOrderId, lifecycle.status, lifecycle.eventDigest),
      ];
    }
    return [this.db.prepare('SELECT 1')];
  }
}

async function verifyHmac(body: Uint8Array, signatureHex: string | null, secret: string): Promise<boolean> {
  if (!signatureHex || !/^[0-9a-f]{64}$/i.test(signatureHex) || secret.length < 16) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, body));
  const actual = Uint8Array.from(signatureHex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  let difference = expected.length ^ actual.length;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index]! ^ (actual[index] ?? 0);
  return difference === 0;
}

function parseLifecycle(
  eventName: string,
  input: unknown,
  expectedStoreId: string,
): { vendorLicenseId: string | null; vendorOrderId: string | null; status: string; vendorUpdatedAt: string; testMode: boolean } | null {
  if (!isRecord(input) || !isRecord(input.meta) || !isRecord(input.data) || !isRecord(input.data.attributes)) return null;
  const testMode = input.meta.test_mode;
  if (typeof testMode !== 'boolean' || input.meta.event_name !== eventName
    || String(input.data.attributes.store_id) !== expectedStoreId) return null;
  if (/^license_key_(created|updated)$/.test(eventName)) {
    const id = input.data.id;
    const status = input.data.attributes.status;
    const updatedAt = input.data.attributes.updated_at;
    const orderId = input.data.attributes.order_id;
    if (typeof id !== 'string' || !/^\d+$/.test(id) || !isLifecycleStatus(status)
      || !isStrictUtc(updatedAt) || !isPositiveId(orderId)) return null;
    return { vendorLicenseId: id, vendorOrderId: String(orderId), status, vendorUpdatedAt: updatedAt, testMode };
  }
  if (eventName === 'order_created' || eventName === 'order_refunded') {
    const orderId = input.data.id;
    const status = input.data.attributes.status;
    const updatedAt = input.data.attributes.updated_at;
    if (typeof orderId !== 'string' || !/^\d+$/.test(orderId) || !isOrderStatus(status) || !isStrictUtc(updatedAt)) return null;
    return { vendorLicenseId: null, vendorOrderId: orderId, status, vendorUpdatedAt: updatedAt, testMode };
  }
  return null;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isLifecycleStatus(value: unknown): value is string {
  return value === 'inactive' || value === 'active' || value === 'expired' || value === 'disabled';
}

function isOrderStatus(value: unknown): value is string {
  return value === 'pending' || value === 'failed' || value === 'paid'
    || value === 'refunded' || value === 'partial_refund' || value === 'fraudulent';
}

function isPositiveId(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isInteger(value) && value > 0)
    || (typeof value === 'string' && /^[1-9]\d*$/.test(value));
}

function isSupportedEventName(value: string): boolean {
  return /^license_key_(created|updated)$/.test(value) || value === 'order_created' || value === 'order_refunded';
}

function isStrictUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const fraction = value.match(/\.(\d{1,6})Z$/)?.[1] ?? '';
  const milliseconds = fraction.padEnd(3, '0').slice(0, 3);
  const normalized = value.replace(/(?:\.\d{1,6})?Z$/, `.${milliseconds}Z`);
  return new Date(parsed).toISOString() === normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
