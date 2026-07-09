#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BROWSER_ENGINE, resolveBrowserEngine } from '../../src/browser-engines.mjs';
import { createProfile, profileJson, profileListJson, profileLoginJson, profileStatusJson, updateProfile } from '../../src/profile-json.mjs';
import { readProfileVerificationResult } from '../../src/profile-verification.mjs';
import {
  acquireProfileLock,
  assertConfirmPolicy,
  assertLiveReady,
  buildBrowserPlan,
  buildSmokeProfile,
  duplicateActionResult,
  findCompletedAction,
  recordCompletedAction,
  resolveConfirmPolicy,
  smokeProfileAllowed,
} from '../../src/action-safety.mjs';

const PLATFORM = 'spotify';
const SUPPORTED_PLATFORMS = new Set([PLATFORM]);
const VISIBILITIES = new Set(['public', 'private']);
const OPEN_SPOTIFY_HOME = 'https://open.spotify.com/';
const S4A_HOME = 'https://artists.spotify.com/';

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    writeResult({
      ok: false,
      status: 'failed',
      error: error.message,
      code: error.code || 'UNHANDLED_ERROR',
    }, true);
    process.exit(1);
  });
}

function isDirectRun() {
  return Boolean(process.argv[1])
    && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv[0] === 'help') {
    printHelp();
    return;
  }

  const [group, command, ...rest] = argv;
  const flags = parseFlags(rest);

  if (group === 'profile') {
    await handleProfile(command, flags);
    return;
  }

  if (group === 'snapshot' && command === PLATFORM) {
    await handleSnapshot(flags);
    return;
  }

  if (group === 'playlist' && command === PLATFORM) {
    await handlePlaylist(flags);
    return;
  }

  throw new CliError(`Unknown command: ${argv.join(' ')}`, 'UNKNOWN_COMMAND');
}

// ============================================================
// Profiles (identical contract to the posting CLIs)
// ============================================================

async function handleProfile(command, flags) {
  if (command === 'add') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const store = loadProfileStore();
    const profile = createProfile({
      platform,
      profileId,
      flags,
      browserEngine: resolveBrowserEngine(flags),
      confirmPolicy: resolveConfirmPolicy(flags),
    });
    store.profiles[profileKey(platform, profileId)] = profile;
    saveProfileStore(store);
    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.add',
      platform,
      profile: profileId,
      data: profileJson(profile, { sessionPath: sessionDir(profile), sessionExists: fs.existsSync(sessionDir(profile)) }),
    }, flags.json);
    return;
  }

  if (command === 'update') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    if (flags['confirm-policy']) assertConfirmPolicy(flags['confirm-policy']);
    const store = loadProfileStore();
    const key = profileKey(platform, profileId);
    const profile = store.profiles[key];
    if (!profile) throw new CliError(`Profile not found: ${platform}/${profileId}`, 'PROFILE_NOT_FOUND');
    const updated = updateProfile(profile, flags, {
      browserEngine: flags.engine ? resolveBrowserEngine(flags, profile) : null,
      confirmPolicy: flags['confirm-policy'] || null,
    });
    store.profiles[key] = updated;
    saveProfileStore(store);
    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.update',
      platform,
      profile: profileId,
      data: profileJson(updated, { sessionPath: sessionDir(updated), sessionExists: fs.existsSync(sessionDir(updated)) }),
    }, flags.json);
    return;
  }

  if (command === 'delete') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const store = loadProfileStore();
    const key = profileKey(platform, profileId);
    if (!store.profiles[key]) throw new CliError(`Profile not found: ${platform}/${profileId}`, 'PROFILE_NOT_FOUND');
    delete store.profiles[key];
    saveProfileStore(store);
    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.delete',
      platform,
      profile: profileId,
      deleted: true,
    }, flags.json);
    return;
  }

  if (command === 'set-policy') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const confirmPolicy = requireFlag(flags, 'confirm-policy');
    assertConfirmPolicy(confirmPolicy);
    const store = loadProfileStore();
    const key = profileKey(platform, profileId);
    const profile = store.profiles[key];
    if (!profile) throw new CliError(`Profile not found: ${platform}/${profileId}`, 'PROFILE_NOT_FOUND');
    profile.confirmPolicy = confirmPolicy;
    profile.updatedAt = new Date().toISOString();
    store.profiles[key] = profile;
    saveProfileStore(store);
    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.set-policy',
      platform,
      profile: profileId,
      confirmPolicy,
      data: profileJson(profile, { sessionPath: sessionDir(profile), sessionExists: fs.existsSync(sessionDir(profile)) }),
    }, flags.json);
    return;
  }

  if (command === 'list') {
    const store = loadProfileStore();
    writeResult({
      ok: true,
      status: 'succeeded',
      command: 'profile.list',
      profiles: profileListJson(Object.values(store.profiles), sessionDir),
    }, flags.json);
    return;
  }

  if (command === 'status') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const profile = getProfile(platform, profileId);
    const sessionPath = sessionDir(profile);
    const localReady = fs.existsSync(sessionPath);
    let live = null;
    if (flags.live) live = await checkSpotifySession(profile, flags);
    writeResult(profileStatusJson({
      command: 'profile.status',
      platform,
      profileId,
      profile,
      sessionPath,
      sessionExists: localReady,
      live,
    }), flags.json);
    return;
  }

  if (command === 'login') {
    const platform = flags._[0];
    assertPlatform(platform);
    const profileId = requireFlag(flags, 'profile');
    const profile = getProfile(platform, profileId);
    writeResult(profileLoginJson({
      platform,
      profileId,
      profile,
      sessionPath: sessionDir(profile),
      result: delegatedLogin(profile),
    }), flags.json);
    return;
  }

  throw new CliError(`Unknown profile command: ${command}`, 'UNKNOWN_PROFILE_COMMAND');
}

