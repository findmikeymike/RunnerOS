import { expect, test } from 'bun:test';
import type { PoolClient } from '@craft-agent/shared/mcp';
import { MonidSignalError, withMonidRunRetrieval } from './monid-transcript';

function fixture(fetcher: (url: string | URL | Request, options?: RequestInit) => Promise<Response>) {
  const calls: string[] = [];
  const base: PoolClient = {
    listTools: async () => [],
    callTool: async name => { calls.push(name); return { forwarded: true }; },
    close: async () => { calls.push('close'); },
  };
  return { calls, client: withMonidRunRetrieval(base, 'private-token', fetcher as typeof fetch) };
}
test('saved results use bounded read-only REST; submissions remain on MCP', async () => {
  const result = { runId: 'saved-run', status: 'COMPLETED', output: [{ text: 'evidence' }] };
  const f = fixture(async (url, options) => {
    expect(url).toBe('https://api.monid.ai/v1/runs/saved-run');
    expect(options?.method).toBe('GET');
    expect(options?.headers).toEqual({ Authorization: 'Bearer private-token', Accept: 'application/json' });
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return Response.json(result);
  });
  expect(await f.client.callTool('monid_get_run', { runId: 'saved-run' })).toEqual(result);
  expect(await f.client.callTool('monid_run', {})).toEqual({ forwarded: true });
  expect(await f.client.listTools()).toEqual([]);
  await f.client.close();
  expect(f.calls).toEqual(['monid_run', 'close']);
});
test('invalid run IDs never reach the network', async () => {
  let requests = 0;
  const f = fixture(async () => { requests++; return Response.json({}); });
  for (const runId of ['../credentials', '', undefined, 'a?token=x']) {
    const error = await f.client.callTool('monid_get_run', { runId }).catch(error => error);
    if (!(error instanceof MonidSignalError)) throw new Error('Expected Monid failure');
    expect(error.message).toContain('Invalid saved');
  }
  expect(requests).toBe(0);
});
test('remote errors retain saved run identity without leaking response bodies', async () => {
  for (const status of [401, 403, 500]) {
    const f = fixture(async () => new Response('private-token secret provider body', { status }));
    const error = await f.client.callTool('monid_get_run', { runId: 'saved-run' }).catch(error => error);
    if (!(error instanceof MonidSignalError)) throw new Error('Expected Monid failure');
    expect(error.runId).toBe('saved-run');
    expect(error.fallbackAllowed).toBe(false);
    expect(error.message).not.toContain('private-token');
    expect(error.message).not.toContain('provider body');
  }
});
test('malformed and oversized results fail safely', async () => {
  for (const body of ['private-token invalid json', 'x'.repeat(3 * 1024 * 1024 + 1)]) {
    const f = fixture(async () => new Response(body));
    const error = await f.client.callTool('monid_get_run', { runId: 'saved-run' }).catch(error => error);
    if (!(error instanceof MonidSignalError)) throw new Error('Expected Monid failure');
    expect(error.runId).toBe('saved-run');
    expect(error.message).not.toContain('private-token');
  }
});
test('closing the client aborts an in-flight result read', async () => {
  const f = fixture(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('private-token abort')));
  }));
  const pending = f.client.callTool('monid_get_run', { runId: 'saved-run' }).catch(error => error);
  await f.client.close();
  const error = await pending;
  if (!(error instanceof MonidSignalError)) throw new Error('Expected Monid failure');
  expect(error.runId).toBe('saved-run');
  expect(error.message).toContain('without another submission');
  expect(error.message).not.toContain('private-token');
});
test('a stalled result read ends at its deadline and preserves the receipt', async () => {
  const f = fixture(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(new Error('upstream stalled')));
  }));
  const started = Date.now();
  const error = await f.client.callTool('monid_get_run', { runId: 'saved-run' }).catch(error => error);
  if (!(error instanceof MonidSignalError)) throw new Error('Expected Monid failure');
  expect(Date.now() - started).toBeLessThan(24_000);
  expect(error.runId).toBe('saved-run');
  expect(error.fallbackAllowed).toBe(false);
  expect(f.calls).toEqual([]);
}, 25_000);
