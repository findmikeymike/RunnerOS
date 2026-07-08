import fs from 'node:fs';

export function readProfileVerificationResult(profile, flags = {}) {
  const raw = flags['verification-json'] || readVerificationFile(flags['verification-result']);
  if (!raw) return null;

  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw Object.assign(
      new Error(`Invalid profile verification JSON: ${error.message}`),
      { code: 'INVALID_VERIFICATION_RESULT' }
    );
  }

  assertVerificationIdentity(profile, data);
  const visibleIdentity = normalizeVisibleIdentity(data.visibleIdentity || data.identity || data);
  const loggedIn = Boolean(data.loggedIn);
  const matchesExpected = loggedIn ? resolveMatchesExpected(profile, data, visibleIdentity) : false;

  return {
    checked: true,
    delegated: false,
    source: data.source || 'runner-cdp',
    loggedIn,
    matchesExpected,
    visibleIdentity,
    checkedAt: data.checkedAt || new Date().toISOString(),
    message: data.message || 'RunnerOS browser verification result was applied.',
  };
}

function readVerificationFile(filePath) {
  if (!filePath || filePath === true) return null;
  try {
    return fs.readFileSync(String(filePath), 'utf8');
  } catch (error) {
    throw Object.assign(
      new Error(`Could not read profile verification result: ${error.message}`),
      { code: 'INVALID_VERIFICATION_RESULT' }
    );
  }
}

function assertVerificationIdentity(profile, data) {
  if (data.platform && data.platform !== profile.platform) {
    throw Object.assign(
      new Error(`Verification platform mismatch: expected ${profile.platform}, got ${data.platform}`),
      { code: 'VERIFICATION_IDENTITY_MISMATCH' }
    );
  }
  if (data.profile && data.profile !== profile.id) {
    throw Object.assign(
      new Error(`Verification profile mismatch: expected ${profile.id}, got ${data.profile}`),
      { code: 'VERIFICATION_IDENTITY_MISMATCH' }
    );
  }
}

function normalizeVisibleIdentity(identity = {}) {
  return {
    handle: identity.handle || identity.accountHandle || null,
    accountUrl: identity.accountUrl || null,
    displayName: identity.displayName || identity.name || null,
    url: identity.url || null,
    rawText: identity.rawText || identity.text || null,
  };
}

function resolveMatchesExpected(profile, data, visibleIdentity) {
  const expectedHandle = normalizeHandle(profile.accountHandle);
  const expectedUrl = normalizeUrl(profile.accountUrl);
  if (!expectedHandle && !expectedUrl) return false;

  const visibleHandle = normalizeHandle(visibleIdentity.handle);
  if (expectedHandle && visibleHandle && expectedHandle === visibleHandle) return true;

  const visibleUrl = normalizeUrl(visibleIdentity.accountUrl || visibleIdentity.url);
  if (expectedUrl && visibleUrl && expectedUrl === visibleUrl) return true;

  if (visibleHandle || visibleUrl) return false;

  const rawText = String(visibleIdentity.rawText || '');
  if (expectedHandle && rawTextHasHandle(rawText, expectedHandle)) return true;
  if (expectedUrl && rawTextHasUrl(rawText, expectedUrl)) return true;

  return false;
}

function normalizeHandle(value) {
  if (!value) return null;
  return String(value).trim().replace(/^@+/, '').toLowerCase() || null;
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.hash = '';
    url.search = '';
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function rawTextHasHandle(text, handle) {
  if (!text || !handle) return false;
  const escaped = escapeRegExp(handle);
  return new RegExp(`(^|[^a-z0-9_])@${escaped}([^a-z0-9_]|$)`, 'i').test(text);
}

function rawTextHasUrl(text, normalizedUrl) {
  if (!text || !normalizedUrl) return false;
  const escaped = escapeRegExp(normalizedUrl);
  return new RegExp(`(^|[^a-z0-9.-])${escaped}(/|[^a-z0-9._-]|$)`, 'i').test(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
