import { describe, expect, test } from 'bun:test';
import { LemonSqueezyLicenseVendor, type VendorFetch } from './lemon-vendor.ts';

describe('LIC2 Lemon adapter', () => {
  test('calls the default fetch as a global function for Cloudflare Workers compatibility', async () => {
    const originalFetch = globalThis.fetch;
    let receiver: unknown;
    try {
      globalThis.fetch = function (this: unknown) {
        receiver = this;
        return Promise.resolve(Response.json({
          valid: true,
          error: null,
          meta: { store_id: 1, order_id: 5678, product_id: 2, variant_id: 3, customer_email: 'writer@example.com' },
          license_key: { id: 1234, status: 'inactive', activation_limit: 3, activation_usage: 0, expires_at: null },
          instance: null,
        }));
      } as unknown as typeof fetch;
      const vendor = new LemonSqueezyLicenseVendor('admin-secret');
      expect((await vendor.inspect('SECRET-LICENSE')).valid).toBe(true);
      expect(receiver).not.toBe(vendor);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('uses form-encoded license API and maps exact vendor authority', async () => {
    const requests: Request[] = [];
    const fetcher: VendorFetch = async (input, init) => {
      const request = new Request(String(input), init);
      requests.push(request);
      return Response.json({
        activated: true,
        error: null,
        meta: { store_id: 1, order_id: 5678, product_id: 2, variant_id: 3, customer_email: 'writer@example.com' },
        license_key: { id: 1234, status: 'active', activation_limit: 3, activation_usage: 1, expires_at: null },
        instance: { id: 'instance-1', name: 'Mac installation • A1B2C3', created_at: '2026-08-22T17:00:00.000Z' },
      });
    };
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', fetcher);
    expect(await vendor.activate('SECRET-LICENSE', 'Mac installation • A1B2C3')).toMatchObject({
      valid: true, licenseId: '1234', orderId: '5678', storeId: '1', productId: '2', variantId: '3', activationLimit: 3,
    });
    expect(requests[0]?.headers.get('Authorization')).toBeNull();
    expect(await requests[0]?.text()).toBe('license_key=SECRET-LICENSE&instance_name=Mac+installation+%E2%80%A2+A1B2C3');
  });

  test('maps the distinct Lemon success field for every license action', async () => {
    const responses = [
      { valid: true, instance: null },
      { deactivated: true, instance: null },
    ];
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', async () => Response.json({
      ...responses.shift(),
      error: null,
      meta: { store_id: 1, order_id: 5678, product_id: 2, variant_id: 3, customer_email: 'writer@example.com' },
      license_key: { id: 1234, status: 'active', activation_limit: 3, activation_usage: 1, expires_at: null },
    }));
    expect((await vendor.inspect('SECRET-LICENSE')).valid).toBe(true);
    expect((await vendor.deactivate('SECRET-LICENSE', 'instance-1')).valid).toBe(true);
  });

  test('maps rate limits without returning vendor body text', async () => {
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', async () => new Response('secret vendor detail', { status: 429 }));
    await expect(vendor.validate('SECRET-LICENSE', 'instance-1')).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'RATE_LIMITED' });
  });

  test('maps Lemon HTTP 400 activation-limit results instead of reporting an outage', async () => {
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', async () => Response.json({
      activated: false,
      error: 'This license key has reached the activation limit.',
      meta: { store_id: 1, order_id: 5678, product_id: 2, variant_id: 3, customer_email: 'writer@example.com' },
      license_key: { id: 1234, status: 'active', activation_limit: 3, activation_usage: 3, expires_at: null },
      instance: null,
    }, { status: 400 }));

    expect(await vendor.activate('SECRET-LICENSE', 'Mac installation • D4E5F6')).toMatchObject({
      valid: false,
      error: 'This license key has reached the activation limit.',
      activationLimit: 3,
      activationUsage: 3,
    });
  });

  test('uses the documented instance filter, identifier, and pagination link', async () => {
    const requests: Request[] = [];
    const fetcher: VendorFetch = async (input, init) => {
      const request = new Request(String(input), init);
      requests.push(request);
      if (new URL(request.url).pathname === '/v1/licenses/validate') {
        return Response.json({
          valid: true,
          error: null,
          meta: { store_id: 1, order_id: 5678, product_id: 2, variant_id: 3, customer_email: 'writer@example.com' },
          license_key: { id: 1234, status: 'active', activation_limit: 3, activation_usage: 1, expires_at: null },
          instance: null,
        });
      }
      const page = new URL(request.url).searchParams.get('page[number]');
      return Response.json({
        data: [{
          type: 'license-key-instances',
          id: page ? 'resource-2' : 'resource-1',
          attributes: {
            license_key_id: 1234,
            identifier: page ? 'activation-2' : 'activation-1',
            name: page ? 'artistos:installation-2' : 'artistos:installation-1',
            created_at: '2026-08-22T17:00:00.000Z',
          },
        }],
        links: {
          next: page ? null : 'https://api.lemonsqueezy.com/v1/license-key-instances?filter%5Blicense_key_id%5D=1234&page%5Bnumber%5D=2&page%5Bsize%5D=100',
        },
      });
    };
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', fetcher);

    expect(await vendor.listInstances('SECRET-LICENSE')).toEqual([
      { id: 'activation-1', name: 'artistos:installation-1', createdAt: '2026-08-22T17:00:00.000Z' },
      { id: 'activation-2', name: 'artistos:installation-2', createdAt: '2026-08-22T17:00:00.000Z' },
    ]);
    expect(requests[1]?.url).toContain('filter%5Blicense_key_id%5D=1234');
    expect(requests[1]?.url).not.toContain('filter%5Blicense-key%5D');
    expect(requests[1]?.headers.get('Authorization')).toBe('Bearer admin-secret');
  });

  test('reads exact order commerce state through the authenticated REST API', async () => {
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', async (input, init) => {
      const request = new Request(String(input), init);
      expect(request.url).toBe('https://api.lemonsqueezy.com/v1/orders/5678');
      expect(request.headers.get('Authorization')).toBe('Bearer admin-secret');
      return Response.json({
        data: { type: 'orders', id: '5678', attributes: {
          test_mode: true, store_id: 1, status: 'refunded', updated_at: '2026-08-22T17:00:00.000000Z',
        } },
      });
    });
    expect(await vendor.getOrder('5678')).toEqual({
      orderId: '5678', storeId: '1', testMode: true,
      status: 'refunded', updatedAt: '2026-08-22T17:00:00.000000Z',
    });
  });

  test('rejects malformed REST order timestamps', async () => {
    const vendor = new LemonSqueezyLicenseVendor('admin-secret', async () => Response.json({
      data: { type: 'orders', id: '5678', attributes: {
        test_mode: true, store_id: 1, status: 'paid', updated_at: '2026-08-22T17:00:00.0000000Z',
      } },
    }));
    await expect(vendor.getOrder('5678')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
