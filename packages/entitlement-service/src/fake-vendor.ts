import type {
  LicenseVendor,
  VendorLicenseInstance,
  VendorLicenseResult,
  VendorLicenseStatus,
  VendorOrderResult,
  VendorOrderStatus,
} from './vendor.ts';

interface FakeLicense {
  id: string;
  testMode: boolean;
  orderId: string;
  orderStatus: VendorOrderStatus;
  orderUpdatedAt: string;
  key: string;
  email: string;
  storeId: string;
  productId: string;
  variantId: string;
  activationLimit: number;
  status: VendorLicenseStatus;
  expiresAt: string | null;
  instances: VendorLicenseInstance[];
}

export class FakeLicenseVendor implements LicenseVendor {
  private readonly licenses = new Map<string, FakeLicense>();

  seed(input: Omit<FakeLicense, 'instances' | 'orderUpdatedAt'> & {
    instances?: VendorLicenseInstance[]; orderUpdatedAt?: string;
  }): void {
    this.licenses.set(input.key, {
      ...input, orderUpdatedAt: input.orderUpdatedAt ?? '2026-08-22T00:00:00.000Z',
      instances: [...(input.instances ?? [])],
    });
  }

  async inspect(licenseKey: string): Promise<VendorLicenseResult> {
    const license = this.licenses.get(licenseKey);
    if (!license) return missingResult();
    const valid = license.status === 'inactive' || license.status === 'active';
    return result(license, null, valid, valid ? null : `License is ${license.status}`);
  }

  async activate(licenseKey: string, instanceName: string): Promise<VendorLicenseResult> {
    const license = this.licenses.get(licenseKey);
    if (!license) return missingResult();
    if (license.status === 'expired' || license.status === 'disabled') return result(license, null, false, `License is ${license.status}`);
    if (license.instances.length >= license.activationLimit) return result(license, null, false, 'Activation limit reached');
    const instance: VendorLicenseInstance = {
      id: crypto.randomUUID(),
      name: instanceName,
      createdAt: new Date().toISOString(),
    };
    license.instances.push(instance);
    license.status = 'active';
    return result(license, instance, true, null);
  }

  async validate(licenseKey: string, instanceId: string): Promise<VendorLicenseResult> {
    const license = this.licenses.get(licenseKey);
    if (!license) return missingResult();
    const instance = license.instances.find((candidate) => candidate.id === instanceId) ?? null;
    const valid = Boolean(instance) && license.status === 'active';
    return result(license, instance, valid, valid ? null : 'License instance is not valid');
  }

  async deactivate(licenseKey: string, instanceId: string): Promise<VendorLicenseResult> {
    const license = this.licenses.get(licenseKey);
    if (!license) return missingResult();
    const index = license.instances.findIndex((candidate) => candidate.id === instanceId);
    if (index < 0) return result(license, null, false, 'License instance was not found');
    const [instance] = license.instances.splice(index, 1);
    license.status = license.instances.length > 0 ? 'active' : 'inactive';
    return result(license, instance ?? null, true, null);
  }

  async listInstances(licenseKey: string): Promise<VendorLicenseInstance[]> {
    return [...(this.licenses.get(licenseKey)?.instances ?? [])];
  }

  async getOrder(orderId: string): Promise<VendorOrderResult> {
    const license = [...this.licenses.values()].find((candidate) => candidate.orderId === orderId);
    if (!license) throw new Error('Fake order was not found');
    return {
      orderId, storeId: license.storeId, testMode: license.testMode,
      status: license.orderStatus, updatedAt: license.orderUpdatedAt,
    };
  }

  setOrderStatus(orderId: string, status: VendorOrderStatus): void {
    const license = [...this.licenses.values()].find((candidate) => candidate.orderId === orderId);
    if (!license) throw new Error('Fake order was not found');
    license.orderStatus = status;
    license.orderUpdatedAt = new Date(Date.parse(license.orderUpdatedAt) + 1_000).toISOString();
  }
}

function result(license: FakeLicense, instance: VendorLicenseInstance | null, valid: boolean, error: string | null): VendorLicenseResult {
  return {
    valid,
    error,
    licenseId: license.id,
    orderId: license.orderId,
    status: license.status,
    storeId: license.storeId,
    productId: license.productId,
    variantId: license.variantId,
    customerEmail: license.email,
    activationLimit: license.activationLimit,
    activationUsage: license.instances.length,
    expiresAt: license.expiresAt,
    instance,
  };
}

function missingResult(): VendorLicenseResult {
  return {
    valid: false,
    error: 'License was not found',
    licenseId: '0',
    orderId: '0',
    status: 'inactive',
    storeId: '0',
    productId: '0',
    variantId: '0',
    customerEmail: '',
    activationLimit: 0,
    activationUsage: 0,
    expiresAt: null,
    instance: null,
  };
}
