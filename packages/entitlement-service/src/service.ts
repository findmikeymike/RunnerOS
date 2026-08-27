import {
  ARTIST_OS_APP_ID,
  ARTIST_OS_BASIC_EDITION,
  ARTIST_OS_PREMIUM_EDITION,
  ARTIST_OS_PRODUCT,
  ARTIST_OS_SEAT_LIMIT,
  planForArtistOSEdition,
  validateActivateEntitlementRequest,
  validateValidateEntitlementRequest,
  type ActivateEntitlementRequestV1,
  type EntitlementFailureCode,
  type ArtistOSEntitlementV1,
  type ArtistOSEdition,
} from '@craft-agent/shared/licensing';
import { verifyArtistOSEntitlementToken, type ArtistOSEntitlementKeyring } from '../../server-core/src/licensing/entitlement-verify.ts';
import type { EntitlementSigningKey } from './signing.ts';
import { signArtistOSEntitlement } from './signing.ts';
import type { ActivationBindingRecord, EntitlementStore } from './store.ts';
import { LicenseVendorError, type LicenseVendor, type VendorLicenseResult } from './vendor.ts';

export interface ActivateEntitlementSuccessV1 {
  ok: true;
  schemaVersion: 1;
  signedEntitlement: string;
  maskedEmail: string;
  lastFour: string;
  seatLimit: 3;
  status: 'active';
  refreshAfter: string;
}

export interface ActivateEntitlementFailureV1 {
  ok: false;
  schemaVersion: 1;
  code: EntitlementFailureCode;
  retryable: boolean;
}

export type ActivateEntitlementResultV1 = ActivateEntitlementSuccessV1 | ActivateEntitlementFailureV1;

export interface EntitlementServiceDependencies {
  environment: 'test' | 'production';
  storeId: string;
  productId: string;
  /** Legacy single-variant compatibility maps to Premium. */
  variantId?: string;
  variantIds?: Readonly<Partial<Record<ArtistOSEdition, string>>>;
  store: EntitlementStore;
  vendor: LicenseVendor;
  signingKeyId: string;
  signingPrivateKey: EntitlementSigningKey;
  verificationKeyring: ArtistOSEntitlementKeyring;
  now?: () => Date;
  randomUuid?: () => string;
}

export class EntitlementService {
  private readonly now: () => Date;
  private readonly randomUuid: () => string;

  constructor(private readonly dependencies: EntitlementServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.randomUuid = dependencies.randomUuid ?? (() => crypto.randomUUID());
  }

  async activate(input: unknown): Promise<ActivateEntitlementResultV1> {
    if (!validateActivateEntitlementRequest(input)) return failure('INVALID_REQUEST', false);
    const request: ActivateEntitlementRequestV1 = input;
    const normalizedEmail = request.email.toLowerCase();
    const normalizedLicenseKey = request.licenseKey.trim();
    const licenseDigest = await sha256Hex(normalizedLicenseKey);
    const operationId = await sha256Hex(`${this.dependencies.environment}\0${licenseDigest}\0${request.installationId}`);

    const existingBinding = await this.dependencies.store.getBinding(
      this.dependencies.environment,
      licenseDigest,
      request.installationId,
    );
    if (existingBinding?.status === 'revoked') return failure('LICENSE_DISABLED', false);
    if (existingBinding?.status === 'active') {
      return this.successFromStoredBinding(existingBinding, normalizedLicenseKey, request.installationId);
    }

    const now = this.now();
    const leaseToken = this.randomUuid();
    const begun = await this.dependencies.store.beginActivation({
      operationId,
      environment: this.dependencies.environment,
      licenseDigest,
      installationId: request.installationId,
      requestId: request.requestId,
      leaseToken,
      now: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 30_000).toISOString(),
    });
    if (!begun.ownsLease) {
      if (begun.operation.responseJson) return parseStoredFailure(begun.operation.responseJson);
      return failure('SERVICE_UNAVAILABLE', true);
    }

