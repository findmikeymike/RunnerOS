import { expect, test } from 'bun:test';
import { McpClientPool } from '../../mcp/mcp-pool.ts';
import { createApiServer } from '../api-tools.ts';

test('rebuilding an API source replaces its endpoint and credential for fresh calls', async () => {
  const pool = new McpClientPool();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; authorization: string | undefined }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), authorization: (init?.headers as any)?.Authorization });
    return Response.json({ ok: true });
  }) as typeof fetch;
  try {
    const first = createApiServer({ name: 'example', baseUrl: 'https://old.example/api', auth: { type: 'bearer' } } as any, 'old-token');
    const second = createApiServer({ name: 'example', baseUrl: 'https://new.example/api', auth: { type: 'bearer' } } as any, 'new-token');
    await pool.sync({}, { example: first });
    await pool.sync({}, { example: second });
    await pool.callTool('mcp__example__api_example', { method: 'GET', path: '/ping' });
    expect(requests).toEqual([{ url: 'https://new.example/api/ping', authorization: 'Bearer new-token' }]);
  } finally { globalThis.fetch = originalFetch; await pool.disconnectAll(); }
});

test('resyncing the same API instance keeps its existing connection', async () => {
  const pool = new McpClientPool();
  const server = createApiServer({ name: 'example', baseUrl: 'https://example.invalid', auth: { type: 'none' } } as any, '');
  const connect = server.instance.connect.bind(server.instance);
  let connections = 0;
  server.instance.connect = async (...args) => { connections++; return connect(...args); };
  try {
    await pool.sync({}, { example: server });
    await pool.sync({}, { example: server });
    expect(connections).toBe(1);
    expect(pool.getConnectedSlugs()).toEqual(['example']);
  } finally { await pool.disconnectAll(); }
});
