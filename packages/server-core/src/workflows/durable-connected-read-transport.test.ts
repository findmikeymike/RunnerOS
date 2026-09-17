import { createServer, request } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { createDurableConnectedReadTransport, type ConnectedReadTransportDependencies } from './durable-connected-read-transport';
import type { DurableConnectedReadBinding } from './durable-connected-read-binding';

const url = 'https://api.example.com/v1/items';
const token = 'synthetic-private-bearer';
const binding: DurableConnectedReadBinding = { revision: 'workspace-bearer-read-1', workspaceId: 'w', sourceSlug: 'account',
  sourceIdentity: 'a'.repeat(64), credentialIdentity: 'b'.repeat(64), urls: [url] };
function fixture(options: { address?: string; status?: number; headers?: Record<string, string>; body?: string | Buffer; hang?: boolean;
  timeoutMs?: number; lookup?: ConnectedReadTransportDependencies['lookup'];
  withCredential?: ConnectedReadTransportDependencies['binding']['withCurrentCredential'] } = {}) {
  let requests = 0, lookups = 0, credentialReads = 0, destroyed = false;
  let captured: RequestOptions | undefined;
  const stream = new PassThrough() as unknown as IncomingMessage;
  stream.statusCode = options.status ?? 200;
  stream.headers = { 'content-type': 'application/json', ...options.headers };
  const read = createDurableConnectedReadTransport({
    timeoutMs: options.timeoutMs ?? 1000,
    lookup: async hostname => { lookups++; return options.lookup ? options.lookup(hostname) : { address: options.address ?? '93.184.216.34', family: 4 }; },
    binding: { withCurrentCredential: async (saved, dispatch) => {
      credentialReads++;
      if (options.withCredential) return options.withCredential(saved, dispatch);
      return dispatch(token);
    } },
    request: (_url, opts, receive) => {
      requests++; captured = opts;
      const req = new EventEmitter() as ClientRequest;
      req.destroy = (() => { destroyed = true; return req; }) as ClientRequest['destroy'];
      req.end = (() => { queueMicrotask(() => {
        receive(stream); if (!options.hang) (stream as unknown as PassThrough).end(options.body ?? '{"items":[1,2]}');
      }); return req; }) as ClientRequest['end'];
      return req;
    },
  });
  return { read, stream, run: (authorized = () => true, signal?: AbortSignal) => read(binding, url, authorized, signal),
    get requests() { return requests; }, get captured() { return captured; }, get destroyed() { return destroyed; },
    get credentialReads() { return credentialReads; }, get lookups() { return lookups; } };
}

test('uses current bearer only for pinned HTTPS GET and returns JSON without headers', async () => {
  const f = fixture(); expect(await f.run()).toEqual({ ok: true, data: { items: [1, 2] } });
  expect(f.lookups).toBe(1); expect(f.credentialReads).toBe(1); expect(f.requests).toBe(1);
  expect(f.captured).toMatchObject({ method: 'GET', agent: false, family: 4, rejectUnauthorized: true, servername: 'api.example.com',
    headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', Authorization: `Bearer ${token}` } });
  expect(Object.keys(f.captured!.headers!)).toEqual(['Accept', 'Accept-Encoding', 'Authorization']);
  f.captured!.lookup!('ignored.example', { all: false }, (error, address, family) => {
    expect(error).toBeNull(); expect(address).toBe('93.184.216.34'); expect(family).toBe(4);
  });
  expect(f.destroyed).toBe(true);
});

test('existing policy permits silently; denial/throw/async callback never dispatches', async () => {
  for (const authorize of [() => false, () => { throw new Error('private policy detail'); }, (() => Promise.resolve(true)) as unknown as () => boolean]) {
    const f = fixture(); expect(await f.run(authorize)).toEqual({ ok: false, reason: 'not-authorized' });
    expect(f.lookups).toBe(0); expect(f.credentialReads).toBe(0); expect(f.requests).toBe(0);
  }
  const f = fixture(); let checks = 0;
  expect(await f.run(() => { checks++; return true; })).toMatchObject({ ok: true });
  expect(checks).toBe(2); // Pure existing-policy checks; no approval UI/callback exists here.
});

test('policy revocation during credential lookup prevents dispatch', async () => {
  let allowed = true;
  const f = fixture({ withCredential: async (_binding, dispatch) => { allowed = false; return dispatch(token); } });
  expect(await f.run(() => allowed)).toEqual({ ok: false, reason: 'not-authorized' }); expect(f.requests).toBe(0);
});

test.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.0.1', '::1', '198.51.100.2'])('refuses nonpublic address %s before loading credentials', async address => {
  const f = fixture({ address }); expect(await f.run()).toEqual({ ok: false, reason: 'destination-unavailable' });
  expect(f.credentialReads).toBe(0); expect(f.requests).toBe(0);
});

