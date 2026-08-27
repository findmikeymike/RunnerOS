import { describe, expect, test } from 'bun:test';
import { generateKeyPair } from 'jose';
import { FakeLicenseVendor } from './fake-vendor.ts';
import { InMemoryEntitlementStore } from './memory-store.ts';
import { EntitlementService } from './service.ts';
import type { EntitlementStore } from './store.ts';
import type { LicenseVendor } from './vendor.ts';

const request = {
  schemaVersion: 1 as const,
  email: 'writer@example.com',
  licenseKey: 'TEST-KEY-1234',
  installationId: '42dbdbd4-72ff-4a84-908b-3ca394f56544',
  appVersion: '1.0.0',
  platform: 'macos' as const,
  architecture: 'arm64' as const,
  requestId: 'request-1',
};

describe('LIC2 entitlement activation domain', () => {
  test('activates once and returns the durable binding on retry without another seat', async () => {
    const fixture = await createFixture();
    const first = await fixture.service.activate(request);
    const second = await fixture.service.activate(request);
    expect(first).toMatchObject({ ok: true, maskedEmail: 'w***@example.com', lastFour: '1234' });
    expect(second).toEqual(first);
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(1);
  });

  test('derives Basic versus Premium from the exact Lemon variant rather than renderer input', async () => {
    const fixture = await createFixture({ variantId: '4', tieredVariants: true });
    const activated = await fixture.service.activate(request);
    if (!activated.ok) throw new Error('fixture activation failed');
    const payload = JSON.parse(Buffer.from(activated.signedEntitlement.split('.')[1]!, 'base64url').toString('utf8')) as { edition: string; plan: string };
    expect(payload).toMatchObject({ edition: 'basic', plan: 'perpetual-basic-v1' });
  });

  test('supports a Premium-only launch and rejects an unconfigured Basic variant', async () => {
    const premium = await createFixture({ premiumOnlyVariants: true });
    const activated = await premium.service.activate(request);
    if (!activated.ok) throw new Error('fixture activation failed');
    const payload = JSON.parse(Buffer.from(activated.signedEntitlement.split('.')[1]!, 'base64url').toString('utf8')) as { edition: string; plan: string };
    expect(payload).toMatchObject({ edition: 'premium', plan: 'perpetual-premium-v1' });

    const unknown = await createFixture({ variantId: '4', premiumOnlyVariants: true });
    expect(await unknown.service.activate(request)).toMatchObject({ ok: false, code: 'WRONG_PRODUCT' });
    expect(await unknown.vendor.listInstances(request.licenseKey)).toHaveLength(0);
  });

  test('concurrent callers converge on one binding and cannot consume two seats', async () => {
    const fixture = await createFixture();
    const [left, right] = await Promise.all([
      fixture.service.activate(request),
      fixture.service.activate({ ...request, requestId: 'request-2' }),
    ]);
    const successful = [left, right].filter((result) => result.ok);
    expect(successful.length).toBeGreaterThanOrEqual(1);
    if (successful.length === 2 && successful[0]?.ok && successful[1]?.ok) {
      expect(successful[0].signedEntitlement).toBe(successful[1].signedEntitlement);
    }
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(1);
  });

  test('uncertain activation reconciles the deterministic vendor instance before retrying', async () => {
    const fixture = await createFixture();
    let failAfterVendorWrite = true;
    const uncertainVendor: LicenseVendor = {
      ...fixture.vendor,
      inspect: fixture.vendor.inspect.bind(fixture.vendor),
      activate: async (key, name) => {
        const result = await fixture.vendor.activate(key, name);
        if (failAfterVendorWrite) {
          failAfterVendorWrite = false;
          throw new Error('network result lost');
        }
        return result;
      },
      validate: fixture.vendor.validate.bind(fixture.vendor),
      deactivate: fixture.vendor.deactivate.bind(fixture.vendor),
      listInstances: fixture.vendor.listInstances.bind(fixture.vendor),
      getOrder: fixture.vendor.getOrder.bind(fixture.vendor),
    };
    const service = new EntitlementService({ ...fixture.dependencies, vendor: uncertainVendor });
    expect(await service.activate(request)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true });
    expect(await service.activate({ ...request, requestId: 'request-2' })).toMatchObject({ ok: true });
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(1);
  });

  test('rejects wrong product and email without storing an entitlement', async () => {
    const fixture = await createFixture({ productId: 'wrong-product', email: 'other@example.com' });
    expect(await fixture.service.activate(request)).toMatchObject({ ok: false, code: 'WRONG_PRODUCT' });
    expect(await fixture.service.activate({ ...request, requestId: 'request-2' })).toMatchObject({ ok: false, code: 'WRONG_PRODUCT' });
  });

  test('rejects test-mode commerce authority in the production service', async () => {
    const fixture = await createFixture({ environment: 'production' });
    expect(await fixture.service.activate(request)).toMatchObject({ ok: false, code: 'WRONG_PRODUCT' });
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(0);
  });

  test('rejects refunded commerce authority before consuming a seat', async () => {
    const fixture = await createFixture({ orderStatus: 'refunded' });
    expect(await fixture.service.activate(request)).toMatchObject({ ok: false, code: 'LICENSE_DISABLED' });
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(0);
  });

  test('rejects a confirmed refund on validation and activation retry', async () => {
    const fixture = await createFixture();
    const activated = await fixture.service.activate(request);
    if (!activated.ok) throw new Error('fixture activation failed');
    const payload = JSON.parse(Buffer.from(activated.signedEntitlement.split('.')[1]!, 'base64url').toString('utf8')) as { activationInstanceId: string };
    fixture.vendor.setOrderStatus('5678', 'refunded');
    const validationRequest = {
      ...request,
      requestId: 'validate-after-refund',
      activationInstanceId: payload.activationInstanceId,
      signedEntitlement: activated.signedEntitlement,
    };
    expect(await fixture.service.validate(validationRequest)).toMatchObject({ ok: false, code: 'LICENSE_DISABLED' });
    fixture.vendor.setOrderStatus('5678', 'paid');
    expect(await fixture.service.activate({ ...request, requestId: 'activate-after-refund' }))
      .toMatchObject({ ok: false, code: 'LICENSE_DISABLED' });
  });

  test('refreshes only the exact signed binding and deactivates exactly one instance', async () => {
    const fixture = await createFixture();
    const activated = await fixture.service.activate(request);
    if (!activated.ok) throw new Error('fixture activation failed');
    const payload = JSON.parse(Buffer.from(activated.signedEntitlement.split('.')[1]!, 'base64url').toString('utf8')) as { activationInstanceId: string };
    const validationRequest = {
      ...request,
      requestId: 'validate-1',
      activationInstanceId: payload.activationInstanceId,
      signedEntitlement: activated.signedEntitlement,
    };
    expect(await fixture.service.validate(validationRequest)).toMatchObject({ ok: true });
    expect(await fixture.service.validate({ ...validationRequest, signedEntitlement: `${activated.signedEntitlement}x` })).toMatchObject({ ok: false, code: 'INVALID_LICENSE' });
    expect(await fixture.service.deactivate(validationRequest)).toEqual({ ok: true, schemaVersion: 1 });
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(0);
    expect(await fixture.service.validate(validationRequest)).toMatchObject({ ok: false, code: 'INSTANCE_NOT_FOUND' });
    expect(await fixture.service.activate({ ...request, requestId: 'reactivate-1' })).toMatchObject({ ok: true });
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(1);
  });

  test('reconciles vendor-confirmed deactivation after a local delete failure', async () => {
    const fixture = await createFixture();
    const activated = await fixture.service.activate(request);
    if (!activated.ok) throw new Error('fixture activation failed');
    const payload = JSON.parse(Buffer.from(activated.signedEntitlement.split('.')[1]!, 'base64url').toString('utf8')) as { activationInstanceId: string };
    let failDelete = true;
    const store: EntitlementStore = {
      beginActivation: fixture.store.beginActivation.bind(fixture.store),
      getBinding: fixture.store.getBinding.bind(fixture.store),
      completeActivation: fixture.store.completeActivation.bind(fixture.store),
      markActivationUncertain: fixture.store.markActivationUncertain.bind(fixture.store),
      markActivationFailed: fixture.store.markActivationFailed.bind(fixture.store),
      recordOrderLifecycle: fixture.store.recordOrderLifecycle.bind(fixture.store),
      updateBinding: fixture.store.updateBinding.bind(fixture.store),
      removeBinding: async (bindingId) => {
        if (failDelete) {
          failDelete = false;
          throw new Error('D1 unavailable');
        }
        await fixture.store.removeBinding(bindingId);
      },
    };
    const service = new EntitlementService({ ...fixture.dependencies, store });
    const deactivation = {
      ...request,
      requestId: 'deactivate-1',
      activationInstanceId: payload.activationInstanceId,
      signedEntitlement: activated.signedEntitlement,
    };
    expect(await service.deactivate(deactivation)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(await service.deactivate({ ...deactivation, requestId: 'deactivate-2' })).toEqual({ ok: true, schemaVersion: 1 });
    expect(await fixture.vendor.listInstances(request.licenseKey)).toHaveLength(0);
  });
});

