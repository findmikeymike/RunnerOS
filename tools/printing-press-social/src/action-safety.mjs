import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIRM_POLICY = 'require-confirm';
export const CONFIRM_POLICIES = new Set(['require-confirm', 'autorun']);
export const DEFAULT_PROFILE_LOCK_TTL_MS = 30 * 60 * 1000;

export function resolveConfirmPolicy(flags = {}) {
  const policy = flags['confirm-policy'] || process.env.SOCIAL_CONFIRM_POLICY || DEFAULT_CONFIRM_POLICY;
  assertConfirmPolicy(policy);
  return policy;
}

export function assertConfirmPolicy(policy) {
  if (!CONFIRM_POLICIES.has(policy)) {
    throw Object.assign(
      new Error('--confirm-policy must be require-confirm or autorun'),
      { code: 'INVALID_CONFIRM_POLICY' }
    );
  }
}

export function canExecuteLiveAction(profile, flags = {}) {
  if (flags.confirm === 'yes') return true;
  if (flags.confirm === 'no') return false;
  if (process.env.SOCIAL_ALLOW_AUTORUN_WRITES === '1') {
    if (flags.autorun) return true;
    return profile.confirmPolicy === 'autorun';
  }
  return false;
}

export function assertLiveConfirmed(profile, flags = {}, label = 'live action') {
  if (canExecuteLiveAction(profile, flags)) return;
  throw Object.assign(
    new Error(`Refusing ${label} without explicit --confirm yes`),
    { code: 'CONFIRM_REQUIRED' }
  );
}

export function hasAccountVerificationTarget(profile = {}) {
  return Boolean(profile.accountHandle || profile.accountUrl);
}

export function assertAccountVerificationTarget(profile = {}, label = 'live action') {
  if (hasAccountVerificationTarget(profile)) return;
  throw Object.assign(
    new Error(`Refusing ${label} because profile ${profile.platform}/${profile.id} is missing --handle or --account-url for account verification`),
    { code: 'ACCOUNT_VERIFICATION_REQUIRED' }
  );
}

export function assertLiveReady(profile, flags = {}, label = 'live action') {
  assertLiveConfirmed(profile, flags, label);
  assertAccountVerificationTarget(profile, label);
}

export function smokeProfileAllowed(flags = {}) {
  return Boolean(flags['dry-run']) || process.env.SOCIAL_ENABLE_SMOKE_PROFILE === '1';
}

export function buildSmokeProfile(platform, id, defaultBrowserEngine) {
  return {
    id,
    platform,
    modePreference: 'browser',
    adapter: defaultBrowserEngine,
    browserEngine: defaultBrowserEngine,
    sessionRef: path.join('sessions', platform, id),
    proxyId: null,
    ratePolicy: 'normal',
    confirmPolicy: DEFAULT_CONFIRM_POLICY,
    accountHandle: null,
    accountUrl: null,
  };
}

export function buildBrowserPlan({ profile, sessionPath, steps }) {
  const normalizedSteps = addAccountVerificationStep(steps, profile.platform);
  const expectedIdentity = profile.accountHandle || profile.accountUrl || null;
  const browserSession = buildProfileBrowserSession(profile);
  return {
    sessionPath,
    browserSession,
    steps: normalizedSteps,
    accountVerification: {
      requiredBeforeLiveSubmit: true,
      verificationTargetKnown: Boolean(expectedIdentity),
      platform: profile.platform,
      profile: profile.id,
      expectedHandle: profile.accountHandle || null,
      expectedAccountUrl: profile.accountUrl || null,
      fallbackExpectedIdentity: expectedIdentity,
      identityProbe: buildIdentityProbe(profile),
      evidenceRequired: [
        ...(expectedIdentity ? [] : ['Add --handle or --account-url to this profile before any live submit.']),
        'Run browser_tool snapshot or screenshot after opening the logged-in account surface.',
        'Verify the visible account/channel/profile matches the expected handle or account URL before upload, post, comment, or DM submit.',
        'If the visible account does not match, stop and ask the user to switch/login; do not continue.',
      ],
    },
  };
}

export function buildProfileBrowserSession(profile = {}) {
  return {
    kind: 'runneros-electron-partition',
    platform: profile.platform,
    profile: profile.id,
    instanceId: `social-${profile.platform}-${socialBrowserSegment(profile.id || '')}`,
    partition: `persist:social-${profile.platform}-${socialBrowserSegment(profile.id || '')}`,
  };
}

function socialBrowserSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '-');
}

