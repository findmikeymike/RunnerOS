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
    accountGroup: flags['account-group'] || flags.persona || null,
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
  if (flags['account-group'] !== undefined || flags.persona !== undefined) {
    next.accountGroup = flags['account-group'] || flags.persona || null;
  }
  if (flags['clear-account-group'] || flags['clear-persona']) next.accountGroup = null;
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
    accountGroup: profile.accountGroup || null,
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
  const ready = Boolean(liveChecked && loggedIn && matchesExpected === true);
  const statusMeta = profileStatusMeta({
    sessionExists,
    liveRequested,
    liveChecked,
    loggedIn,
    matchesExpected,
    live,
  });
  return {
    ok: true,
    status: 'succeeded',
    command,
    profileStatus: statusMeta.profileStatus,
    severity: statusMeta.severity,
    message: statusMeta.message,
    nextAction: statusMeta.nextAction,
    lastCheckedAt: statusMeta.lastCheckedAt,
    evidence: statusMeta.evidence,
    platform,
    profile: profileId,
    profileId,
    accountHandle: profile.accountHandle || null,
    accountUrl: profile.accountUrl || null,
    accountGroup: profile.accountGroup || null,
    sessionRef: profile.sessionRef || path.join('sessions', platform, profileId),
    sessionPath,
    sessionExists,
    localSessionExists: sessionExists,
    liveChecked,
    loggedIn,
    matchesExpected,
    ready,
    live: live || null,
    data: profileJson(profile, { sessionPath, sessionExists }),
  };
}

function profileStatusMeta({ sessionExists, liveRequested, liveChecked, loggedIn, matchesExpected, live }) {
  if (!sessionExists) {
    return {
      profileStatus: 'login_needed',
      severity: 'warning',
      message: 'No saved browser session exists for this profile.',
      nextAction: 'open_login',
      lastCheckedAt: live?.checkedAt || null,
      evidence: evidenceForLive(live),
    };
  }

  if (!liveRequested) {
    return {
      profileStatus: 'session_exists_unverified',
      severity: 'warning',
      message: 'A saved browser session exists, but it has not been verified in this check.',
      nextAction: 'verify_session',
      lastCheckedAt: null,
      evidence: { type: 'local_session', summary: 'Session directory exists; live account identity was not checked.' },
    };
  }

  if (live?.delegated) {
    return {
      profileStatus: 'session_exists_unverified',
      severity: 'warning',
      message: 'Live verification is delegated to RunnerOS browser tools.',
      nextAction: 'run_delegated_verification',
      lastCheckedAt: live.checkedAt || null,
      evidence: evidenceForLive(live),
    };
  }

  if (!liveChecked) {
    return {
      profileStatus: 'verification_failed',
      severity: 'error',
      message: 'Live verification did not complete.',
      nextAction: 'retry_verify',
      lastCheckedAt: live?.checkedAt || null,
      evidence: evidenceForLive(live),
    };
  }

  if (!loggedIn) {
    return {
      profileStatus: 'login_needed',
      severity: 'warning',
      message: 'The saved browser session is not logged in.',
      nextAction: 'open_login',
      lastCheckedAt: live.checkedAt || null,
      evidence: evidenceForLive(live),
    };
  }

  if (matchesExpected === true) {
    return {
      profileStatus: 'verified',
      severity: 'info',
      message: 'The saved browser session is logged in and matches the expected account.',
      nextAction: 'none',
      lastCheckedAt: live.checkedAt || null,
      evidence: evidenceForLive(live),
    };
  }

  if (matchesExpected === false) {
    return {
      profileStatus: 'wrong_account',
      severity: 'error',
      message: 'The saved browser session is logged in, but the visible account does not match this profile.',
      nextAction: 'fix_login',
      lastCheckedAt: live.checkedAt || null,
      evidence: evidenceForLive(live),
    };
  }

  return {
    profileStatus: 'session_exists_unverified',
    severity: 'warning',
    message: 'The saved browser session is logged in, but account identity has not been verified.',
    nextAction: 'verify_account_identity',
    lastCheckedAt: live.checkedAt || null,
    evidence: evidenceForLive(live),
  };
}

function evidenceForLive(live) {
  if (!live) {
    return { type: 'none', summary: 'No live verification evidence collected.' };
  }
  if (live.delegated) {
    return {
      type: 'delegated_browser_plan',
      summary: live.message || 'Verification must be completed in RunnerOS browser tools.',
      code: live.code || null,
    };
  }
  return {
    type: 'live_check',
    summary: live.loggedIn ? 'Logged-in browser signals were detected.' : 'Logged-in browser signals were not detected.',
    checkedAt: live.checkedAt || null,
    visibleIdentity: live.visibleIdentity || null,
    matchesExpected: live.matchesExpected ?? null,
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
    accountGroup: profile.accountGroup || null,
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
