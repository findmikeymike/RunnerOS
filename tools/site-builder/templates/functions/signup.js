/**
 * The capture door, deployed with the artist's site.
 *
 * One job: turn a form post into a contact carrying real consent evidence,
 * so the drain can land it in the fan list as opted-in rather than unknown.
 * Everything else falls through to the static site.
 *
 * The Resend key is a secret binding. It never appears in the built site,
 * and the raw visitor IP never leaves this function — only a salted hash,
 * which is what makes it evidence without being personal data.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 4096;

async function hashIp(ip, salt) {
  if (!ip) return undefined;
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

function wantsJson(request) {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

function reply(request, status, body, redirectTo) {
  if (wantsJson(request)) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  // A plain form post gets a redirect so the browser lands somewhere real.
  const target = new URL(redirectTo ?? '/', request.url);
  target.searchParams.set('signup', body.ok ? 'ok' : 'error');
  return Response.redirect(target.toString(), 303);
}

async function readSubmission(request) {
  const type = request.headers.get('content-type') ?? '';
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) throw new Error('too-large');

  if (type.includes('application/json')) {
    const parsed = JSON.parse(raw);
    return {
      email: parsed.email,
      formId: parsed.formId,
      firstName: parsed.firstName,
      // Bots fill hidden fields; humans never see this one.
      trap: parsed.website,
    };
  }
  const params = new URLSearchParams(raw);
  return {
    email: params.get('email'),
    formId: params.get('formId'),
    firstName: params.get('firstName'),
    trap: params.get('website'),
  };
}

async function handleSignup(request, env) {
  if (request.method !== 'POST') {
    return reply(request, 405, { ok: false, error: 'Use POST.' });
  }

  let submission;
  try {
    submission = await readSubmission(request);
  } catch {
    return reply(request, 400, { ok: false, error: 'That form could not be read.' });
  }

  // Silently accept the bot so it does not learn to try something else.
  if (submission.trap) return reply(request, 200, { ok: true });

  const email = String(submission.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL.test(email)) {
    return reply(request, 400, { ok: false, error: 'That does not look like an email address.' });
  }

  if (!env.RESEND_API_KEY) {
    return reply(request, 503, { ok: false, error: 'Signup is not connected yet.' });
  }

  // A repeated signup must never undo an existing opt-out.
  try {
    const existing = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(15000),
    });
    if (existing.ok) return reply(request, 200, { ok: true }, env.SIGNUP_THANKS_PATH);
    if (existing.status !== 404) throw new Error('provider');
  } catch {
    return reply(request, 502, { ok: false, error: 'Could not save that right now. Try again shortly.' });
  }

  const formId = String(submission.formId ?? 'newsletter').slice(0, 60);
  const ipHash = await hashIp(request.headers.get('cf-connecting-ip'), env.SIGNUP_SALT ?? 'artist-os');

  const properties = { aos_form_id: formId };
  if (ipHash) properties.aos_ip_hash = ipHash;
  if (env.SIGNUP_RELEASE_ID) properties.aos_release = env.SIGNUP_RELEASE_ID;

  const response = await fetch('https://api.resend.com/contacts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email,
      first_name: submission.firstName ? String(submission.firstName).slice(0, 80) : undefined,
      unsubscribed: false,
      properties,
      ...(env.SIGNUP_SEGMENT_ID ? { segments: [{ id: env.SIGNUP_SEGMENT_ID }] } : {}),
    }),
  });

  if (!response.ok) {
    // Never surface the provider's message; it can leak account details.
    return reply(request, 502, { ok: false, error: 'Could not save that right now. Try again shortly.' });
  }

  return reply(request, 200, { ok: true }, env.SIGNUP_THANKS_PATH);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/unsubscribe') return handleUnsubscribe(request, env);
    if (url.pathname === '/api/signup') return handleSignup(request, env);
    return env.ASSETS.fetch(request);
  },
};

async function handleUnsubscribe(request, env) {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  if (request.method === 'GET') {
    if (new URL(request.url).searchParams.has('health')) {
      return Response.json({ protocol: 'artist-os-unsubscribe-v1', ready: Boolean(env.RESEND_API_KEY) });
    }
    return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><body><main><h1>Unsubscribe</h1><form method="post"><label>Email <input type="email" name="email" required autocomplete="email"></label><button type="submit">Unsubscribe</button></form></main></body></html>', { headers });
  }
  if (request.method !== 'POST') return new Response('Use POST.', { status: 405, headers });
  if (!env.RESEND_API_KEY) return new Response('Not connected yet. Please try again later.', { status: 503, headers });
  let email;
  try { email = String((await readSubmission(request)).email ?? '').trim().toLowerCase(); } catch { /* Invalid form below. */ }
  if (!email || !EMAIL.test(email)) return new Response('Enter a valid email address.', { status: 400, headers });
  try {
    const init = { method: 'PATCH', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ unsubscribed: true }), signal: AbortSignal.timeout(15000) };
    let response = await fetch(`https://api.resend.com/contacts/${encodeURIComponent(email)}`, init);
    // Imported local fans may not have a provider contact yet.
    if (response.status === 404) response = await fetch('https://api.resend.com/contacts', { ...init, method: 'POST', body: JSON.stringify({ email, unsubscribed: true }) });
    if (!response.ok) throw new Error('provider');
    return new Response('<!doctype html><html lang="en"><title>Unsubscribed</title><h1>You are unsubscribed.</h1><p>You will not receive future fan emails.</p></html>', { headers });
  } catch {
    return new Response('Could not save this yet. Please try again shortly.', { status: 502, headers });
  }
}
