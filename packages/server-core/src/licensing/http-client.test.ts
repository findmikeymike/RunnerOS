import { describe, expect, test } from 'bun:test';
import { HttpDesktopEntitlementServiceClient } from './http-client.ts';

const request = {
  schemaVersion: 1 as const,
  email: 'writer@example.com',
  licenseKey: 'LICENSE-KEY-1234',
  installationId: '123e4567-e89b-42d3-a456-426614174000',
  appVersion: '1.0.0',
  platform: 'macos' as const,
  architecture: 'arm64' as const,
  requestId: '223e4567-e89b-42d3-a456-426614174000',
};

describe('LIC3 desktop entitlement HTTP client', () => {
  test('uses only the configured HTTPS origin and accepts the exact success envelope', async () => {
    const calls: Request[] = [];
    const client = new HttpDesktopEntitlementServiceClient('https://license.artistos.app/path-is-ignored', async (input, init) => {
      calls.push(new Request(String(input), init));
      return Response.json({
        ok: true, schemaVersion: 1, signedEntitlement: 'a.b.c', maskedEmail: 'w***@example.com',
        lastFour: '1234', seatLimit: 3, status: 'active', refreshAfter: '2026-09-22T18:00:00.000Z',
      });
    });
    expect(await client.activate(request)).toMatchObject({ ok: true, lastFour: '1234' });
    expect(calls[0]?.url).toBe('https://license.artistos.app/v1/entitlements/activate');
    expect(calls[0]?.redirect).toBe('error');
  });

  test('maps network, oversized, malformed, and unknown response fields to safe downtime', async () => {
    const failures = [
      async () => { throw new Error('secret host failure'); },
      async () => new Response('x', { headers: { 'Content-Length': String(33 * 1024) } }),
      async () => Response.json({ ok: true, schemaVersion: 1, secret: 'unexpected' }),
    ];
    for (const fetcher of failures) {
      const client = new HttpDesktopEntitlementServiceClient('https://license.artistos.app', fetcher);
      expect(await client.activate(request)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE', retryable: true });
    }
  });

  test('accepts only safe correlated public failures', async () => {
    const client = new HttpDesktopEntitlementServiceClient('https://license.artistos.app', async () => Response.json({
      ok: false,
      schemaVersion: 1,
      code: 'RATE_LIMITED',
      retryable: true,
      correlationId: '123e4567-e89b-42d3-a456-426614174000',
      safeMessage: 'Too many license requests. Wait a moment and try again.',
    }, { status: 429 }));
    expect(await client.activate(request)).toEqual({
      ok: false,
      schemaVersion: 1,
      code: 'RATE_LIMITED',
      retryable: true,
      correlationId: '123e4567-e89b-42d3-a456-426614174000',
      safeMessage: 'Too many license requests. Wait a moment and try again.',
    });
  });

  test('rejects insecure remote service configuration', () => {
    expect(() => new HttpDesktopEntitlementServiceClient('http://license.example.com')).toThrow('HTTPS');
  });
});
