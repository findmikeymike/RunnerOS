import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableSourceTools, type DurableSourceWriteMethod } from './durable-source-tools';
import { loadSource } from '../../../shared/src/sources/storage';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture(authType: 'oauth' | 'bearer' | 'query' | 'basic' = 'oauth') {
  const root = mkdtempSync(join(tmpdir(), 'durable-source-tools-')), folder = join(root, 'sources/account');
  mkdirSync(folder, { recursive: true });
  const previous = process.env.CRAFT_CONFIG_DIR; process.env.CRAFT_CONFIG_DIR = join(root, 'config');
  const config = { id: 'account', slug: 'account', name: 'Account', provider: 'custom-provider', type: 'api', enabled: true, isAuthenticated: true, api: { baseUrl: 'https://api.example.com/v1/', authType } };
  const save = () => writeFileSync(join(folder, 'config.json'), JSON.stringify(config)); save();
  writeFileSync(join(folder, 'guide.md'), 'Use /items to inspect records.');
  let generation: string | null = 'generation-one', token = 'synthetic-secret', gets = 0, refreshes = 0;
  let onRefresh = () => {};
  const originalFetch = globalThis.fetch;
  let fetched: { url: string; options?: RequestInit } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => { gets++; fetched = { url: String(url), options }; return new Response('{"items":["saved"]}'); }) as unknown as typeof fetch;
  cleanup.push(() => { globalThis.fetch = originalFetch; if (previous === undefined) delete process.env.CRAFT_CONFIG_DIR; else process.env.CRAFT_CONFIG_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const gateway = createDurableSourceTools({
    getWorkspaces: () => [{ id: 'workspace', name: 'Fixture', slug: 'fixture', rootPath: root, createdAt: 1 }],
    loadSources: workspaceRoot => { const source = loadSource(workspaceRoot, 'account'); return source ? [source] : []; },
    captureCredentialIdentity: async () => generation ? { credentialIdentity: generation } : null,
    getApiCredential: async () => generation ? authType === 'basic' ? { username: 'private-user', password: 'private-password' } : token : null,
    tokenGetter: () => async () => { refreshes++; onRefresh(); token = 'refreshed-synthetic-secret'; return token; },
  });
  return { root, folder, gateway, config, save, getCalls: () => gets, getRefreshes: () => refreshes, fetched: () => fetched,
    onRefresh: (fn: () => void) => { onRefresh = fn; }, revoke: () => { generation = null; }, replace: () => { generation = 'generation-two'; } };
}

test('ordinary shared API server executes OAuth GET with fresh token and read-only model schema', async () => {
  const f = fixture(), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  expect(grant!.modelToolName).toBe('mcp__account__api_account');
  expect(grant!.description).toContain('Use /items');
  expect((grant!.inputSchema as any).properties.method.enum).toEqual(['GET']);
  let fences = 0;
  const result = await f.gateway.execute(grant!, { method: 'GET', path: '/items', params: { limit: 2 } }, () => { fences++; });
  expect(result).toEqual({ content: '{"items":["saved"]}', isError: false });
  expect(f.getCalls()).toBe(1); expect(f.getRefreshes()).toBe(1); expect(fences).toBeGreaterThanOrEqual(2);
  expect(f.fetched()!.options!.redirect).toBe('error');
  expect((f.fetched()!.options!.headers as Record<string, string>).Authorization).toBe('Bearer refreshed-synthetic-secret');
  expect(f.fetched()!.url).toBe('https://api.example.com/v1/items?limit=2');
  await expect(f.gateway.assertCurrent([grant!], 'workspace', f.root)).resolves.toBeUndefined();
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('durable source blocks %s before refresh or fetch', async method => {
  const f = fixture(), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  await expect(f.gateway.execute(grant!, { method, path: '/items' }, () => {})).rejects.toThrow('not-authorized');
  expect(f.getCalls()).toBe(0); expect(f.getRefreshes()).toBe(0);
});

test.each(['remove', 'replace', 'guide', 'policy', 'cancel'])('change during token refresh fences GET: %s', async change => {
  const f = fixture(), [grant] = await f.gateway.capture('workspace', f.root, ['account']); let cancelled = false;
  f.onRefresh(() => {
    if (change === 'remove') f.revoke();
    if (change === 'replace') f.replace();
    if (change === 'guide') writeFileSync(join(f.folder, 'guide.md'), 'Changed instructions');
    if (change === 'policy') writeFileSync(join(f.folder, 'permissions.json'), '{bad-json');
    if (change === 'cancel') cancelled = true;
  });
  await expect(f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => { if (cancelled) throw new Error('cancelled'); })).rejects.toThrow('not-authorized');
  expect(f.getCalls()).toBe(0);
});

test('cached authority rejects removed or replaced credential while bookkeeping changes remain valid', async () => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  Object.assign(f.config, { lastTestedAt: Date.now(), updatedAt: Date.now(), connectionStatus: 'connected' }); f.save();
  expect((await f.gateway.capture('workspace', f.root, ['account']))[0]).toEqual(grant!);
  await f.gateway.assertCurrent([grant!], 'workspace', f.root);
  f.replace(); await expect(f.gateway.assertCurrent([grant!], 'workspace', f.root)).rejects.toThrow('unavailable');
  f.revoke(); await expect(f.gateway.assertCurrent([grant!], 'workspace', f.root)).rejects.toThrow('unavailable');
});

test('path traversal outside source base is stopped before fetch', async () => {
  const f = fixture(), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  await expect(f.gateway.execute(grant!, { method: 'GET', path: '/../outside' }, () => {})).rejects.toThrow('not-authorized');
  expect(f.getCalls()).toBe(0);
});

test('query credential is never exposed in thrown fetch diagnostics', async () => {
  const f = fixture('query'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  globalThis.fetch = (async (url: string | URL | Request) => { throw new Error(`failed ${url}`); }) as unknown as typeof fetch;
  const result = await f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => {});
  expect(result.isError).toBe(true); expect(result.content).not.toContain('synthetic-secret'); expect(result.content).not.toContain('api_key');
});

test('API credential echoes are withheld from saved result', async () => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  globalThis.fetch = (async () => new Response('{"token":"synthetic-secret"}')) as unknown as typeof fetch;
  const result = await f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => {});
  expect(result.isError).toBe(true); expect(result.content).not.toContain('synthetic-secret');
});