function delegatedLogin(profile) {
  return {
    delegated: true,
    code: 'RUNNER_CDP_DELEGATED',
    loggedIn: null,
    checked: false,
    matchesExpected: null,
    sessionExists: fs.existsSync(sessionDir(profile)),
    message: 'Spotify login is delegated to RunnerOS native browser tools. Log in once at Spotify for Artists; the same session covers open.spotify.com.',
    browserPlan: buildBrowserPlan({
      profile,
      sessionPath: sessionDir(profile),
      steps: [
        `open Spotify for Artists (${S4A_HOME})`,
        'let the user log in manually',
        'verify visible account matches profile',
      ],
    }),
  };
}

async function checkSpotifySession(profile, flags) {
  const verification = readProfileVerificationResult(profile, flags);
  if (verification) return verification;
  return {
    checked: false,
    delegated: true,
    code: 'RUNNER_CDP_DELEGATED',
    loggedIn: null,
    matchesExpected: null,
    checkedAt: null,
    message: 'Spotify status verification is delegated to RunnerOS native browser tools.',
    browserPlan: buildBrowserPlan({
      profile,
      sessionPath: sessionDir(profile),
      steps: [`open Spotify for Artists (${S4A_HOME})`, 'verify visible account matches profile'],
    }),
  };
}

// ============================================================
// Snapshot (read: Spotify for Artists capture -> normalized snapshot)
// ============================================================

async function handleSnapshot(flags) {
  const profileId = requireFlag(flags, 'profile');
  const profile = getProfile(PLATFORM, profileId, { allowSmoke: smokeProfileAllowed(flags) });
  const captured = readCaptureInput(flags);

  if (!captured) {
    // No capture supplied yet: return the browser plan the agent should run to
    // read Spotify for Artists, plus the exact fields to capture and feed back.
    writeResult({
      ok: true,
      status: 'dry_run',
      command: 'snapshot.spotify',
      platform: PLATFORM,
      profile: profileId,
      mode: 'browser',
      capture: snapshotCaptureContract(flags),
      browserPlan: buildBrowserPlan({
        profile,
        sessionPath: sessionDir(profile),
        steps: [
          `open Spotify for Artists (${S4A_HOME})`,
          'verify visible account matches profile',
          'open the Audience/Home overview for the selected date range',
          'read streams, listeners, followers, saves, and the date range window',
          'open Audience > Where they listen for top cities and top countries',
          'open Music > Songs for top tracks (streams per track)',
          'open the source-of-streams breakdown if available',
          'return the captured values as JSON to feed back with --capture-json',
        ],
      }),
      next: [
        'Run the browserPlan through RunnerOS browser tools against the verified Spotify for Artists session.',
        'Collect the numbers into the capture contract shape.',
        'Re-run: social snapshot spotify --profile <id> --capture-json <json> --out data/spotify/snapshots/<date>.json --json',
      ],
    }, flags.json);
    return;
  }

  const snapshot = normalizeSnapshot(captured, { profile, flags });
  const outPath = resolveSnapshotOutPath(flags, snapshot.snapshotDate);
  if (outPath) {
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  }

  writeResult({
    ok: true,
    status: 'succeeded',
    command: 'snapshot.spotify',
    platform: PLATFORM,
    profile: profileId,
    dataSource: 'spotify-for-artists-browser',
    outPath: outPath || null,
    snapshot,
    contextPayload: {
      slug: 'artist-spotify-snapshot',
      body: snapshot,
      note: 'Write this as the artist-spotify-snapshot context doc using your context tooling.',
    },
  }, flags.json);
}