export function buildIdentityProbe(profile = {}) {
  const handle = normalizeHandle(profile.accountHandle);
  const accountUrl = profile.accountUrl || null;
  const profilePath = accountUrl ? safeUrlPath(accountUrl) : (handle ? `/${handle}` : null);
  const common = {
    platform: profile.platform,
    profile: profile.id,
    expectedHandle: profile.accountHandle || null,
    normalizedExpectedHandle: handle ? `@${handle}` : null,
    expectedAccountUrl: accountUrl,
    expectedPath: profilePath,
    resultContract: {
      checked: 'boolean',
      loggedIn: 'boolean',
      visibleIdentity: '{ handle?: string, accountUrl?: string, displayName?: string, url?: string, rawText?: string }',
      matchesExpected: 'boolean|null',
      checkedAt: 'ISO-8601 timestamp',
    },
  };

  if (profile.platform === 'youtube') {
    return {
      ...common,
      openUrl: 'https://www.youtube.com/',
      loggedInSignals: ['#avatar-btn', 'button[aria-label*="Account menu" i]', 'text=Create'],
      identitySurfaces: ['account menu channel handle', 'channel URL', 'YouTube Studio channel switcher'],
      expectedMatchRule: 'visible channel handle or channel URL must match expectedHandle or expectedAccountUrl',
    };
  }

  const homeUrls = {
    instagram: 'https://www.instagram.com/',
    tiktok: 'https://www.tiktok.com/',
    x: 'https://x.com/',
    spotify: 'https://artists.spotify.com/',
  };
  return {
    ...common,
    openUrl: homeUrls[profile.platform] || null,
    loggedInSignals: ['profile/avatar navigation', 'create/upload/post controls', 'account menu'],
    identitySurfaces: ['profile/account menu handle', 'current profile link', 'visible account URL'],
    expectedMatchRule: 'visible handle or profile URL must match expectedHandle or expectedAccountUrl',
  };
}

function addAccountVerificationStep(steps, platform) {
  if (steps.some((step) => /verify visible account/i.test(step))) return steps;
  const verifyStep = platform === 'youtube'
    ? 'verify visible account/channel matches profile'
    : 'verify visible account matches profile';
  if (steps.length <= 1) return [...steps, verifyStep];
  return [steps[0], verifyStep, ...steps.slice(1)];
}

function normalizeHandle(value) {
  if (!value) return null;
  return String(value).trim().replace(/^@+/, '').toLowerCase() || null;
}

function safeUrlPath(value) {
  try {
    return new URL(value).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return null;
  }
}

export function acquireProfileLock({ action, socialHome }) {
  const lockDir = path.join(socialHome, 'locks');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${safeName(action.platform)}-${safeName(action.profile)}.lock`);

  let fd;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code === 'EEXIST' && attempt === 0 && isStaleLock(lockPath)) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (error.code === 'EEXIST') {
        throw Object.assign(
          new Error(`Another social action is already running for ${action.platform}/${action.profile}`),
          { code: 'PROFILE_LOCKED' }
        );
      }
      throw error;
    }
  }

  fs.writeFileSync(fd, JSON.stringify({
    actionId: action.actionId,
    platform: action.platform,
    profile: action.profile,
    verb: action.verb,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }, null, 2));
  fs.closeSync(fd);

  return () => {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {}
  };
}

export function findCompletedAction({ action, socialHome }) {
  const key = ledgerKey(action);
  if (!key) return null;
  const ledger = readLedger(socialHome);
  return ledger.actions[key]?.status === 'succeeded' ? ledger.actions[key] : null;
}

export function recordCompletedAction({ action, socialHome, result, command }) {
  if (!result?.ok) return;
  const ledger = readLedger(socialHome);
  const key = ledgerKey(action);
  if (!key) return;
  ledger.actions[key] = {
    key,
    status: 'succeeded',
    command,
    actionId: action.actionId,
    platform: action.platform,
    profile: action.profile,
    verb: action.verb,
    idempotencyKey: action.options?.idempotencyKey || null,
    payloadDigest: payloadDigest(action),
    receipt: result.receipt || null,
    completedAt: new Date().toISOString(),
  };
  writeLedger(socialHome, ledger);
}

export function duplicateActionResult(action, record, command) {
  return {
    ok: true,
    actionId: action.actionId,
    platform: action.platform,
    profile: action.profile,
    mode: 'browser',
    status: 'duplicate',
    command,
    duplicateOf: record.actionId,
    completedAt: record.completedAt,
    idempotencyKey: record.idempotencyKey,
    receipt: record.receipt || null,
  };
}

function readLedger(socialHome) {
  const filePath = ledgerPath(socialHome);
  if (!fs.existsSync(filePath)) return { version: 1, actions: {} };
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeLedger(socialHome, ledger) {
  const filePath = ledgerPath(socialHome);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

function ledgerPath(socialHome) {
  return path.join(socialHome, 'publish-ledger.json');
}

function ledgerKey(action) {
  return action.options?.idempotencyKey || payloadDigest(action);
}

function payloadDigest(action) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      platform: action.platform,
      profile: action.profile,
      verb: action.verb,
      payload: action.payload,
    }))
    .digest('hex');
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_.-]/gi, '_');
}

function isStaleLock(lockPath) {
  const ttlMs = Number(process.env.SOCIAL_PROFILE_LOCK_TTL_MS || DEFAULT_PROFILE_LOCK_TTL_MS);
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const startedAt = Date.parse(lock.startedAt || '');
    if (Number.isFinite(ttlMs) && ttlMs > 0 && Number.isFinite(startedAt) && Date.now() - startedAt > ttlMs) {
      return true;
    }
    if (lock.pid && !pidIsRunning(lock.pid)) return true;
  } catch {
    return true;
  }
  return false;
}

function pidIsRunning(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