test('refuses ungranted URLs and suppresses credential-loader errors', async () => {
  const f = fixture({ withCredential: async () => { throw new Error(token); } });
  expect(await f.read(binding, 'https://api.example.com/v1/other', () => true)).toEqual({ ok: false, reason: 'not-authorized' });
  expect(f.lookups).toBe(0);
  expect(await f.run()).toEqual({ ok: false, reason: 'binding-unavailable' }); expect(f.requests).toBe(0);
});

test.each([301, 302, 307, 308])('never forwards credentials on redirect %s', async status => {
  const f = fixture({ status, headers: { location: `https://other.example/?token=${token}` } });
  expect(await f.run()).toEqual({ ok: false, reason: 'redirect' }); expect(f.requests).toBe(1); expect(f.destroyed).toBe(true);
});

test.each([401, 403, 429, 500])('returns only status for HTTP %s without retrying or exposing response content', async status => {
  const f = fixture({ status, body: token, headers: { 'set-cookie': token } });
  expect(await f.run()).toEqual({ ok: false, reason: 'http', status }); expect(f.requests).toBe(1);
});

test.each([{ 'content-type': 'text/html' }, { 'content-encoding': 'gzip' }] as Record<string, string>[])('refuses unsupported content %j', async headers => {
  expect(await fixture({ headers }).run()).toEqual({ ok: false, reason: 'unsupported-response' });
});

test('bounds announced and streaming bytes, rejects malformed JSON and secret echoes', async () => {
  expect(await fixture({ headers: { 'content-length': '524289' } }).run()).toEqual({ ok: false, reason: 'too-large' });
  expect(await fixture({ body: Buffer.alloc(524289), headers: { 'content-length': '1' } }).run()).toEqual({ ok: false, reason: 'too-large' });
  expect(await fixture({ body: token }).run()).toEqual({ ok: false, reason: 'invalid-json' });
  expect(await fixture({ body: JSON.stringify({ echo: token }) }).run()).toEqual({ ok: false, reason: 'unsupported-response' });
  const escaped = token.replace('s', '\\u0073');
  expect(await fixture({ body: `{"echo":"${escaped}"}` }).run()).toEqual({ ok: false, reason: 'unsupported-response' });
});

test('cancellation and timeouts fence late DNS and credential completion', async () => {
  for (const phase of ['dns', 'credential'] as const) {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = fixture({ timeoutMs: 10,
      ...(phase === 'dns' ? { lookup: async () => { await gate; return { address: '93.184.216.34', family: 4 }; } }
        : { withCredential: async <T>(_binding: DurableConnectedReadBinding, dispatch: (token: string) => T) => { await gate; return dispatch(token); } }) });
    expect(await f.run()).toEqual({ ok: false, reason: 'timeout' }); release();
    await new Promise(resolve => setTimeout(resolve, 1)); expect(f.requests).toBe(0);
  }
  const controller = new AbortController(); controller.abort();
  const f = fixture(); expect(await f.run(() => true, controller.signal)).toEqual({ ok: false, reason: 'cancelled' });
  expect(f.lookups).toBe(0);
});

test('aborting a body destroys the request; slow body has an absolute deadline', async () => {
  const f = fixture({ hang: true }), controller = new AbortController();
  const result = f.run(() => true, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 1)); controller.abort();
  expect(await result).toEqual({ ok: false, reason: 'cancelled' }); expect(f.destroyed).toBe(true);
  const hanging = fixture({ hang: true, timeoutMs: 10 });
  expect(await hanging.run()).toEqual({ ok: false, reason: 'timeout' }); expect(hanging.destroyed).toBe(true);
});

test('native HTTPS sends bearer only after successful certificate and hostname validation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'connected-read-tls-'));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=api.example.com', '-addext', 'subjectAltName=DNS:api.example.com', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const ca = readFileSync(cert); let requests = 0;
    server = createServer({ key: readFileSync(key), cert: ca }, (req, response) => {
      requests++;
      expect(req.method).toBe('GET'); expect(req.headers.authorization).toBe(`Bearer ${token}`);
      expect(req.headers.cookie).toBeUndefined();
      response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"native":true}');
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('test listener missing');
    const transport = createDurableConnectedReadTransport({
      timeoutMs: 2000, lookup: async () => ({ address: '93.184.216.34', family: 4 }),
      binding: { withCurrentCredential: async (_binding, dispatch) => dispatch(token) },
      request: (target, options, receive) => {
        expect(options.rejectUnauthorized).toBe(true);
        // Test-only loopback route/trust anchor; actual TLS verification remains enabled.
        return request(target, { ...options, port: address.port, ca,
          lookup: (_hostname, opts, callback) => {
            if (opts.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
            else callback(null, '127.0.0.1', 4);
          },
        }, receive);
      },
    });
    expect(await transport(binding, url, () => true)).toEqual({ ok: true, data: { native: true } });
    const wrong = 'https://wrong.invalid/v1/items';
    expect(await transport({ ...binding, urls: [wrong] }, wrong, () => true)).toEqual({ ok: false, reason: 'destination-unavailable' });
    expect(requests).toBe(1);
  } finally {
    if (server?.listening) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    rmSync(directory, { recursive: true, force: true });
  }
});