function snapshotCaptureContract(flags) {
  return {
    dateRange: flags['date-range'] || 'last-28-days',
    fields: {
      snapshotDate: 'YYYY-MM-DD (the capture date)',
      windowDays: 'integer, the reporting window length in days',
      streams: 'integer|null',
      listeners: 'integer|null',
      followers: 'integer|null',
      saves: 'integer|null',
      topCities: '[{ city: string, country?: string, listeners?: number }]',
      topCountries: '[{ country: string, listeners?: number }]',
      topTracks: '[{ name: string, streams?: number, spotifyUrl?: string }]',
      sources: '{ [sourceName: string]: number } e.g. playlists/algorithmic/listener-own/editorial',
    },
    rule: 'Only include numbers actually read from the page. Use null for anything not visible. Never estimate or fabricate.',
  };
}

function normalizeSnapshot(captured, { profile }) {
  const snapshotDate = typeof captured.snapshotDate === 'string' && captured.snapshotDate.trim()
    ? captured.snapshotDate.trim()
    : new Date().toISOString().slice(0, 10);
  const errors = Array.isArray(captured.errors) ? captured.errors.slice() : [];
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

  const metrics = {
    streams: num(captured.streams),
    listeners: num(captured.listeners),
    followers: num(captured.followers),
    saves: num(captured.saves),
  };
  const missing = Object.entries(metrics).filter(([, value]) => value === null).map(([key]) => key);
  if (missing.length) errors.push(`Missing metrics not captured: ${missing.join(', ')}`);

  return {
    version: 1,
    dataSource: 'spotify-for-artists-browser',
    snapshotDate,
    windowDays: num(captured.windowDays) ?? 0,
    artist: {
      name: profile.accountHandle || null,
      spotifyUrl: profile.accountUrl || null,
      profile: profile.id,
    },
    metrics,
    geo: {
      topCities: normalizeCityList(captured.topCities),
      topCountries: Array.isArray(captured.topCountries) ? captured.topCountries : [],
    },
    tracks: normalizeTrackList(captured.topTracks),
    sources: (captured.sources && typeof captured.sources === 'object') ? captured.sources : {},
    partial: missing.length > 0,
    errors,
    capturedAt: typeof captured.capturedAt === 'string' ? captured.capturedAt : null,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCityList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && (item.city || typeof item === 'string'))
    .map((item) => (typeof item === 'string'
      ? { city: item }
      : { city: item.city, country: item.country ?? null, listeners: numOrNull(item.listeners) }));
}

function normalizeTrackList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && (item.name || typeof item === 'string'))
    .map((item) => (typeof item === 'string'
      ? { name: item }
      : { name: item.name, streams: numOrNull(item.streams), spotifyUrl: item.spotifyUrl ?? null }));
}

function numOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readCaptureInput(flags) {
  const raw = flags['capture-json'] || readMaybeFile(flags['capture-file']);
  if (!raw || raw === true) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new CliError(`Invalid --capture-json: ${error.message}`, 'INVALID_CAPTURE');
  }
}

function readMaybeFile(filePath) {
  if (!filePath || filePath === true) return null;
  return fs.readFileSync(String(filePath), 'utf8');
}

function resolveSnapshotOutPath(flags, snapshotDate) {
  const out = flags.out;
  if (out && out !== true) return path.resolve(String(out));
  if (flags['no-out']) return null;
  return path.resolve(process.cwd(), 'data', 'spotify', 'snapshots', `${snapshotDate}-s4a.json`);
}

// ============================================================
// Playlist create (write: open.spotify.com)
// ============================================================