test('streamed response cap cancels chunked data without consuming the remaining stream', async () => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  let reads = 0, cancelled = false;
  globalThis.fetch = (async () => new Response(new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(300_000)); },
    cancel() { cancelled = true; },
  }))) as unknown as typeof fetch;
  const result = await f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => {});
  expect(result.isError).toBe(true); expect(cancelled).toBe(true); expect(reads).toBeLessThanOrEqual(3);
});

test.each(['value', 'key'])('JSON unicode escape cannot hide authentication echo in %s', async location => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  const escaped = String.raw`\u0073ynthetic-secret`;
  globalThis.fetch = (async () => new Response(location === 'key' ? `{"${escaped}":true}` : `{"nested":[{"token":"${escaped}"}]}`)) as unknown as typeof fetch;
  const result = await f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => {});
  expect(result.isError).toBe(true); expect(result.content).toContain('withheld');
});

test('Basic credentials encoded without their header scheme are withheld', async () => {
  const f = fixture('basic'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  const encoded = Buffer.from('private-user:private-password').toString('base64');
  globalThis.fetch = (async () => new Response(JSON.stringify({ credential: encoded }))) as unknown as typeof fetch;
  const result = await f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => {});
  expect(result.isError).toBe(true); expect(result.content).not.toContain(encoded); expect(result.content).toContain('withheld');
});

test('effective credential identity tracks its real owner and refuses owner switches during generation capture', async () => {
  const { SourceCredentialManager } = await import('../../../shared/src/sources/credential-manager');
  const { getCredentialManager } = await import('../../../shared/src/credentials');
  const manager = getCredentialManager(), original = manager.captureDurableSourceIdentity;
  const sources = new SourceCredentialManager();
  let owner = 'global', generation = 'stable-generation', switchOwner = false;
  const source = {} as Parameters<typeof sources.captureDurableIdentity>[0];
  (sources as unknown as { resolveEffectiveCredential: () => Promise<unknown> }).resolveEffectiveCredential = async () => ({
    id: { type: 'source_oauth', workspaceId: owner, sourceId: 'account' },
    credential: { value: 'secret-token', durableAuthIdentity: generation },
  });
  manager.captureDurableSourceIdentity = async () => { if (switchOwner) owner = 'workspace'; return generation; };
  try {
    const globalIdentity = await sources.captureDurableIdentity(source);
    expect(globalIdentity).not.toBeNull(); expect(JSON.stringify(globalIdentity)).not.toContain('secret-token');
    owner = 'workspace';
    const workspaceIdentity = await sources.captureDurableIdentity(source);
    expect(workspaceIdentity).not.toEqual(globalIdentity);
    expect(await sources.captureDurableIdentity(source)).toEqual(workspaceIdentity);
    generation = 'replacement-generation';
    expect(await sources.captureDurableIdentity(source)).not.toEqual(workspaceIdentity);
    owner = 'global'; switchOwner = true;
    expect(await sources.captureDurableIdentity(source)).toBeNull();
  } finally { manager.captureDurableSourceIdentity = original; }
});

