import {
  LicenseVendorError,
  type LicenseVendor,
  type VendorLicenseInstance,
  type VendorLicenseResult,
  type VendorLicenseStatus,
  type VendorOrderResult,
  type VendorOrderStatus,
} from './vendor.ts';

const LICENSE_API = 'https://api.lemonsqueezy.com/v1/licenses';
const REST_API = 'https://api.lemonsqueezy.com/v1';

export type VendorFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class LemonSqueezyLicenseVendor implements LicenseVendor {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: VendorFetch = (input, init) => fetch(input, init),
  ) {}

  inspect(licenseKey: string): Promise<VendorLicenseResult> {
    return this.postLicense('validate', { license_key: licenseKey });
  }

  activate(licenseKey: string, instanceName: string): Promise<VendorLicenseResult> {
    return this.postLicense('activate', { license_key: licenseKey, instance_name: instanceName });
  }

  validate(licenseKey: string, instanceId: string): Promise<VendorLicenseResult> {
    return this.postLicense('validate', { license_key: licenseKey, instance_id: instanceId });
  }

  deactivate(licenseKey: string, instanceId: string): Promise<VendorLicenseResult> {
    return this.postLicense('deactivate', { license_key: licenseKey, instance_id: instanceId });
  }

  async listInstances(licenseKey: string): Promise<VendorLicenseInstance[]> {
    const license = await this.inspect(licenseKey);
    if (license.licenseId === '0') return [];
    const url = new URL(`${REST_API}/license-key-instances`);
    url.searchParams.set('filter[license_key_id]', license.licenseId);
    url.searchParams.set('page[size]', '100');
    const instances: VendorLicenseInstance[] = [];
    let next: URL | null = url;
    for (let page = 0; next && page < 100; page += 1) {
      const response = await this.fetcher(next, {
        headers: { Accept: 'application/vnd.api+json', Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      await assertVendorHttp(response);
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.data)) throw new LicenseVendorError('INVALID_RESPONSE');
      instances.push(...body.data.map(parseRestInstance));
      next = parseNextPage(body.links);
    }
    if (next) throw new LicenseVendorError('SERVICE_UNAVAILABLE');
    return instances;
  }

  async getOrder(orderId: string): Promise<VendorOrderResult> {
    if (!/^\d+$/.test(orderId)) throw new LicenseVendorError('INVALID_RESPONSE');
    const response = await this.fetcher(`${REST_API}/orders/${orderId}`, {
      headers: { Accept: 'application/vnd.api+json', Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    await assertVendorHttp(response);
    const body: unknown = await response.json();
    if (!isRecord(body) || !isRecord(body.data) || body.data.type !== 'orders'
      || !isRecord(body.data.attributes) || body.data.id !== orderId) {
      throw new LicenseVendorError('INVALID_RESPONSE');
    }
    const status = body.data.attributes.status;
    const testMode = body.data.attributes.test_mode;
    const updatedAt = body.data.attributes.updated_at;
    if (!isOrderStatus(status) || typeof testMode !== 'boolean' || !isStrictUtc(updatedAt)) {
      throw new LicenseVendorError('INVALID_RESPONSE');
    }
    return {
      orderId,
      storeId: integerString(body.data.attributes.store_id),
      testMode,
      status,
      updatedAt,
    };
  }

  private async postLicense(action: 'activate' | 'validate' | 'deactivate', fields: Record<string, string>): Promise<VendorLicenseResult> {
    const response = await this.fetcher(`${LICENSE_API}/${action}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(10_000),
    });
    // Lemon returns a structured license result with HTTP 400 for normal domain
    // failures such as a reached activation limit. Preserve that authority so the
    // service can return the precise public failure instead of a false outage.
    if (!response.ok && response.status !== 400) await assertVendorHttp(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LicenseVendorError('INVALID_RESPONSE');
    }
    return parseLicenseResult(body, action);
  }
}

async function assertVendorHttp(response: Response): Promise<void> {
  if (response.status === 429) throw new LicenseVendorError('RATE_LIMITED');
  if (response.status >= 500) throw new LicenseVendorError('SERVICE_UNAVAILABLE');
  if (!response.ok) {
    // License API uses successful JSON responses for normal invalid-license outcomes.
    throw new LicenseVendorError('INVALID_RESPONSE');
  }
}

function parseLicenseResult(input: unknown, action: 'activate' | 'validate' | 'deactivate'): VendorLicenseResult {
  const success = isRecord(input)
    ? action === 'activate' ? input.activated : action === 'deactivate' ? input.deactivated : input.valid
    : null;
  if (!isRecord(input) || typeof success !== 'boolean' || !isRecord(input.license_key) || !isRecord(input.meta)) {
    throw new LicenseVendorError('INVALID_RESPONSE');
  }
  const license = input.license_key;
  const meta = input.meta;
  const instance = input.instance === null || input.instance === undefined ? null : parseLicenseInstance(input.instance);
  const status = license.status;
  if (!isVendorStatus(status)) throw new LicenseVendorError('INVALID_RESPONSE');
  const result: VendorLicenseResult = {
    valid: success,
    error: typeof input.error === 'string' ? input.error : null,
    licenseId: integerString(license.id),
    orderId: integerString(meta.order_id),
    status,
    storeId: integerString(meta.store_id),
    productId: integerString(meta.product_id),
    variantId: integerString(meta.variant_id),
    customerEmail: stringValue(meta.customer_email),
    activationLimit: integerValue(license.activation_limit),
    activationUsage: integerValue(license.activation_usage),
    expiresAt: license.expires_at === null ? null : stringValue(license.expires_at),
    instance,
  };
  return result;
}

function parseLicenseInstance(input: unknown): VendorLicenseInstance {
  if (!isRecord(input)) throw new LicenseVendorError('INVALID_RESPONSE');
  return { id: stringValue(input.id), name: stringValue(input.name), createdAt: stringValue(input.created_at) };
}

function parseRestInstance(input: unknown): VendorLicenseInstance {
  if (!isRecord(input) || !isRecord(input.attributes)) throw new LicenseVendorError('INVALID_RESPONSE');
  return {
    id: stringValue(input.attributes.identifier),
    name: stringValue(input.attributes.name),
    createdAt: stringValue(input.attributes.created_at),
  };
}

function parseNextPage(input: unknown): URL | null {
  if (!isRecord(input) || input.next === null || input.next === undefined) return null;
  if (typeof input.next !== 'string') throw new LicenseVendorError('INVALID_RESPONSE');
  const next = new URL(input.next);
  if (next.origin !== new URL(REST_API).origin || next.pathname !== '/v1/license-key-instances') {
    throw new LicenseVendorError('INVALID_RESPONSE');
  }
  return next;
}

function isVendorStatus(value: unknown): value is VendorLicenseStatus {
  return value === 'inactive' || value === 'active' || value === 'expired' || value === 'disabled';
}

function isOrderStatus(value: unknown): value is VendorOrderStatus {
  return value === 'pending' || value === 'failed' || value === 'paid'
    || value === 'refunded' || value === 'partial_refund' || value === 'fraudulent';
}

function isStrictUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const fraction = value.match(/\.(\d{1,6})Z$/)?.[1] ?? '';
  const milliseconds = fraction.padEnd(3, '0').slice(0, 3);
  return new Date(parsed).toISOString() === value.replace(/(?:\.\d{1,6})?Z$/, `.${milliseconds}Z`);
}

function integerString(value: unknown): string {
  if ((typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'string' && /^\d+$/.test(value))) return String(value);
  throw new LicenseVendorError('INVALID_RESPONSE');
}

function integerValue(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new LicenseVendorError('INVALID_RESPONSE');
}

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new LicenseVendorError('INVALID_RESPONSE');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