async function handlePlaylist(flags) {
  const sub = flags._[0];
  if (sub !== 'create') {
    throw new CliError(`Unknown playlist subcommand: ${sub || '(missing)'} (supported: create)`, 'UNKNOWN_PLAYLIST_COMMAND');
  }

  const profileId = requireFlag(flags, 'profile');
  const profile = getProfile(PLATFORM, profileId, { allowSmoke: smokeProfileAllowed(flags) });
  const action = buildPlaylistCreateAction(profileId, flags);
  validatePlaylistCreateAction(action);

  const steps = [
    `open the Spotify web player (${OPEN_SPOTIFY_HOME})`,
    'verify visible account matches profile',
    'create a new playlist',
    'set the playlist name',
    ...(action.payload.description ? ['set the playlist description'] : []),
    `set visibility to ${action.payload.visibility}`,
    'add each track URI in the given order',
    'confirm the track count matches the plan',
    'capture the resulting playlist URL',
  ];

  if (flags['dry-run']) {
    writeResult({
      ok: true,
      status: 'dry_run',
      command: 'playlist.create.spotify',
      platform: PLATFORM,
      profile: profileId,
      mode: 'browser',
      action,
      browserPlan: buildBrowserPlan({ profile, sessionPath: sessionDir(profile), steps }),
    }, flags.json);
    return;
  }

  assertLiveReady(profile, flags, 'live Spotify playlist create');
  const duplicate = findCompletedAction({ action, socialHome: socialHome() });
  if (duplicate) {
    writeResult(duplicateActionResult(action, duplicate, 'playlist.create.spotify'), flags.json);
    return;
  }

  const releaseLock = acquireProfileLock({ action, socialHome: socialHome() });
  try {
    // Under runner-cdp (the default and only bundled engine) live execution is
    // delegated: RunnerOS browser tools run the verified browserPlan. No direct
    // headless automation ships in the app.
    const result = {
      ok: true,
      status: 'delegated',
      command: 'playlist.create.spotify',
      actionId: action.actionId,
      platform: PLATFORM,
      profile: profileId,
      mode: 'browser',
      action,
      browserPlan: buildBrowserPlan({ profile, sessionPath: sessionDir(profile), steps }),
      code: 'RUNNER_CDP_DELEGATED',
      message: 'Playlist create is delegated to RunnerOS native browser tools after account verification and approval.',
      next: [
        'Open the browser session named in browserPlan.browserSession.',
        'Verify the visible account matches browserPlan.accountVerification before creating anything.',
        'Execute the browserPlan steps, then record the resulting playlist URL as the receipt.',
      ],
    };
    recordCompletedAction({ action, socialHome: socialHome(), result, command: 'playlist.create.spotify' });
    writeResult(result, flags.json);
  } finally {
    releaseLock();
  }
}

function buildPlaylistCreateAction(profileId, flags) {
  const name = flags.name && flags.name !== true ? String(flags.name).trim() : '';
  const tracks = normalizeTrackUris(flags.tracks || flags.track);
  return {
    actionId: flags['action-id'] || `act_${randomUUID()}`,
    verb: 'playlist-create',
    platform: PLATFORM,
    profile: profileId,
    mode: 'browser',
    payload: {
      name,
      description: flags.description && flags.description !== true ? String(flags.description) : '',
      visibility: flags.visibility && flags.visibility !== true ? String(flags.visibility).toLowerCase() : 'private',
      tracks,
    },
    options: {
      dryRun: Boolean(flags['dry-run']),
      idempotencyKey: flags['idempotency-key'] || null,
      headed: Boolean(flags.headed),
    },
  };
}

function validatePlaylistCreateAction(action) {
  const errors = [];
  const { name, visibility, tracks, description } = action.payload;
  if (!name) errors.push('Playlist create needs --name');
  if (name.length > 100) errors.push('Playlist name exceeds 100 characters');
  if (description.length > 300) errors.push('Playlist description exceeds 300 characters');
  if (!VISIBILITIES.has(visibility)) errors.push('--visibility must be public or private');
  if (tracks.length === 0) errors.push('Playlist create needs at least one --tracks entry');
  if (tracks.length > 500) errors.push('Playlist create MVP accepts up to 500 tracks');
  const bad = tracks.filter((uri) => !/^spotify:track:[A-Za-z0-9]+$/.test(uri));
  if (bad.length) errors.push(`Invalid track URIs (expected spotify:track:<id>): ${bad.slice(0, 3).join(', ')}`);
  // Doctrine guard mirrored from the curator skill: no artist-bait names.
  const lowered = name.toLowerCase();
  for (const pattern of ['radio', 'songs like ', 'if you like ', 'more like ']) {
    if (lowered.includes(pattern)) {
      errors.push(`Playlist name looks like an artist-bait pattern ("${pattern.trim()}"). Name by mood, scene, or vibe.`);
    }
  }
  if (errors.length) throw new CliError(errors.join('; '), 'INVALID_ACTION');
}

