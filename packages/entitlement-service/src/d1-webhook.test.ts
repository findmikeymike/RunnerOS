import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { D1EntitlementStore } from './d1-store.ts';
import { D1WebhookInboxStore, type WebhookLifecycleRecord } from './webhook.ts';

describe('D1 webhook lifecycle projection', () => {
  test('migrations apply and vendor events revoke without silently reactivating seats', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text());
    sqlite.exec(await Bun.file(new URL('../migrations/0002_order_lifecycle.sql', import.meta.url)).text());
    sqlite.exec(await Bun.file(new URL('../migrations/0003_operational_controls.sql', import.meta.url)).text());
    sqlite.query(`
      INSERT INTO activation_bindings (
        binding_id, environment, license_digest, installation_id, entitlement_id,
        vendor_license_id, vendor_order_id, activation_instance_id, masked_email,
        signed_entitlement, status, last_validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('binding-1', 'test', 'digest', 'installation', 'entitlement', '1234', '9001',
      'instance', 'w***@example.com', 'token', 'active', iso(0), iso(0), iso(0));
    const store = new D1WebhookInboxStore(asD1(sqlite));

    expect(await record(store, lifecycle({ status: 'disabled', vendorUpdatedAt: iso(1), eventDigest: 'b' })))
      .toBe('APPLIED');
    expect(bindingStatus(sqlite)).toBe('revoked');

    expect(await record(store, lifecycle({ status: 'active', vendorUpdatedAt: iso(2), eventDigest: 'c' })))
      .toBe('APPLIED');
    expect(bindingStatus(sqlite)).toBe('active');

    expect(await record(store, lifecycle({
      vendorLicenseId: null, vendorOrderId: '9001', status: 'refunded',
      vendorUpdatedAt: iso(3), eventDigest: 'd',
    }))).toBe('APPLIED');
    expect(bindingStatus(sqlite)).toBe('revoked');

    expect(await record(store, lifecycle({ status: 'active', vendorUpdatedAt: iso(4), eventDigest: 'e' })))
      .toBe('APPLIED');
    expect(bindingStatus(sqlite)).toBe('revoked');

    expect(await record(store, lifecycle({
      vendorLicenseId: null, vendorOrderId: '9001', status: 'partial_refund',
      vendorUpdatedAt: iso(2), eventDigest: 'a',
    }))).toBe('STALE');
    expect(sqlite.query('SELECT status FROM order_lifecycle WHERE vendor_order_id = ?').get('9001'))
      .toEqual({ status: 'refunded' });
  });

  test('license events backfill missing order identity before evaluating refund authority', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text());
    sqlite.exec(await Bun.file(new URL('../migrations/0002_order_lifecycle.sql', import.meta.url)).text());
    sqlite.exec(await Bun.file(new URL('../migrations/0003_operational_controls.sql', import.meta.url)).text());
    sqlite.query(`
      INSERT INTO activation_bindings (
        binding_id, environment, license_digest, installation_id, entitlement_id,
        vendor_license_id, vendor_order_id, activation_instance_id, masked_email,
        signed_entitlement, status, last_validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('binding-2', 'test', 'digest-2', 'installation-2', 'entitlement-2', '2222', '',
      'instance-2', 'w***@example.com', 'token', 'active', iso(0), iso(0), iso(0));
    const store = new D1WebhookInboxStore(asD1(sqlite));

    expect(await record(store, lifecycle({
      vendorLicenseId: null,
      vendorOrderId: '9002',
      status: 'refunded',
      vendorUpdatedAt: iso(1),
      eventDigest: 'f',
    }))).toBe('APPLIED');

    expect(await record(store, lifecycle({
      vendorLicenseId: '2222',
      vendorOrderId: '9002',
      status: 'active',
      vendorUpdatedAt: iso(2),
      eventDigest: 'g',
    }))).toBe('APPLIED');

    expect(sqlite.query('SELECT vendor_order_id, status FROM activation_bindings WHERE binding_id = ?').get('binding-2'))
      .toEqual({ vendor_order_id: '9002', status: 'revoked' });
  });

  test('a refund recorded during activation prevents the active binding from committing', async () => {
    const sqlite = await migratedDatabase();
    const db = asD1(sqlite);
    const webhookStore = new D1WebhookInboxStore(db);
    expect(await record(webhookStore, lifecycle({
      vendorLicenseId: null, vendorOrderId: '9001', status: 'refunded',
      vendorUpdatedAt: iso(3), eventDigest: 'race-refund',
    }))).toBe('APPLIED');
    const store = new D1EntitlementStore(db);
    const begun = await store.beginActivation({
      operationId: 'operation-race', environment: 'test', licenseDigest: 'digest-race',
      installationId: 'installation-race', requestId: 'request-race', leaseToken: 'lease-race',
      now: iso(4), leaseExpiresAt: iso(5),
    });
    expect(begun.ownsLease).toBe(true);
    await expect(store.completeActivation('operation-race', 'lease-race', {
      bindingId: 'binding-race', environment: 'test', licenseDigest: 'digest-race',
      installationId: 'installation-race', entitlementId: 'entitlement-race',
      vendorLicenseId: '1234', vendorOrderId: '9001', activationInstanceId: 'instance-race',
      maskedEmail: 'w***@example.com', signedEntitlement: 'token', status: 'active',
      lastValidatedAt: iso(4), createdAt: iso(4), updatedAt: iso(4),
    }, '{}', iso(4))).rejects.toThrow('Activation operation lease was lost');
    expect(sqlite.query('SELECT binding_id FROM activation_bindings WHERE binding_id = ?').get('binding-race')).toBeNull();
    expect(sqlite.query('SELECT state FROM activation_operations WHERE operation_id = ?').get('operation-race'))
      .toEqual({ state: 'PENDING' });
  });

  test('an online refund observation cannot be overwritten by an in-flight refresh or active webhook', async () => {
    const sqlite = await migratedDatabase();
    sqlite.query(`
      INSERT INTO activation_bindings (
        binding_id, environment, license_digest, installation_id, entitlement_id,
        vendor_license_id, vendor_order_id, activation_instance_id, masked_email,
        signed_entitlement, status, last_validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('binding-online', 'test', 'digest-online', 'installation-online', 'entitlement-online',
      '3333', '9003', 'instance-online', 'w***@example.com', 'token', 'active', iso(0), iso(0), iso(0));
    const db = asD1(sqlite);
    const store = new D1EntitlementStore(db);
    await store.recordOrderLifecycle({
      environment: 'test', vendorOrderId: '9003', status: 'refunded',
      vendorUpdatedAt: iso(3), eventDigest: 'online-refund', updatedAt: iso(4),
    });
    expect(await store.updateBinding({
      bindingId: 'binding-online', environment: 'test', licenseDigest: 'digest-online',
      installationId: 'installation-online', entitlementId: 'entitlement-online',
      vendorLicenseId: '3333', vendorOrderId: '9003', activationInstanceId: 'instance-online',
      maskedEmail: 'w***@example.com', signedEntitlement: 'new-token', status: 'active',
      lastValidatedAt: iso(4), createdAt: iso(0), updatedAt: iso(4),
    }, 'active')).toBe(false);
    await store.updateBinding({
      bindingId: 'binding-online', environment: 'test', licenseDigest: 'digest-online',
      installationId: 'installation-online', entitlementId: 'entitlement-online',
      vendorLicenseId: '3333', vendorOrderId: '9003', activationInstanceId: 'instance-online',
      maskedEmail: 'w***@example.com', signedEntitlement: 'token', status: 'revoked',
      lastValidatedAt: iso(0), createdAt: iso(0), updatedAt: iso(4),
    });
    expect(await record(new D1WebhookInboxStore(db), lifecycle({
      vendorLicenseId: '3333', vendorOrderId: '9003', status: 'active',
      vendorUpdatedAt: iso(5), eventDigest: 'license-active',
    }))).toBe('APPLIED');
    expect(sqlite.query('SELECT status FROM activation_bindings WHERE binding_id = ?').get('binding-online'))
      .toEqual({ status: 'revoked' });
  });
});

function lifecycle(overrides: Partial<WebhookLifecycleRecord>): WebhookLifecycleRecord {
  return {
    environment: 'test', vendorLicenseId: '1234', vendorOrderId: '9001', status: 'active',
    vendorUpdatedAt: iso(0), eventDigest: 'a', updatedAt: iso(4), ...overrides,
  };
}

async function record(store: D1WebhookInboxStore, value: WebhookLifecycleRecord) {
  return store.record({
    eventIdentity: `test:event:${value.eventDigest}`, environment: 'test',
    eventName: value.vendorLicenseId ? 'license_key_updated' : 'order_refunded',
    bodySha256: value.eventDigest.padEnd(64, '0'), lifecycle: value, receivedAt: iso(4),
  });
}

function bindingStatus(sqlite: Database): string | null {
  return (sqlite.query('SELECT status FROM activation_bindings WHERE binding_id = ?').get('binding-1') as { status: string } | null)?.status ?? null;
}

function iso(hour: number): string {
  return `2026-08-22T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

async function migratedDatabase(): Promise<Database> {
  const sqlite = new Database(':memory:');
  sqlite.exec(await Bun.file(new URL('../migrations/0001_initial.sql', import.meta.url)).text());
  sqlite.exec(await Bun.file(new URL('../migrations/0002_order_lifecycle.sql', import.meta.url)).text());
  sqlite.exec(await Bun.file(new URL('../migrations/0003_operational_controls.sql', import.meta.url)).text());
  return sqlite;
}

function asD1(sqlite: Database): D1Database {
  return {
    prepare(sql: string) {
      return prepared(sqlite, sql, []);
    },
    async batch(statements: D1PreparedStatement[]) {
      const run = sqlite.transaction(() => statements.map((statement) => (statement as unknown as LocalStatement).execute()));
      return run() as unknown as D1Result[];
    },
  } as unknown as D1Database;
}

interface LocalStatement {
  bind(...values: unknown[]): LocalStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
  execute(): D1Result;
}

function prepared(sqlite: Database, sql: string, values: unknown[]): D1PreparedStatement & LocalStatement {
  const local: LocalStatement = {
    bind(...next) { return prepared(sqlite, sql, next) as unknown as LocalStatement; },
    async first<T>() { return sqlite.query(sql).get(...values as never[]) as T | null; },
    async run() { return local.execute(); },
    execute() {
      const result = sqlite.query(sql).run(...values as never[]);
      return { success: true, meta: { changes: result.changes } } as unknown as D1Result;
    },
  };
  return local as D1PreparedStatement & LocalStatement;
}
