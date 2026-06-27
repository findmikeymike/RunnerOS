import { describe, expect, test } from 'bun:test';
import { createApiTool } from '../api-tools.ts';
import type { ApiConfig } from '../types.ts';

interface MinimalTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function captureFetch(): {
  restore: () => void;
  lastHeaders: () => Record<string, string> | null;
  callCount: () => number;
} {
  const originalFetch = globalThis.fetch;
  let lastHeaders: Record<string, string> | null = null;
  let calls = 0;

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    lastHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    lastHeaders: () => lastHeaders,
    callCount: () => calls,
  };
}

describe('createApiTool credential freshness', () => {
  test('bearer auth getter is called on every request', async () => {
    let currentToken = 'token-A';
    const config: ApiConfig = {
      name: 'test-bearer',
      baseUrl: 'https://example.test/',
      auth: { type: 'bearer', authScheme: 'Bearer' },
    };
    const tool = createApiTool(config, async () => currentToken) as unknown as MinimalTool;
    const fetchStub = captureFetch();

    try {
      await tool.handler({ path: '/ping', method: 'GET' });
      expect(fetchStub.lastHeaders()?.Authorization).toBe('Bearer token-A');

      currentToken = 'token-B';
      await tool.handler({ path: '/ping', method: 'GET' });

      expect(fetchStub.lastHeaders()?.Authorization).toBe('Bearer token-B');
      expect(fetchStub.callCount()).toBe(2);
    } finally {
      fetchStub.restore();
    }
  });

  test('static string credential keeps legacy captured behavior', async () => {
    const config: ApiConfig = {
      name: 'test-bearer',
      baseUrl: 'https://example.test/',
      auth: { type: 'bearer', authScheme: 'Bearer' },
    };
    const tool = createApiTool(config, 'static-token') as unknown as MinimalTool;
    const fetchStub = captureFetch();

    try {
      await tool.handler({ path: '/ping', method: 'GET' });
      expect(fetchStub.lastHeaders()?.Authorization).toBe('Bearer static-token');

      await tool.handler({ path: '/ping', method: 'GET' });
      expect(fetchStub.lastHeaders()?.Authorization).toBe('Bearer static-token');
    } finally {
      fetchStub.restore();
    }
  });

  test('header auth getter resolves a fresh key per request', async () => {
    let currentKey = 'key-A';
    const config: ApiConfig = {
      name: 'test-header',
      baseUrl: 'https://example.test/',
      auth: { type: 'header', headerName: 'X-API-Key' },
    };
    const tool = createApiTool(config, async () => currentKey) as unknown as MinimalTool;
    const fetchStub = captureFetch();

    try {
      await tool.handler({ path: '/ping', method: 'GET' });
      expect(fetchStub.lastHeaders()?.['X-API-Key']).toBe('key-A');

      currentKey = 'key-B';
      await tool.handler({ path: '/ping', method: 'GET' });

      expect(fetchStub.lastHeaders()?.['X-API-Key']).toBe('key-B');
    } finally {
      fetchStub.restore();
    }
  });
});