function normalizeTrackUris(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(','))
    .map((item) => normalizeTrackUri(item.trim()))
    .filter(Boolean);
}

function normalizeTrackUri(value) {
  if (!value) return null;
  if (/^spotify:track:[A-Za-z0-9]+$/.test(value)) return value;
  const urlMatch = value.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/);
  if (urlMatch?.[1]) return `spotify:track:${urlMatch[1]}`;
  if (/^[A-Za-z0-9]{22}$/.test(value)) return `spotify:track:${value}`;
  return value; // left as-is so validation reports it
}

// ============================================================
// Shared helpers (mirrors the posting CLIs)
// ============================================================

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const raw = token.slice(2);
    const [key, inline] = raw.split('=', 2);
    if (inline !== undefined) {
      setFlag(out, key, inline);
      continue;
    }
    const next = args[i + 1];
    if (!next || next.startsWith('--')) {
      setFlag(out, key, true);
    } else {
      setFlag(out, key, next);
      i += 1;
    }
  }
  return out;
}

function setFlag(out, key, value) {
  if (out[key] === undefined) out[key] = value;
  else if (Array.isArray(out[key])) out[key].push(value);
  else out[key] = [out[key], value];
}

function writeResult(result, asJson = false) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (result.ok) {
    console.log(`${result.status}: ${result.command || 'spotify'}`);
    if (result.profile) console.log(`profile: ${result.profile}`);
    if (result.ready !== undefined) console.log(`ready: ${result.ready}`);
    return;
  }
  console.error(`${result.status || 'failed'}: ${result.error}`);
}

function loadProfileStore() {
  const filePath = profileStorePath();
  if (!fs.existsSync(filePath)) return { version: 1, profiles: {} };
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveProfileStore(store) {
  const filePath = profileStorePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

function getProfile(platform, id, options = {}) {
  const store = loadProfileStore();
  const profile = store.profiles[profileKey(platform, id)];
  if (profile) return profile;
  if (id === 'smoke' && options.allowSmoke) {
    return buildSmokeProfile(platform, id, DEFAULT_BROWSER_ENGINE);
  }
  throw new CliError(`Profile not found: ${platform}/${id}`, 'PROFILE_NOT_FOUND');
}

function profileKey(platform, id) {
  return `${platform}:${id}`;
}

function profileStorePath() {
  return path.join(socialHome(), 'profiles.json');
}

function sessionDir(profile) {
  return path.join(socialHome(), profile.sessionRef || path.join('sessions', profile.platform, profile.id));
}

function socialHome() {
  return process.env.SOCIAL_HOME || path.join(os.homedir(), '.config', 'printing-press-clis', PLATFORM);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function requireFlag(flags, name) {
  const value = flags[name];
  if (!value || value === true) throw new CliError(`Missing --${name}`, `MISSING_${name.toUpperCase().replaceAll('-', '_')}`);
  return String(value);
}

function assertPlatform(platform) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new CliError(`Unsupported platform for MVP: ${platform || '(missing)'}`, 'UNSUPPORTED_PLATFORM');
  }
}

function printHelp() {
  console.log(`social - Spotify browser harness (analyst snapshots + playlist creation)

Profiles (one Spotify login covers open.spotify.com and artists.spotify.com):
  social profile add spotify --profile artist01 --handle "Artist Name" --account-url https://open.spotify.com/artist/<id> --json
  social profile login spotify --profile artist01 --json
  social profile status spotify --profile artist01 --live --json
  social profile update spotify --profile artist01 --account-url https://open.spotify.com/artist/<id> --json
  social profile delete spotify --profile artist01 --json

Analyst snapshot (Spotify for Artists, browser capture):
  social snapshot spotify --profile artist01 --json                      # returns the browserPlan + capture contract
  social snapshot spotify --profile artist01 --capture-json <json> --out data/spotify/snapshots/2026-07-08.json --json

Playlist create (Spotify web player, approval-gated):
  social playlist spotify create --profile artist01 --name "Late Night Drive" --tracks "spotify:track:...,spotify:track:..." --visibility public --dry-run --json
  social playlist spotify create --profile artist01 --name "Late Night Drive" --tracks "..." --confirm yes --json

Global env:
  SOCIAL_HOME Override local store
  SOCIAL_CONFIRM_POLICY autorun|require-confirm (default: require-confirm; autorun writes require SOCIAL_ALLOW_AUTORUN_WRITES=1)
  SOCIAL_BROWSER_ENGINE runner-cdp (default; execution delegated to RunnerOS browser tools)
`);
}
