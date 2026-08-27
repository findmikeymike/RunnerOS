export type OperationState = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN';

export interface ActivationOperationRecord {
  operationId: string;
  environment: 'test' | 'production';
  licenseDigest: string;
  installationId: string;
  requestId: string;
  attemptCount: number;
  state: OperationState;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  responseJson: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActivationBindingRecord {
  bindingId: string;
  environment: 'test' | 'production';
  licenseDigest: string;
  installationId: string;
  entitlementId: string;
  vendorLicenseId: string;
  vendorOrderId: string;
  activationInstanceId: string;
  maskedEmail: string;
  signedEntitlement: string;
  status: 'active' | 'revoked';
  lastValidatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BeginActivationResult {
  operation: ActivationOperationRecord;
  ownsLease: boolean;
}

export interface EntitlementStore {
  beginActivation(input: {
    operationId: string;
    environment: 'test' | 'production';
    licenseDigest: string;
    installationId: string;
    requestId: string;
    leaseToken: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<BeginActivationResult>;
  getBinding(environment: 'test' | 'production', licenseDigest: string, installationId: string): Promise<ActivationBindingRecord | null>;
  completeActivation(operationId: string, leaseToken: string, binding: ActivationBindingRecord, responseJson: string, now: string): Promise<void>;
  markActivationUncertain(operationId: string, leaseToken: string, now: string): Promise<void>;
  markActivationFailed(operationId: string, leaseToken: string, failureCode: string, responseJson: string, now: string): Promise<void>;
  recordOrderLifecycle(input: {
    environment: 'test' | 'production';
    vendorOrderId: string;
    status: 'pending' | 'failed' | 'paid' | 'refunded' | 'partial_refund' | 'fraudulent';
    vendorUpdatedAt: string;
    eventDigest: string;
    updatedAt: string;
  }): Promise<void>;
  updateBinding(binding: ActivationBindingRecord, expectedCurrentStatus?: 'active' | 'revoked'): Promise<boolean>;
  removeBinding(bindingId: string): Promise<void>;
}
