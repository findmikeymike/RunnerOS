import type {
  ActivationBindingRecord,
  ActivationOperationRecord,
  BeginActivationResult,
  EntitlementStore,
} from './store.ts';

export class InMemoryEntitlementStore implements EntitlementStore {
  private readonly operations = new Map<string, ActivationOperationRecord>();
  private readonly bindings = new Map<string, ActivationBindingRecord>();
  private readonly orderLifecycle = new Map<string, {
    status: 'pending' | 'failed' | 'paid' | 'refunded' | 'partial_refund' | 'fraudulent';
    vendorUpdatedAt: string; eventDigest: string;
  }>();

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
    const existing = this.operations.get(input.operationId);
    if (!existing) {
      const operation: ActivationOperationRecord = {
        ...input,
        state: 'PENDING',
        attemptCount: 1,
        responseJson: null,
        failureCode: null,
        createdAt: input.now,
        updatedAt: input.now,
      };
      this.operations.set(input.operationId, operation);
      return { operation: { ...operation }, ownsLease: true };
    }
    const leaseExpired = existing.leaseExpiresAt === null || existing.leaseExpiresAt <= input.now;
    const bindingExists = this.bindings.has(bindingKey(existing.environment, existing.licenseDigest, existing.installationId));
    if (((existing.state === 'PENDING' || existing.state === 'UNCERTAIN') && leaseExpired)
      || (existing.state === 'FAILED' && existing.requestId !== input.requestId)
      || (existing.state === 'SUCCEEDED' && existing.requestId !== input.requestId && !bindingExists)) {
      existing.state = 'PENDING';
      existing.requestId = input.requestId;
      existing.leaseToken = input.leaseToken;
      existing.leaseExpiresAt = input.leaseExpiresAt;
      existing.responseJson = null;
      existing.attemptCount += 1;
      existing.failureCode = null;
      existing.updatedAt = input.now;
      return { operation: { ...existing }, ownsLease: true };
    }
    return { operation: { ...existing }, ownsLease: existing.leaseToken === input.leaseToken };
  }

  async getBinding(environment: 'test' | 'production', licenseDigest: string, installationId: string): Promise<ActivationBindingRecord | null> {
    const value = this.bindings.get(bindingKey(environment, licenseDigest, installationId));
    return value ? { ...value } : null;
  }

  async completeActivation(operationId: string, leaseToken: string, binding: ActivationBindingRecord, responseJson: string, now: string): Promise<void> {
    const operation = this.requireLease(operationId, leaseToken);
    if (isAdverse(this.orderLifecycle.get(orderKey(binding.environment, binding.vendorOrderId))?.status)) {
      throw new Error('Activation operation lease was lost');
    }
    this.bindings.set(bindingKey(binding.environment, binding.licenseDigest, binding.installationId), { ...binding });
    Object.assign(operation, { state: 'SUCCEEDED', responseJson, failureCode: null, leaseToken: null, leaseExpiresAt: null, updatedAt: now });
  }

  async markActivationUncertain(operationId: string, leaseToken: string, now: string): Promise<void> {
    const operation = this.requireLease(operationId, leaseToken);
    Object.assign(operation, { state: 'UNCERTAIN', leaseToken: null, leaseExpiresAt: now, updatedAt: now });
  }

  async markActivationFailed(operationId: string, leaseToken: string, failureCode: string, responseJson: string, now: string): Promise<void> {
    const operation = this.requireLease(operationId, leaseToken);
    Object.assign(operation, { state: 'FAILED', failureCode, responseJson, leaseToken: null, leaseExpiresAt: null, updatedAt: now });
  }

  async recordOrderLifecycle(input: {
    environment: 'test' | 'production'; vendorOrderId: string;
    status: 'pending' | 'failed' | 'paid' | 'refunded' | 'partial_refund' | 'fraudulent';
    vendorUpdatedAt: string; eventDigest: string; updatedAt: string;
  }): Promise<void> {
    const key = orderKey(input.environment, input.vendorOrderId);
    const current = this.orderLifecycle.get(key);
    if (!current || compareOrderAuthority(input, current) > 0) {
      this.orderLifecycle.set(key, {
        status: input.status, vendorUpdatedAt: input.vendorUpdatedAt, eventDigest: input.eventDigest,
      });
    }
  }

  async updateBinding(
    binding: ActivationBindingRecord,
    expectedCurrentStatus?: 'active' | 'revoked',
  ): Promise<boolean> {
    const key = bindingKey(binding.environment, binding.licenseDigest, binding.installationId);
    const current = this.bindings.get(key);
    if (!current || (expectedCurrentStatus && current.status !== expectedCurrentStatus)
      || (binding.status === 'active' && isAdverse(this.orderLifecycle.get(orderKey(binding.environment, binding.vendorOrderId))?.status))) {
      return false;
    }
    this.bindings.set(bindingKey(binding.environment, binding.licenseDigest, binding.installationId), { ...binding });
    return true;
  }

  async removeBinding(bindingId: string): Promise<void> {
    for (const [key, binding] of this.bindings) if (binding.bindingId === bindingId) this.bindings.delete(key);
  }

  private requireLease(operationId: string, leaseToken: string): ActivationOperationRecord {
    const operation = this.operations.get(operationId);
    if (!operation || operation.leaseToken !== leaseToken) throw new Error('Activation operation lease was lost');
    return operation;
  }
}

function bindingKey(environment: string, licenseDigest: string, installationId: string): string {
  return `${environment}:${licenseDigest}:${installationId}`;
}

function orderKey(environment: string, vendorOrderId: string): string {
  return `${environment}:${vendorOrderId}`;
}

function isAdverse(status: string | undefined): boolean {
  return status === 'refunded' || status === 'partial_refund' || status === 'fraudulent';
}

function compareOrderAuthority(
  left: { status: string; vendorUpdatedAt: string; eventDigest: string },
  right: { status: string; vendorUpdatedAt: string; eventDigest: string },
): number {
  if (left.vendorUpdatedAt !== right.vendorUpdatedAt) return left.vendorUpdatedAt.localeCompare(right.vendorUpdatedAt);
  const rank = (status: string): number => ({ pending: 0, failed: 1, paid: 2, partial_refund: 3, refunded: 4, fraudulent: 5 })[status] ?? -1;
  if (rank(left.status) !== rank(right.status)) return rank(left.status) - rank(right.status);
  return left.eventDigest.localeCompare(right.eventDigest);
}