async function createFixture(overrides: {
  productId?: string;
  email?: string;
  orderStatus?: 'paid' | 'refunded';
  environment?: 'test' | 'production';
  variantId?: string;
  tieredVariants?: boolean;
  premiumOnlyVariants?: boolean;
} = {}) {
  const keys = await generateKeyPair('EdDSA');
  const vendor = new FakeLicenseVendor();
  vendor.seed({
    id: '1234', testMode: true, orderId: '5678', orderStatus: overrides.orderStatus ?? 'paid', key: request.licenseKey, email: overrides.email ?? request.email,
    storeId: '1', productId: overrides.productId ?? '2', variantId: overrides.variantId ?? '3', activationLimit: 3,
    status: 'inactive', expiresAt: null,
  });
  const store = new InMemoryEntitlementStore();
  const dependencies = {
    environment: overrides.environment ?? 'test',
    storeId: '1', productId: '2',
    ...(overrides.tieredVariants
      ? { variantIds: { basic: '4', premium: '3' } as const }
      : overrides.premiumOnlyVariants
        ? { variantIds: { premium: '3' } as const }
        : { variantId: '3' }),
    store,
    vendor, signingKeyId: 'key-1', signingPrivateKey: keys.privateKey,
    verificationKeyring: { 'key-1': keys.publicKey },
  };
  return { vendor, store, dependencies, service: new EntitlementService(dependencies) };
}
