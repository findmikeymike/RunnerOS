import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import worker from './templates/functions/signup.js';

// The worker calls global fetch, so it has to be stubbed — but leaving the
// stub in place would follow this process into every other test file.
const realFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = realFetch; });
afterEach(() => { globalThis.fetch = realFetch; });

function post(body, { json = false, ip = '203.0.113.7', accept } = {}) {
  return new Request('https://lowtide.com/api/signup', {
    method: 'POST',
    headers: {
      'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded',
      ...(accept ? { accept } : {}),
      ...(ip ? { 'cf-connecting-ip': ip } : {}),
    },
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
}

function env(overrides = {}) {
  const calls = [];
  return {
    calls,
    env: {
      RESEND_API_KEY: 're_test_key',
      SIGNUP_SALT: 'salt-1',
      ASSETS: { fetch: async () => new Response('static', { status: 200 }) },
      ...overrides,
    },
    install(response = { ok: true, status: 200 }) {
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init, body: JSON.parse(init.body) });
        return { ok: response.ok, status: response.status, json: async () => ({}) };
      };
    },
  };
}

const JSON_ACCEPT = 'application/json';

describe('capture function', () => {
  test('a valid signup reaches Resend with form id and a hashed ip', async () => {
    const harness = env();
    harness.install();

    const response = await worker.fetch(
      post({ email: 'Fan@Example.com', formId: 'sneak-peek' }, { accept: JSON_ACCEPT }),
      harness.env,
    );

    expect(response.status).toBe(200);
    expect(harness.calls).toHaveLength(1);

    const sent = harness.calls[0].body;
    expect(sent.email).toBe('fan@example.com');
    expect(sent.unsubscribed).toBe(false);
    expect(sent.properties.aos_form_id).toBe('sneak-peek');
    expect(sent.properties.aos_ip_hash).toMatch(/^[a-f0-9]{32}$/);
    // The raw address must never be sent anywhere.
    expect(JSON.stringify(sent)).not.toContain('203.0.113.7');
  });

  test('the same visitor hashes the same way, a different one does not', async () => {
    const a = env();
    a.install();
    await worker.fetch(post({ email: 'one@example.com' }, { accept: JSON_ACCEPT }), a.env);
    await worker.fetch(post({ email: 'two@example.com' }, { accept: JSON_ACCEPT }), a.env);
    expect(a.calls[0].body.properties.aos_ip_hash).toBe(a.calls[1].body.properties.aos_ip_hash);

    const b = env();
    b.install();
    await worker.fetch(
      post({ email: 'three@example.com' }, { ip: '198.51.100.4', accept: JSON_ACCEPT }),
      b.env,
    );
    expect(b.calls[0].body.properties.aos_ip_hash).not.toBe(a.calls[0].body.properties.aos_ip_hash);
  });

  test('a different salt produces a different hash for the same visitor', async () => {
    const a = env();
    a.install();
    await worker.fetch(post({ email: 'one@example.com' }, { accept: JSON_ACCEPT }), a.env);

    const b = env({ SIGNUP_SALT: 'salt-2' });
    b.install();
    await worker.fetch(post({ email: 'one@example.com' }, { accept: JSON_ACCEPT }), b.env);

    expect(a.calls[0].body.properties.aos_ip_hash).not.toBe(b.calls[0].body.properties.aos_ip_hash);
  });

  test('a bad address is rejected before any provider call', async () => {
    const harness = env();
    harness.install();
    const response = await worker.fetch(
      post({ email: 'not-an-email' }, { accept: JSON_ACCEPT }),
      harness.env,
    );
    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  test('a filled honeypot is accepted silently and sends nothing', async () => {
    const harness = env();
    harness.install();
    const response = await worker.fetch(
      post({ email: 'bot@example.com', website: 'http://spam' }, { accept: JSON_ACCEPT }),
      harness.env,
    );
    expect(response.status).toBe(200);
    expect(harness.calls).toHaveLength(0);
  });

  test('a provider failure never leaks the provider message', async () => {
    const harness = env();
    harness.install({ ok: false, status: 422 });
    const response = await worker.fetch(
      post({ email: 'fan@example.com' }, { accept: JSON_ACCEPT }),
      harness.env,
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toBe('Could not save that right now. Try again shortly.');
  });

  test('with no key configured the door says so instead of failing open', async () => {
    const harness = env({ RESEND_API_KEY: undefined });
    harness.install();
    const response = await worker.fetch(
      post({ email: 'fan@example.com' }, { accept: JSON_ACCEPT }),
      harness.env,
    );
    expect(response.status).toBe(503);
    expect(harness.calls).toHaveLength(0);
  });

  test('a plain form post is redirected rather than shown JSON', async () => {
    const harness = env();
    harness.install();
    const response = await worker.fetch(post({ email: 'fan@example.com' }), harness.env);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('signup=ok');
  });

  test('an oversized body is refused', async () => {
    const harness = env();
    harness.install();
    const response = await worker.fetch(
      post({ email: 'fan@example.com', firstName: 'x'.repeat(5000) }, { accept: JSON_ACCEPT }),
      harness.env,
    );
    expect(response.status).toBe(400);
    expect(harness.calls).toHaveLength(0);
  });

  test('GET on the signup path is not allowed', async () => {
    const harness = env();
    harness.install();
    const response = await worker.fetch(
      new Request('https://lowtide.com/api/signup', { headers: { accept: JSON_ACCEPT } }),
      harness.env,
    );
    expect(response.status).toBe(405);
  });

  test('every other path falls through to the static site', async () => {
    const harness = env();
    harness.install();
    const response = await worker.fetch(new Request('https://lowtide.com/press/'), harness.env);
    expect(await response.text()).toBe('static');
    expect(harness.calls).toHaveLength(0);
  });
});
