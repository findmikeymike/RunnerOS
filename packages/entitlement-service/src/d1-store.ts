import type {
  ActivationBindingRecord,
  ActivationOperationRecord,
  BeginActivationResult,
  EntitlementStore,
} from './store.ts';

export class D1EntitlementStore implements EntitlementStore {
  constructor(private readonly db: D1Database) {}

  async beginActivation(input: {
    operationId: string;
    environment: 'test' | 'production';
    licenseDigest: string;
    installationId: string;
    requestId: string;
    leaseToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<BeginActivationResult> {
    await this.db.prepare(`
      INSERT OR IGNORE INTO activation_operations (
        operation_id, environment, license_digest, installation_id, request_id, state,
        lease_token, lease_expires_at, attempt_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, 1, ?, ?)
    `).bind(input.operationId, input.environment, input.licenseDigest, input.installationId, input.requestId, input.leaseToken, input.leaseExpiresAt, input.now, input.now).run();
    await this.db.prepare(`
      UPDATE activation_operations
      SET state = 'PENDING', request_id = ?, lease_token = ?, lease_expires_at = ?,
          response_json = NULL, failure_code = NULL, attempt_count = attempt_count + 1, updated_at = ?
      WHERE operation_id = ?
        AND (((state IN ('PENDING', 'UNCERTAIN')) AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
          OR (state = 'FAILED' AND request_id <> ?)
          OR (state = 'SUCCEEDED' AND request_id <> ? AND NOT EXISTS (
            SELECT 1 FROM activation_bindings bindings
            WHERE bindings.environment = activation_operations.environment
              AND bindings.license_digest = activation_operations.license_digest
              AND bindings.installation_id = activation_operations.installation_id
          )))
    `).bind(
      input.requestId, input.leaseToken, input.leaseExpiresAt, input.now,
      input.operationId, input.now, input.requestId, input.requestId,
    ).run();
    const row = await this.db.prepare('SELECT * FROM activation_operations WHERE operation_id = ?').bind(input.operationId).first<OperationRow>();
    if (!row) throw new Error('Activation operation could not be reserved');
    const operation = operationFromRow(row);
    return { operation, ownsLease: operation.leaseToken === input.leaseToken };
  }

  async getBinding(environment: 'test' | 'production', licenseDigest: string, installationId: string): Promise<ActivationBindingRecord | null> {
    const row = await this.db.prepare(`
      SELECT * FROM activation_bindings
      WHERE environment = ? AND license_digest = ? AND installation_id = ?
    `).bind(environment, licenseDigest, installationId).first<BindingRow>();
    return row ? bindingFromRow(row) : null;
  }

  async completeActivation(operationId: string, leaseToken: string, binding: ActivationBindingRecord, responseJson: string, now: string): Promise<void> {
    const results = await this.db.batch([
      this.db.prepare(`
        INSERT INTO activation_bindings (
          binding_id, environment, license_digest, installation_id, entitlement_id,
          vendor_license_id, vendor_order_id, activation_instance_id, masked_email, signed_entitlement,
          status, last_validated_at, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        FROM activation_operations
        WHERE operation_id = ? AND lease_token = ?
          AND NOT EXISTS (
            SELECT 1 FROM order_lifecycle orders
            WHERE orders.environment = ? AND orders.vendor_order_id = ?
              AND orders.status IN ('refunded', 'partial_refund', 'fraudulent')
          )
        ON CONFLICT(environment, license_digest, installation_id) DO UPDATE SET
          vendor_license_id=excluded.vendor_license_id,
          vendor_order_id=excluded.vendor_order_id,
          activation_instance_id=excluded.activation_instance_id,
          masked_email=excluded.masked_email,
          signed_entitlement=excluded.signed_entitlement,
          status=excluded.status,
          last_validated_at=excluded.last_validated_at,
          updated_at=excluded.updated_at
      `).bind(
        binding.bindingId, binding.environment, binding.licenseDigest, binding.installationId,
        binding.entitlementId, binding.vendorLicenseId, binding.vendorOrderId, binding.activationInstanceId,
        binding.maskedEmail, binding.signedEntitlement, binding.status,
        binding.lastValidatedAt, binding.createdAt, binding.updatedAt,
        operationId, leaseToken, binding.environment, binding.vendorOrderId,
      ),
      this.db.prepare(`
        UPDATE activation_operations
        SET state='SUCCEEDED', response_json=?, failure_code=NULL,
            lease_token=NULL, lease_expires_at=NULL, updated_at=?
        WHERE operation_id=? AND lease_token=?
          AND EXISTS (
            SELECT 1 FROM activation_bindings bindings
            WHERE bindings.environment = activation_operations.environment
              AND bindings.license_digest = activation_operations.license_digest
              AND bindings.installation_id = activation_operations.installation_id
              AND bindings.status = 'active'
          )
      `).bind(responseJson, now, operationId, leaseToken),
    ]);
    if (!results.every((result) => result.success)
      || (results[0]?.meta.changes ?? 0) !== 1
      || (results[1]?.meta.changes ?? 0) !== 1) {
      throw new Error('Activation operation lease was lost');
    }
  }

  async markActivationUncertain(operationId: string, leaseToken: string, now: string): Promise<void> {
    await this.updateOperation(operationId, leaseToken, 'UNCERTAIN', null, null, now, now);
  }

  async markActivationFailed(operationId: string, leaseToken: string, failureCode: string, responseJson: string, now: string): Promise<void> {
    await this.updateOperation(operationId, leaseToken, 'FAILED', responseJson, failureCode, now, null);
  }

  async recordOrderLifecycle(input: {
    environment: 'test' | 'production'; vendorOrderId: string;
    status: 'pending' | 'failed' | 'paid' | 'refunded' | 'partial_refund' | 'fraudulent';
    vendorUpdatedAt: string; eventDigest: string; updatedAt: string;
  }): Promise<void> {
    await this.db.prepare(`
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
    `).bind(input.environment, input.vendorOrderId, input.status, input.vendorUpdatedAt,
      input.eventDigest, input.updatedAt).run();
  }

  async updateBinding(
    binding: ActivationBindingRecord,
    expectedCurrentStatus?: 'active' | 'revoked',
  ): Promise<boolean> {
    const result = await this.db.prepare(`
      UPDATE activation_bindings SET vendor_order_id=?, signed_entitlement=?, status=?, last_validated_at=?, updated_at=?
      WHERE binding_id=?
        AND (? IS NULL OR status = ?)
        AND (? != 'active' OR NOT EXISTS (
          SELECT 1 FROM order_lifecycle orders
          WHERE orders.environment = activation_bindings.environment
            AND orders.vendor_order_id = ?
            AND orders.status IN ('refunded', 'partial_refund', 'fraudulent')
        ))
    `).bind(binding.vendorOrderId, binding.signedEntitlement, binding.status,
      binding.lastValidatedAt, binding.updatedAt, binding.bindingId,
      expectedCurrentStatus ?? null, expectedCurrentStatus ?? null,
      binding.status, binding.vendorOrderId).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async removeBinding(bindingId: string): Promise<void> {
    await this.db.prepare('DELETE FROM activation_bindings WHERE binding_id = ?').bind(bindingId).run();
  }

  private async updateOperation(
    operationId: string,
    leaseToken: string,
    state: 'FAILED' | 'UNCERTAIN',
    responseJson: string | null,
    failureCode: string | null,
    now: string,
    leaseExpiresAt: string | null,
  ): Promise<void> {
    const result = await this.db.prepare(`
      UPDATE activation_operations
      SET state=?, response_json=?, failure_code=?, lease_token=NULL, lease_expires_at=?, updated_at=?
      WHERE operation_id=? AND lease_token=?
    `).bind(state, responseJson, failureCode, leaseExpiresAt, now, operationId, leaseToken).run();
    if ((result.meta.changes ?? 0) !== 1) throw new Error('Activation operation lease was lost');
  }
}

interface OperationRow {
  operation_id: string; environment: 'test' | 'production'; license_digest: string; installation_id: string; request_id: string;
  state: ActivationOperationRecord['state']; lease_token: string | null; lease_expires_at: string | null;
  response_json: string | null; failure_code: string | null; created_at: string; updated_at: string;
  attempt_count: number;
}

interface BindingRow {
  binding_id: string; environment: 'test' | 'production'; license_digest: string; installation_id: string;
  entitlement_id: string; vendor_license_id: string; activation_instance_id: string; masked_email: string;
  vendor_order_id: string;
  signed_entitlement: string; status: 'active' | 'revoked'; last_validated_at: string; created_at: string; updated_at: string;
}

function operationFromRow(row: OperationRow): ActivationOperationRecord {
  return {
    operationId: row.operation_id, environment: row.environment, licenseDigest: row.license_digest,
    installationId: row.installation_id, requestId: row.request_id, state: row.state, leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at, attemptCount: row.attempt_count,
    responseJson: row.response_json, failureCode: row.failure_code,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function bindingFromRow(row: BindingRow): ActivationBindingRecord {
  return {
    bindingId: row.binding_id, environment: row.environment, licenseDigest: row.license_digest,
    installationId: row.installation_id, entitlementId: row.entitlement_id,
    vendorLicenseId: row.vendor_license_id, activationInstanceId: row.activation_instance_id,
    vendorOrderId: row.vendor_order_id,
    maskedEmail: row.masked_email, signedEntitlement: row.signed_entitlement, status: row.status,
    lastValidatedAt: row.last_validated_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
