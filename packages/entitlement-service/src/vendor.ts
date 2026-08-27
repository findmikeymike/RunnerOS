export type VendorLicenseStatus = 'inactive' | 'active' | 'expired' | 'disabled';

export interface VendorLicenseInstance {
  id: string;
  name: string;
  createdAt: string;
}

export interface VendorLicenseResult {
  valid: boolean;
  error: string | null;
  licenseId: string;
  orderId: string;
  status: VendorLicenseStatus;
  storeId: string;
  productId: string;
  variantId: string;
  customerEmail: string;
  activationLimit: number;
  activationUsage: number;
  expiresAt: string | null;
  instance: VendorLicenseInstance | null;
}

export type VendorOrderStatus = 'pending' | 'failed' | 'paid' | 'refunded' | 'partial_refund' | 'fraudulent';

export interface VendorOrderResult {
  orderId: string;
  storeId: string;
  testMode: boolean;
  status: VendorOrderStatus;
  updatedAt: string;
}

export interface LicenseVendor {
  inspect(licenseKey: string): Promise<VendorLicenseResult>;
  activate(licenseKey: string, instanceName: string): Promise<VendorLicenseResult>;
  validate(licenseKey: string, instanceId: string): Promise<VendorLicenseResult>;
  deactivate(licenseKey: string, instanceId: string): Promise<VendorLicenseResult>;
  listInstances(licenseKey: string): Promise<VendorLicenseInstance[]>;
  getOrder(orderId: string): Promise<VendorOrderResult>;
}

export class LicenseVendorError extends Error {
  constructor(
    public readonly code: 'RATE_LIMITED' | 'SERVICE_UNAVAILABLE' | 'INVALID_RESPONSE',
  ) {
    super(code);
    this.name = 'LicenseVendorError';
  }
}