    try {
      const instanceName = installationLabel(request.installationId);
      const inspected = await this.dependencies.vendor.inspect(normalizedLicenseKey);
      const edition = this.editionForVariant(inspected.variantId);
      if (!edition) return await this.fail(operationId, leaseToken, 'WRONG_PRODUCT', false);
      const inspectionFailure = validateVendorLicense(inspected, {
        storeId: this.dependencies.storeId,
        productId: this.dependencies.productId,
        variantId: this.variantForEdition(edition),
        email: normalizedEmail,
      });
      if (inspectionFailure) return await this.fail(operationId, leaseToken, inspectionFailure, false);
      const inspectedOrderFailure = await this.validateVendorOrder(inspected.orderId);
      if (inspectedOrderFailure) return await this.fail(operationId, leaseToken, inspectedOrderFailure, false);
      const instances = await this.dependencies.vendor.listInstances(normalizedLicenseKey);
      const matched = instances.filter((instance) => instance.name === instanceName);
      if (matched.length > 1) return await this.fail(operationId, leaseToken, 'INTERNAL_ERROR', false);
      const vendorResult = matched.length === 1
        ? await this.dependencies.vendor.validate(normalizedLicenseKey, matched[0]!.id)
        : await this.dependencies.vendor.activate(normalizedLicenseKey, instanceName);
      if (this.editionForVariant(vendorResult.variantId) !== edition) {
        return await this.fail(operationId, leaseToken, 'WRONG_PRODUCT', false);
      }
      const failureCode = validateVendorActivation(vendorResult, {
        storeId: this.dependencies.storeId,
        productId: this.dependencies.productId,
        variantId: this.variantForEdition(edition),
        email: normalizedEmail,
        instanceName,
      });
      if (failureCode) return await this.fail(operationId, leaseToken, failureCode, false);
      const orderFailure = await this.validateVendorOrder(vendorResult.orderId);
      if (orderFailure) return await this.fail(operationId, leaseToken, orderFailure, false);

      const issuedAt = this.now();
      const refreshAfter = new Date(issuedAt.getTime() + 24 * 60 * 60_000);
      const entitlement: ArtistOSEntitlementV1 = {
        schemaVersion: 1,
        issuer: 'https://license.artistos.app',
        audience: ARTIST_OS_APP_ID,
        entitlementId: this.randomUuid(),
        vendor: 'lemon-squeezy',
        vendorLicenseId: vendorResult.licenseId,
        product: ARTIST_OS_PRODUCT,
        edition,
        plan: planForArtistOSEdition(edition),
        majorVersion: 1,
        distributionChannel: 'direct',
        installationId: request.installationId,
        activationInstanceId: vendorResult.instance!.id,
        seatLimit: ARTIST_OS_SEAT_LIMIT,
        status: 'active',
        issuedAt: issuedAt.toISOString(),
        lastValidatedAt: issuedAt.toISOString(),
        refreshAfter: refreshAfter.toISOString(),
      };
      const signedEntitlement = await signArtistOSEntitlement(
        entitlement,
        this.dependencies.signingKeyId,
        this.dependencies.signingPrivateKey,
        issuedAt.getTime(),
      );
      const maskedEmail = maskEmail(normalizedEmail);
      const binding: ActivationBindingRecord = {
        bindingId: this.randomUuid(),
        environment: this.dependencies.environment,
        licenseDigest,
        installationId: request.installationId,
        entitlementId: entitlement.entitlementId,
        vendorLicenseId: vendorResult.licenseId,
        vendorOrderId: vendorResult.orderId,
        activationInstanceId: vendorResult.instance!.id,
        maskedEmail,
        signedEntitlement,
        status: 'active',
        lastValidatedAt: issuedAt.toISOString(),
        createdAt: issuedAt.toISOString(),
        updatedAt: issuedAt.toISOString(),
      };
      const response: ActivateEntitlementSuccessV1 = {
        ok: true,
        schemaVersion: 1,
        signedEntitlement,
        maskedEmail,
        lastFour: normalizedLicenseKey.slice(-4),
        seatLimit: ARTIST_OS_SEAT_LIMIT,
        status: 'active',
        refreshAfter: refreshAfter.toISOString(),
      };
      const responseJson = JSON.stringify(response);
      await this.dependencies.store.completeActivation(operationId, leaseToken, binding, responseJson, issuedAt.toISOString());
      return response;
    } catch (error) {
      await this.dependencies.store.markActivationUncertain(operationId, leaseToken, this.now().toISOString());
      return failure(error instanceof LicenseVendorError && error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', true);
    }
  }

