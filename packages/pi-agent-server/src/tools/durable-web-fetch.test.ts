import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { createServer, request } from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDurableWebFetchToolWithTransport, isPublicDurableWebIpv4, type DurableWebFetchTransport } from './durable-web-fetch.ts';

const URL = 'https://example.com/page';
function harness(options: { address?: string; status?: number; headers?: Record<string, string>; body?: string | Buffer; hang?: boolean; timeoutMs?: number; lookup?: DurableWebFetchTransport['lookup'] } = {}) {
  let calls = 0;
  let captured: RequestOptions | undefined;
  let destroyed = false;
  const stream = new PassThrough() as unknown as IncomingMessage;
  stream.statusCode = options.status ?? 200;
  stream.headers = { 'content-type': 'text/plain', ...options.headers };
  const tool = createDurableWebFetchToolWithTransport([URL], {
    timeoutMs: options.timeoutMs ?? 1000,
    lookup: options.lookup ?? (async () => ({ address: options.address ?? '93.184.216.34', family: 4 })),
    request: (_url, opts, receive) => {
      calls++;
      captured = opts;
      const req = new EventEmitter() as ClientRequest;
      req.destroy = (() => { destroyed = true; return req; }) as ClientRequest['destroy'];
      req.end = (() => {
        queueMicrotask(() => {
          receive(stream);
          if (!options.hang) (stream as unknown as PassThrough).end(options.body ?? 'hello');
        });
        return req;
      }) as ClientRequest['end'];
      return req;
    },
  });
  return { tool, run: (url = URL, signal?: AbortSignal) => tool.execute('test', { url }, signal), get calls() { return calls; }, get captured() { return captured; }, get destroyed() { return destroyed; } };
}