test('declared write methods are frozen in tools and require Ask approval while GET stays automatic', async () => {
  const f = fixture(), [grant] = await f.gateway.capture('workspace', f.root, ['account'], [{ sourceSlug: 'account', methods: ['PATCH', 'POST'] }]);
  expect(grant!.writeMethods).toEqual(['POST', 'PATCH']);
  expect((grant!.inputSchema as any).properties.method.enum).toEqual(['GET', 'POST', 'PATCH']);
  const read = f.gateway.authorize(grant!, { method: 'GET', path: '/items' });
  const write = f.gateway.authorize(grant!, { method: 'POST', path: '/items' });
  expect(read.allowed).toBe(true); expect(read.requiresApproval).toBe(false);
  expect(write.allowed).toBe(true); expect(write.requiresApproval).toBe(true);
  expect(f.gateway.authorize(grant!, { method: 'DELETE', path: '/items' }).allowed).toBe(false);
  await f.gateway.assertCurrent([grant!], 'workspace', f.root);
  await expect(f.gateway.execute(grant!, { method: 'POST', path: '/items' }, () => {})).rejects.toThrow('not-authorized');
  expect(f.getCalls()).toBe(0);
  let approvals = 0;
  const result = await f.gateway.execute(grant!, { method: 'POST', path: '/items', params: { title: 'Draft' } }, () => {}, () => { approvals++; });
  expect(result.isError).toBe(false); expect(f.getCalls()).toBe(1); expect(approvals).toBeGreaterThanOrEqual(2);
  expect(f.fetched()!.options!.method).toBe('POST'); expect(f.fetched()!.options!.body).toBe('{"title":"Draft"}');
});

test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('each declared write uses one guarded dispatch: %s', async method => {
  const f = fixture('bearer');
  const [grant] = await f.gateway.capture('workspace', f.root, ['account'], [{ sourceSlug: 'account', methods: [method as DurableSourceWriteMethod] }]);
  const result = await f.gateway.execute(grant!, { method, path: '/items/one', params: { value: 'updated' } }, () => {}, () => {});
  expect(result.isError).toBe(false); expect(f.getCalls()).toBe(1); expect(f.fetched()!.options!.redirect).toBe('error');
});

test('approval policy revision includes source policy and is rechecked after awaited refresh', async () => {
  const f = fixture(), [grant] = await f.gateway.capture('workspace', f.root, ['account'], [{ sourceSlug: 'account', methods: ['POST'] }]);
  const args = { method: 'POST', path: '/items' };
  const approved = f.gateway.authorize(grant!, args).policyRevision;
  f.onRefresh(() => writeFileSync(join(f.folder, 'permissions.json'), '{"allowedApiEndpoints":[{"method":"POST","path":"/items"}]}'));
  await expect(f.gateway.execute(grant!, args, () => {}, () => {
    if (f.gateway.authorize(grant!, args).policyRevision !== approved) throw new Error('approval-policy-changed');
  })).rejects.toThrow('not-authorized');
  expect(f.getCalls()).toBe(0);
});

test.each([400, 429, 500])('write HTTP %s returns uncertainty without a transport retry', async status => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account'], [{ sourceSlug: 'account', methods: ['POST'] }]);
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response('{"error":"not confirmed"}', { status }); }) as unknown as typeof fetch;
  const result = await f.gateway.execute(grant!, { method: 'POST', path: '/items' }, () => {}, () => {});
  expect(result.isError).toBe(true); expect(requests).toBe(1);
});

test('invalid JSON write response cannot certify success; empty 204 remains valid', async () => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account'], [{ sourceSlug: 'account', methods: ['POST'] }]);
  globalThis.fetch = (async () => new Response('{invalid', { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  expect((await f.gateway.execute(grant!, { method: 'POST', path: '/items' }, () => {}, () => {})).isError).toBe(true);
  globalThis.fetch = (async () => new Response(null, { status: 204, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  expect(await f.gateway.execute(grant!, { method: 'POST', path: '/items' }, () => {}, () => {})).toEqual({ content: '', isError: false });
});


test.each(['pause', 'credential-removal'])('confirmed write response survives late %s after dispatch', async change => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account'], [{ sourceSlug: 'account', methods: ['POST'] }]);
  let dispatch!: () => void, finish!: (response: Response) => void, paused = false;
  const dispatched = new Promise<void>(resolve => { dispatch = resolve; });
  globalThis.fetch = (async () => { dispatch(); return new Promise<Response>(resolve => { finish = resolve; }); }) as unknown as typeof fetch;
  const fence = () => { if (paused) throw new Error('paused'); };
  const result = f.gateway.execute(grant!, { method: 'POST', path: '/items' }, fence, fence);
  await dispatched;
  if (change === 'pause') paused = true; else f.revoke();
  finish(new Response('{"id":"confirmed-write"}', { status: 201, headers: { 'content-type': 'application/json' } }));
  expect(await result).toEqual({ content: '{"id":"confirmed-write"}', isError: false });
});

test('read response still checks current access after an awaited response', async () => {
  const f = fixture('bearer'), [grant] = await f.gateway.capture('workspace', f.root, ['account']);
  let dispatch!: () => void, finish!: (response: Response) => void, paused = false;
  const dispatched = new Promise<void>(resolve => { dispatch = resolve; });
  globalThis.fetch = (async () => { dispatch(); return new Promise<Response>(resolve => { finish = resolve; }); }) as unknown as typeof fetch;
  const result = f.gateway.execute(grant!, { method: 'GET', path: '/items' }, () => { if (paused) throw new Error('paused'); });
  await dispatched; paused = true;
  finish(new Response('{"items":[]}'));
  await expect(result).rejects.toThrow('paused');
});
