import { expect, test } from 'bun:test';
import { McpClientPool } from '../src/mcp/mcp-pool.ts';
import type { PoolClient } from '../src/mcp/client.ts';
import type { SdkMcpServerConfig } from '../src/agent/backend/types.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const tools = [{ name: 'request', inputSchema: { type: 'object' as const } }];
const content = (text: string) => ({ content: [{ type: 'text', text }] });
class TestPool extends McpClientPool {
  factory: (config: SdkMcpServerConfig) => PoolClient = () => ({
    listTools: async () => tools, callTool: async () => content('ok'), close: async () => {},
  });
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    if (await this.registerClient(slug, this.factory(config))) this.activeConfigs.set(slug, config);
  }
}

test('changed credential-store headers apply to the next request', async () => {
  const pool = new TestPool();
  pool.factory = config => ({ listTools: async () => tools,
    callTool: async () => content(String((config as any).headers['X-API-Key'])), close: async () => {},
  });
  try {
    await pool.sync({ source: { type: 'http', url: 'https://example.invalid', headers: { 'X-API-Key': 'old-key' } } });
    await pool.sync({ source: { type: 'http', url: 'https://example.invalid', headers: { 'X-API-Key': 'new-key' } } });
    expect((await pool.callTool('mcp__source__request', {})).content).toBe('new-key');
  } finally { await pool.disconnectAll(); }
});

test('a late connection cannot resurrect a source removed by a newer sync', async () => {
  const pool = new TestPool();
  const started = deferred<void>();
  const finishConnect = deferred<void>();
  let closed = 0;
  pool.factory = () => ({
    listTools: async () => { started.resolve(); await finishConnect.promise; return tools; },
    callTool: async () => content('removed source'), close: async () => { closed++; },
  });
  const older = pool.sync({ source: { type: 'http', url: 'https://example.invalid' } });
  try {
    await started.promise;
    await pool.sync({});
    finishConnect.resolve();
    await older;
    expect(pool.getConnectedSlugs()).toEqual([]);
    expect((await pool.callTool('mcp__source__request', {})).isError).toBe(true);
    expect(closed).toBe(1);
  } finally { finishConnect.resolve(); await older; await pool.disconnectAll(); }
});

test('replacement routes new requests immediately while an old request keeps its receipt', async () => {
  const pool = new TestPool();
  const started = deferred<void>();
  const receipt = deferred<void>();
  let oldClosed = 0;
  pool.factory = config => {
    const old = (config as any).url.endsWith('/old');
    return {
      listTools: async () => tools,
      callTool: async () => {
        if (!old) return content('new connection');
        started.resolve();
        await receipt.promise;
        if (oldClosed) throw new Error('Client closed before original receipt arrived');
        return content('original receipt');
      },
      close: async () => { if (old) oldClosed++; },
    };
  };
  await pool.sync({ source: { type: 'http', url: 'https://example.invalid/old' } });
  const inFlight = pool.callTool('mcp__source__request', {});
  try {
    await started.promise;
    await pool.sync({ source: { type: 'http', url: 'https://example.invalid/new' } });
    expect((await pool.callTool('mcp__source__request', {})).content).toBe('new connection');
    expect(oldClosed).toBe(0);
    receipt.resolve();
    const result = await inFlight;
    expect(result.isError).toBe(false);
    expect(result.content).toBe('original receipt');
    expect(oldClosed).toBe(1);
  } finally { receipt.resolve(); await inFlight; await pool.disconnectAll(); }
});