describe('durable public web reads', () => {
  test.each(['0.1.2.3', '10.0.0.1', '127.0.0.1', '100.64.0.1', '100.127.255.255', '169.254.169.254', '172.16.0.1', '172.31.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1', '192.168.0.1', '192.31.196.1', '192.52.193.1', '192.175.48.1', '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '2606:4700::1111'])('rejects private or reserved destination %s before dispatch', async (address) => {
    expect(isPublicDurableWebIpv4(address)).toBe(false);
    const h = harness({ address });
    expect((await h.run()).details).toEqual({ isError: true });
    expect(h.calls).toBe(0);
  });
  test.each(['http://example.com/', 'https://user:secret@example.com/', 'https://example.com:444/', 'https://example.com/#token'])('rejects unsafe allowlist %s', (url) => {
    expect(() => createDurableWebFetchToolWithTransport([url], {} as DurableWebFetchTransport)).toThrow();
  });
  test('exact allowlist and url-only inputs', async () => {
    const h = harness();
    expect((await h.run('https://example.com/other')).details).toEqual({ isError: true });
    expect((await h.tool.execute('test', { url: URL, headers: { Authorization: 'secret' } } as { url: string })).details).toEqual({ isError: true });
    expect(h.calls).toBe(0);
  });
  test('pins DNS once, preserves TLS hostname, and sends no ambient credentials', async () => {
    let lookups = 0;
    const h = harness({ lookup: async () => { lookups++; return { address: '93.184.216.34', family: 4 }; } });
    const output = await h.run();
    const text = (output.content[0] as { text: string }).text;
    expect(text).toContain('UNTRUSTED WEB CONTENT');
    expect(text).toContain('hello');
    expect(lookups).toBe(1);
    expect(h.captured).toMatchObject({ method: 'GET', agent: false, rejectUnauthorized: true, servername: 'example.com' });
    expect(Object.keys(h.captured!.headers!)).toEqual(['Accept', 'Accept-Encoding']);
    const pinned = h.captured!.lookup!;
    pinned('different.invalid', { family: 4, all: false }, (_err, address, family) => {
      expect(address).toBe('93.184.216.34'); expect(family).toBe(4);
    });
  });
  test('redirect never makes another request or exposes redirect tokens', async () => {
    const h = harness({ status: 302, headers: { location: 'http://127.0.0.1/?secret=token' } });
    const output = await h.run();
    expect(output.details).toEqual({ isError: true });
    expect(JSON.stringify(output)).not.toContain('secret');
    expect(h.calls).toBe(1);
    expect(h.destroyed).toBe(true);
  });
  test.each([{ 'content-type': 'application/pdf' }, { 'content-type': 'image/png' }, { 'content-encoding': 'gzip' }])('rejects binary or encoded response', async (headers) => {
    expect((await harness({ headers }).run()).details).toEqual({ isError: true });
  });
  test('limits actual streaming bytes without trusting content length', async () => {
    const h = harness({ body: Buffer.alloc(512 * 1024 + 1), headers: { 'content-length': '1' } });
    expect((await h.run()).details).toEqual({ isError: true });
    expect(h.destroyed).toBe(true);
  });
  test('limits extracted text and strips active HTML', async () => {
    const output = await harness({ headers: { 'content-type': 'text/html' }, body: '<main><script>SECRET</script><style>HIDDEN</style><p>' + 'a'.repeat(50_001) + '</p></main>' }).run();
    const text = (output.content[0] as { text: string }).text;
    expect(text).not.toContain('SECRET'); expect(text).not.toContain('HIDDEN');
    const data = JSON.parse(text.slice(text.indexOf('\n') + 1));
    expect(data.content.length).toBe(50_000); expect(data.truncated).toBe(true);
  });
  test('absolute timeout covers an indefinitely slow body', async () => {
    const h = harness({ hang: true, timeoutMs: 10 });
    expect((await h.run()).details).toEqual({ isError: true }); expect(h.destroyed).toBe(true);
  });
  test('DNS timeout prevents late dispatch', async () => {
    let finish!: (value: { address: string; family: number }) => void;
    const h = harness({ timeoutMs: 10, lookup: () => new Promise((resolve) => { finish = resolve; }) });
    expect((await h.run()).details).toEqual({ isError: true });
    finish({ address: '93.184.216.34', family: 4 });
    await Promise.resolve(); expect(h.calls).toBe(0);
  });
  test('abort destroys active transport and pre-abort does not resolve DNS', async () => {
    const controller = new AbortController();
    const h = harness({ hang: true });
    const promise = h.run(URL, controller.signal);
    await Promise.resolve(); controller.abort();
    expect((await promise).details).toEqual({ isError: true }); expect(h.destroyed).toBe(true);
    const next = harness();
    await next.run(URL, controller.signal); expect(next.calls).toBe(0);
  });
  test('network exceptions never leak raw error contents', async () => {
    const h = harness({ lookup: async () => { throw new Error('password=secret'); } });
    const output = await h.run();
    expect(output.details).toEqual({ isError: true }); expect(JSON.stringify(output)).not.toContain('secret');
  });

  test('native HTTPS reads trusted local TLS and rejects a hostname mismatch', async () => {
    // Ephemeral synthetic key/certificate: no user credentials and no external requests.
    const directory = mkdtempSync(join(tmpdir(), 'durable-web-tls-'));
    const keyPath = join(directory, 'key.pem');
    const certPath = join(directory, 'cert.pem');
    let server: ReturnType<typeof createServer> | undefined;
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=example.com', '-addext', 'subjectAltName=DNS:example.com',
        '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
      const ca = readFileSync(certPath);
      let requests = 0;
      const observedHostnames: string[] = [];
      server = createServer({ key: readFileSync(keyPath), cert: ca }, (req, response) => {
        requests++;
        expect(req.headers.authorization).toBeUndefined();
        expect(req.headers.cookie).toBeUndefined();
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('verified local TLS text');
      });
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected local TCP listener');
      const transport: DurableWebFetchTransport = {
        timeoutMs: 2000,
        lookup: async () => ({ address: '93.184.216.34', family: 4 }),
        request: (url, options, receive) => {
          expect(options.rejectUnauthorized).toBe(true);
          observedHostnames.push(options.servername ?? '');
          // Only the test wrapper routes to loopback and adds the synthetic trust anchor.
          // Certificate/hostname verification and the actual HTTPS request remain enabled.
          return request(url, { ...options, port: address.port, ca,
            lookup: (_hostname, lookupOptions, callback) => {
              if (lookupOptions.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
              else callback(null, '127.0.0.1', 4);
            },
          }, receive);
        },
      };
      const good = await createDurableWebFetchToolWithTransport([URL], transport).execute('tls-good', { url: URL });
      expect(good.details).toEqual({});
      expect((good.content[0] as { text: string }).text).toContain('verified local TLS text');
      const wrong = 'https://wrong.invalid/page';
      const bad = await createDurableWebFetchToolWithTransport([wrong], transport).execute('tls-bad', { url: wrong });
      expect(bad.details).toEqual({ isError: true });
      expect(requests).toBe(1);
      expect(observedHostnames).toEqual(['example.com', 'wrong.invalid']);
    } finally {
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