  async validate(input: unknown): Promise<ActivateEntitlementResultV1> {
    if (!validateValidateEntitlementRequest(input)) return failure('INVALID_REQUEST', false);
    const normalizedEmail = input.email.toLowerCase();
    const normalizedLicenseKey = input.licenseKey.trim();
    const licenseDigest = await sha256Hex(normalizedLicenseKey);
    const binding = await this.dependencies.store.getBinding(this.dependencies.environment, licenseDigest, input.installationId);
    if (!binding || binding.activationInstanceId !== input.activationInstanceId) return failure('INSTANCE_NOT_FOUND', false);
    if (binding.status === 'revoked') return failure('LICENSE_DISABLED', false);
    const verified = await verifyArtistOSEntitlementToken(input.signedEntitlement, this.dependencies.verificationKeyring, {
      installationId: input.installationId,
      appId: ARTIST_OS_APP_ID,
      product: ARTIST_OS_PRODUCT,
      majorVersion: 1,
      distributionChannel: 'direct',
    });
    if (!verified.ok
      || verified.entitlement.entitlementId !== binding.entitlementId
      || verified.entitlement.vendorLicenseId !== binding.vendorLicenseId
      || verified.entitlement.activationInstanceId !== binding.activationInstanceId) return failure('INVALID_LICENSE', false);

    try {
      const vendorResult = await this.dependencies.vendor.validate(normalizedLicenseKey, binding.activationInstanceId);
      const expectedVariantId = this.variantForEdition(verified.entitlement.edition);
      const code = validateVendorActivation(vendorResult, {
        storeId: this.dependencies.storeId,
        productId: this.dependencies.productId,
        variantId: expectedVariantId,
        email: normalizedEmail,
        instanceName: installationLabel(input.installationId),
      });
      if (code) return failure(code, false);
      const orderFailure = await this.validateVendorOrder(vendorResult.orderId);
      if (orderFailure) return this.failAndRevokeBinding(binding, orderFailure);
      const now = this.now();
      const refreshAfter = new Date(now.getTime() + 24 * 60 * 60_000);
      const refreshed: ArtistOSEntitlementV1 = {
        ...verified.entitlement,
        issuedAt: now.toISOString(),
        lastValidatedAt: now.toISOString(),
        refreshAfter: refreshAfter.toISOString(),
        status: 'active',
      };
      const signedEntitlement = await signArtistOSEntitlement(refreshed, this.dependencies.signingKeyId, this.dependencies.signingPrivateKey, now.getTime());
      const bindingRefreshed = await this.dependencies.store.updateBinding({
        ...binding,
        vendorOrderId: vendorResult.orderId,
        signedEntitlement,
        status: 'active',
        lastValidatedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }, 'active');
      if (!bindingRefreshed) return failure('LICENSE_DISABLED', false);
      return {
        ok: true, schemaVersion: 1, signedEntitlement, maskedEmail: binding.maskedEmail,
        lastFour: normalizedLicenseKey.slice(-4), seatLimit: 3, status: 'active',
        refreshAfter: refreshAfter.toISOString(),
      };
    } catch (error) {
      return failure(error instanceof LicenseVendorError && error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', true);
    }
  }

  async deactivate(input: unknown): Promise<{ ok: true; schemaVersion: 1 } | ActivateEntitlementFailureV1> {
    if (!validateValidateEntitlementRequest(input)) return failure('INVALID_REQUEST', false);
    const normalizedLicenseKey = input.licenseKey.trim();
    const licenseDigest = await sha256Hex(normalizedLicenseKey);
    const binding = await this.dependencies.store.getBinding(this.dependencies.environment, licenseDigest, input.installationId);
    if (!binding || binding.activationInstanceId !== input.activationInstanceId) return failure('INSTANCE_NOT_FOUND', false);
    const verified = await verifyArtistOSEntitlementToken(input.signedEntitlement, this.dependencies.verificationKeyring, {
      installationId: input.installationId, appId: ARTIST_OS_APP_ID, product: ARTIST_OS_PRODUCT,
      majorVersion: 1, distributionChannel: 'direct',
    });
    if (!verified.ok || verified.entitlement.entitlementId !== binding.entitlementId) return failure('INVALID_LICENSE', false);
    try {
      const result = await this.dependencies.vendor.deactivate(normalizedLicenseKey, binding.activationInstanceId);
      if (!result.valid || result.instance?.id !== binding.activationInstanceId) {
        const remaining = await this.dependencies.vendor.listInstances(normalizedLicenseKey);
        if (remaining.some((instance) => instance.id === binding.activationInstanceId)) {
          return failure(result.status === 'disabled' ? 'LICENSE_DISABLED' : 'INSTANCE_NOT_FOUND', false);
        }
      }
      await this.dependencies.store.removeBinding(binding.bindingId);
      return { ok: true, schemaVersion: 1 };
    } catch (error) {
      return failure(error instanceof LicenseVendorError && error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', true);
    }
  }

  private async fail(operationId: string, leaseToken: string, code: EntitlementFailureCode, retryable: boolean): Promise<ActivateEntitlementFailureV1> {
    const response = failure(code, retryable);
    await this.dependencies.store.markActivationFailed(operationId, leaseToken, code, JSON.stringify(response), this.now().toISOString());
    return response;
  }

  private async successFromStoredBinding(
    binding: ActivationBindingRecord,
    licenseKey: string,
    installationId: string,
  ): Promise<ActivateEntitlementResultV1> {
    if (binding.status === 'revoked') return failure('LICENSE_DISABLED', false);
    const verified = await verifyArtistOSEntitlementToken(binding.signedEntitlement, this.dependencies.verificationKeyring, {
      installationId,
      appId: ARTIST_OS_APP_ID,
      product: ARTIST_OS_PRODUCT,
      majorVersion: 1,
      distributionChannel: 'direct',
    });
    if (!verified.ok
      || verified.entitlement.entitlementId !== binding.entitlementId
      || verified.entitlement.vendorLicenseId !== binding.vendorLicenseId
      || verified.entitlement.activationInstanceId !== binding.activationInstanceId
      || verified.entitlement.status !== 'active') return failure('INTERNAL_ERROR', false);
    try {
      const vendorResult = await this.dependencies.vendor.validate(licenseKey, binding.activationInstanceId);
      const code = validateVendorActivation(vendorResult, {
        storeId: this.dependencies.storeId,
        productId: this.dependencies.productId,
        variantId: this.variantForEdition(verified.entitlement.edition),
        email: '',
        instanceName: installationLabel(installationId),
      }, { skipEmail: true });
      if (code) return failure(code, false);
      const orderFailure = await this.validateVendorOrder(vendorResult.orderId);
      if (orderFailure) return this.failAndRevokeBinding(binding, orderFailure);
      return {
        ok: true, schemaVersion: 1, signedEntitlement: binding.signedEntitlement,
        maskedEmail: binding.maskedEmail, lastFour: licenseKey.slice(-4), seatLimit: 3,
        status: 'active', refreshAfter: verified.entitlement.refreshAfter,
      };
    } catch (error) {
      return failure(error instanceof LicenseVendorError && error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'SERVICE_UNAVAILABLE', true);
    }
  }

  private async validateVendorOrder(orderId: string): Promise<EntitlementFailureCode | null> {
    const order = await this.dependencies.vendor.getOrder(orderId);
    if (order.orderId !== orderId || order.storeId !== this.dependencies.storeId
      || order.testMode !== (this.dependencies.environment === 'test')) return 'WRONG_PRODUCT';
    const observedAt = this.now().toISOString();
    await this.dependencies.store.recordOrderLifecycle({
      environment: this.dependencies.environment,
      vendorOrderId: order.orderId,
      status: order.status,
      vendorUpdatedAt: order.updatedAt,
      eventDigest: await sha256Hex(`order-api\0${order.orderId}\0${order.status}\0${order.updatedAt}`),
      updatedAt: observedAt,
    });
    if (order.status === 'paid') return null;
    if (order.status === 'refunded' || order.status === 'partial_refund' || order.status === 'fraudulent') {
      return 'LICENSE_DISABLED';
    }
    return 'INVALID_LICENSE';
  }

  private async failAndRevokeBinding(
    binding: ActivationBindingRecord,
    code: EntitlementFailureCode,
  ): Promise<ActivateEntitlementFailureV1> {
    if (code === 'LICENSE_DISABLED') {
      const now = this.now().toISOString();
      await this.dependencies.store.updateBinding({ ...binding, status: 'revoked', updatedAt: now });
    }
    return failure(code, false);
  }

  private editionForVariant(variantId: string): ArtistOSEdition | null {
    if (this.dependencies.variantIds?.[ARTIST_OS_BASIC_EDITION] === variantId) return ARTIST_OS_BASIC_EDITION;
    if ((this.dependencies.variantIds?.[ARTIST_OS_PREMIUM_EDITION] ?? this.dependencies.variantId) === variantId) {
      return ARTIST_OS_PREMIUM_EDITION;
    }
    return null;
  }

  private variantForEdition(edition: ArtistOSEdition): string {
    const variantId = this.dependencies.variantIds?.[edition]
      ?? (edition === ARTIST_OS_PREMIUM_EDITION ? this.dependencies.variantId : undefined);
    if (!variantId) throw new Error(`Missing Lemon variant for Artist OS ${edition}`);
    return variantId;
  }
}

function validateVendorActivation(
  result: VendorLicenseResult,
  expected: { storeId: string; productId: string; variantId: string; email: string; instanceName: string },
  options: { skipEmail?: boolean } = {},
): EntitlementFailureCode | null {
  if (!result.valid) {
    if (result.status === 'expired') return 'LICENSE_EXPIRED';
    if (result.status === 'disabled') return 'LICENSE_DISABLED';
    if (/limit/i.test(result.error ?? '')) return 'SEAT_LIMIT_REACHED';
    return 'INVALID_LICENSE';
  }
  if (result.storeId !== expected.storeId || result.productId !== expected.productId || result.variantId !== expected.variantId) return 'WRONG_PRODUCT';
  if (!options.skipEmail && result.customerEmail.trim().toLowerCase() !== expected.email) return 'EMAIL_MISMATCH';
  if (result.status !== 'active' || result.expiresAt !== null) return result.status === 'expired' ? 'LICENSE_EXPIRED' : 'INVALID_LICENSE';
  if (result.activationLimit !== ARTIST_OS_SEAT_LIMIT || result.activationUsage > ARTIST_OS_SEAT_LIMIT) return 'WRONG_PRODUCT';
  if (!result.instance || result.instance.name !== expected.instanceName) return 'INSTANCE_NOT_FOUND';
  return null;
}

function validateVendorLicense(
  result: VendorLicenseResult,
  expected: { storeId: string; productId: string; variantId: string; email: string },
): EntitlementFailureCode | null {
  if (!result.valid) {
    if (result.status === 'expired') return 'LICENSE_EXPIRED';
    if (result.status === 'disabled') return 'LICENSE_DISABLED';
    if (/limit/i.test(result.error ?? '')) return 'SEAT_LIMIT_REACHED';
    return 'INVALID_LICENSE';
  }
  if (result.storeId !== expected.storeId || result.productId !== expected.productId || result.variantId !== expected.variantId) return 'WRONG_PRODUCT';
  if (result.customerEmail.trim().toLowerCase() !== expected.email) return 'EMAIL_MISMATCH';
  if ((result.status !== 'active' && result.status !== 'inactive') || result.expiresAt !== null) {
    return result.status === 'expired' ? 'LICENSE_EXPIRED' : 'INVALID_LICENSE';
  }
  if (result.activationLimit !== ARTIST_OS_SEAT_LIMIT || result.activationUsage > ARTIST_OS_SEAT_LIMIT) return 'WRONG_PRODUCT';
  if (result.instance !== null) return 'INVALID_LICENSE';
  return null;
}

function failure(code: EntitlementFailureCode, retryable: boolean): ActivateEntitlementFailureV1 {
  return { ok: false, schemaVersion: 1, code, retryable };
}

function parseStoredFailure(json: string): ActivateEntitlementFailureV1 {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored activation result is corrupt');
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (keys !== 'code,ok,retryable,schemaVersion'
    || record.ok !== false
    || record.schemaVersion !== 1
    || typeof record.retryable !== 'boolean'
    || !isFailureCode(record.code)) throw new Error('Stored activation result is corrupt');
  return record as unknown as ActivateEntitlementFailureV1;
}

function isFailureCode(value: unknown): value is EntitlementFailureCode {
  return typeof value === 'string' && [
    'INVALID_REQUEST', 'INVALID_LICENSE', 'EMAIL_MISMATCH', 'WRONG_PRODUCT', 'SEAT_LIMIT_REACHED',
    'LICENSE_EXPIRED', 'LICENSE_DISABLED', 'INSTANCE_NOT_FOUND', 'SERVICE_UNAVAILABLE',
    'RATE_LIMITED', 'INTERNAL_ERROR',
  ].includes(value);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local?.slice(0, 1) ?? '*'}***@${domain ?? '***'}`;
}

function installationLabel(installationId: string): string {
  return `Mac installation • ${installationId.replaceAll('-', '').slice(-6).toUpperCase()}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
