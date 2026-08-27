import {
  type ActivateEntitlementRequestV1,
  type EntitlementFailureCode,
  type ValidateEntitlementRequestV1,
} from '@craft-agent/shared/licensing';
import type { DesktopEntitlementServiceClient, EntitlementServiceFailure, EntitlementServiceResult } from './desktop-authority.ts';

const MAX_RESPONSE_BYTES = 32 * 1024;
const FAILURE_CODES = new Set<EntitlementFailureCode>([
  'INVALID_REQUEST', 'INVALID_LICENSE', 'EMAIL_MISMATCH', 'WRONG_PRODUCT', 'SEAT_LIMIT_REACHED',
  'LICENSE_EXPIRED', 'LICENSE_DISABLED', 'INSTANCE_NOT_FOUND', 'SERVICE_UNAVAILABLE', 'RATE_LIMITED', 'INTERNAL_ERROR',
]);

export type DesktopLicenseFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class HttpDesktopEntitlementServiceClient implements DesktopEntitlementServiceClient {
  private readonly origin: string;

  constructor(baseUrl: string, private readonly fetcher: DesktopLicenseFetch = fetch) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new Error('Entitlement service must use HTTPS');
    }
    this.origin = url.origin;
  }

  activate(input: ActivateEntitlementRequestV1): Promise<EntitlementServiceResult> {
    return this.post('/v1/entitlements/activate', input, false) as Promise<EntitlementServiceResult>;
  }

  validate(input: ValidateEntitlementRequestV1): Promise<EntitlementServiceResult> {
    return this.post('/v1/entitlements/validate', input, false) as Promise<EntitlementServiceResult>;
  }

  deactivate(input: ValidateEntitlementRequestV1): Promise<{ ok: true } | EntitlementServiceFailure> {
    return this.post('/v1/entitlements/deactivate', input, true);
  }

  private async post(path: string, input: unknown, deactivate: boolean): Promise<EntitlementServiceResult | { ok: true } | { ok: false; code: EntitlementFailureCode; retryable: boolean }> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      return { ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true };
    }
    const declared = Number(response.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return unavailable();
    let value: unknown;
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_RESPONSE_BYTES) return unavailable();
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { return unavailable(); }
    if (isFailure(value)) return value;
    if (!response.ok || !isRecord(value) || value.ok !== true || value.schemaVersion !== 1) return unavailable();
    if (deactivate) {
      if (Object.keys(value).sort().join('\0') !== ['ok', 'schemaVersion'].join('\0')) return unavailable();
      return { ok: true };
    }
    const keys = ['lastFour', 'maskedEmail', 'ok', 'refreshAfter', 'schemaVersion', 'seatLimit', 'signedEntitlement', 'status'];
    if (Object.keys(value).sort().join('\0') !== keys.join('\0')) return unavailable();
    if (typeof value.signedEntitlement !== 'string' || value.signedEntitlement.length > 16 * 1024
      || typeof value.maskedEmail !== 'string' || typeof value.lastFour !== 'string' || value.lastFour.length !== 4
      || value.seatLimit !== 3 || value.status !== 'active' || typeof value.refreshAfter !== 'string') return unavailable();
    return value as unknown as EntitlementServiceResult;
  }
}

function isFailure(input: unknown): input is EntitlementServiceFailure {
  if (!isRecord(input)) return false;
  return Object.keys(input).sort().join('\0') === ['code', 'correlationId', 'ok', 'retryable', 'safeMessage', 'schemaVersion'].join('\0')
    && input.ok === false && input.schemaVersion === 1 && typeof input.code === 'string'
    && FAILURE_CODES.has(input.code as EntitlementFailureCode) && typeof input.retryable === 'boolean'
    && typeof input.correlationId === 'string' && /^[0-9a-f-]{36}$/i.test(input.correlationId)
    && typeof input.safeMessage === 'string' && input.safeMessage.length > 0 && input.safeMessage.length <= 200;
}

function unavailable() {
  return { ok: false as const, code: 'SERVICE_UNAVAILABLE' as const, retryable: true };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input);
}
