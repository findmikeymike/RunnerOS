import fs from 'node:fs';
import path from 'node:path';

export function createProfile({ platform, profileId, flags, browserEngine, confirmPolicy }) {
  const sessionRef = path.join('sessions', platform, profileId);
  return {
    id: profileId,
    platform,
    modePreference: 'browser',
    adapter: browserEngine,
    browserEngine,
    sessionRef,
    proxyId: flags['proxy-id'] || null,
    ratePolicy: flags['rate-policy'] || 'normal',
    confirmPolicy,
    accountHandle: flags.handle || flags['account-handle'] || null,
    accountUrl: flags['account-url'] || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updateProfile(profile, flags, { browserEngine, confirmPolicy } = {}) {
  const next = { ...profile };
  if (flags.handle !== undefined || flags['account-handle'] !== undefined) {
    next.accountHandle = flags.handle || flags['account-handle'] || null;
  }
  if (flags['account-url'] !== undefined) next.accountUrl = flags['account-url'] || null;
  if (flags.engine !== undefined && browserEngine) {
    next.adapter = browserEngine;
    next.browserEngine = browserEngine;
  }
  if (flags['proxy-id'] !== undefined) next.proxyId = flags['proxy-id'] || null;
  if (flags['rate-policy'] !== undefined) next.ratePolicy = flags['rate-policy'] || 'normal';
  if (flags['confirm-policy'] !== undefined && confirmPolicy) next.confirmPolicy = confirmPolicy;
  if (flags['clear-handle']) next.accountHandle = null;
  if (flags['clear-account-url']) next.accountUrl = null;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function profileJson(profile, { sessionPath = null, sessionExists = null } = {}) {
  return {
    id: profile.id,
    profile: profile.id,
    platform: profile.platform,
    modePreference: profile.modePreference || 'browser',
    adapter: profile.adapter || profile.browserEngine || null,
    browserEngine: profile.browserEngine || profile.adapter || null,
    sessionRef: profile.sessionRef || path.join('sessions', profile.platform, profile.id),
    sessionPath,
    sessionExists,
    localSessionExists: sessionExists,
    accountHandle: profile.accountHandle || null,
    accountUrl: profile.accountUrl || null,
    profileIdentity: {
      expectedHandle: profile.accountHandle || null,
      expectedAccountUrl: profile.accountUrl || null,
    },
    proxyId: profile.proxyId || null,
    ratePolicy: profile.ratePolicy || 'normal',
    confirmPolicy: profile.confirmPolicy || 'require-confirm',
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
  };
}

export function profileListJson(profiles, sessionDir) {
  return profiles.map((profile) => {
    const sessionPath = sessionDir(profile);
    return profileJson(profile, { sessionPath, sessionExists: fs.existsSync(sessionPath) });
  });
}

export function profileStatusJson({ command, platform, profileId, profile, sessionPath, sessionExists, live }) {
  const liveRequested = Boolean(live);
  const liveChecked = live ? Boolean(live.checked) : false;
  const loggedIn = liveChecked ? Boolean(live.loggedIn) : null;
  const matchesExpected = liveChecked ? (live.matchesExpected ?? null) : null;
  return {
    ok: true,
    status: 'succeeded',
    command,
    platform,
    profile: profileId,
    profileId,
    accountHandle: profile.accountHandle || null,
    accountUrl: profile.accountUrl || null,
    sessionRef: profile.sessionRef || path.join('sessions', platform, profileId),
    sessionPath,
    sessionExists,
    localSessionExists: sessionExists,
    liveChecked,
    loggedIn,
    matchesExpected,
    ready: liveRequested ? Boolean(loggedIn && matchesExpected === true) : sessionExists,
    live: live || null,
    data: profileJson(profile, { sessionPath, sessionExists }),
  };
}

export function profileLoginJson({ platform, profileId, profile, sessionPath, result }) {
  const delegated = Boolean(result.delegated);
  const loggedIn = delegated ? null : Boolean(result.loggedIn);
  const sessionExists = result.sessionExists ?? !delegated;
  return {
    ok: delegated || Boolean(result.loggedIn),
    status: delegated ? 'delegated' : (result.loggedIn ? 'succeeded' : 'failed'),
    command: 'profile.login',
    platform,
    profile: profileId,
    profileId,
    accountHandle: profile.accountHandle || null,
    accountUrl: profile.accountUrl || null,
    sessionRef: profile.sessionRef || path.join('sessions', platform, profileId),
    sessionPath,
    sessionExists,
    localSessionExists: sessionExists,
    liveChecked: !delegated,
    loggedIn,
    matchesExpected: delegated ? null : (result.matchesExpected ?? null),
    ...result,
  };
}
