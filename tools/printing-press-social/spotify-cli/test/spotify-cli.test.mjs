import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

function run(args, env = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function runFailure(args, env = {}) {
  try {
    run(args, env);
  } catch (error) {
    return JSON.parse(error.stdout.toString());
  }
  throw new Error('Expected command to fail');
}

function home() {
  return { SOCIAL_HOME: mkdtempSync(path.join(tmpdir(), 'spotify-cli-')) };
}

function addProfile(env) {
  return JSON.parse(run([
    'profile', 'add', 'spotify',
    '--profile', 'artist01',
    '--handle', 'Luna Vale',
    '--account-url', 'https://open.spotify.com/artist/abc123',
    '--json',
  ], env));
}

test('adds a Spotify profile with account identity', () => {
  const env = home();
  const added = addProfile(env);
  assert.equal(added.ok, true);
  assert.equal(added.data.platform, 'spotify');
  assert.equal(added.data.accountHandle, 'Luna Vale');
  assert.equal(added.data.confirmPolicy, 'require-confirm');

  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 1);
  assert.equal(listed.profiles[0].platform, 'spotify');
});

test('profile status reports login_needed before any session', () => {
  const env = home();
  addProfile(env);
  const status = JSON.parse(run(['profile', 'status', 'spotify', '--profile', 'artist01', '--json'], env));
  assert.equal(status.ok, true);
  assert.equal(status.profileStatus, 'login_needed');
});

test('browser-only Spotify profile verifies from an authenticated Spotify for Artists workspace', () => {
  const env = home();
  run(['profile', 'add', 'spotify', '--profile', 'browser-only', '--json'], env);
  mkdirSync(path.join(env.SOCIAL_HOME, 'sessions', 'spotify', 'browser-only'), { recursive: true });

  const verification = JSON.stringify({
    platform: 'spotify',
    profile: 'browser-only',
    loggedIn: true,
    visibleIdentity: { url: 'https://artists.spotify.com/c/roster' },
  });
  const status = JSON.parse(run([
    'profile', 'status', 'spotify', '--profile', 'browser-only',
    '--live', '--verification-json', verification, '--json',
  ], env));

  assert.equal(status.ready, true);
  assert.equal(status.profileStatus, 'verified');
  assert.equal(status.matchesExpected, true);
});

test('browser-only Spotify profile does not accept a generic Spotify consumer session', () => {
  const env = home();
  run(['profile', 'add', 'spotify', '--profile', 'browser-only', '--json'], env);
  mkdirSync(path.join(env.SOCIAL_HOME, 'sessions', 'spotify', 'browser-only'), { recursive: true });

  const verification = JSON.stringify({
    platform: 'spotify',
    profile: 'browser-only',
    loggedIn: true,
    visibleIdentity: { url: 'https://open.spotify.com/collection/playlists' },
  });
  const status = JSON.parse(run([
    'profile', 'status', 'spotify', '--profile', 'browser-only',
    '--live', '--verification-json', verification, '--json',
  ], env));

  assert.equal(status.ready, false);
  assert.equal(status.profileStatus, 'wrong_account');
});

test('snapshot without capture returns a browser plan + capture contract', () => {
  const env = home();
  addProfile(env);
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--json'], env));
  assert.equal(result.status, 'dry_run');
  assert.ok(result.browserPlan.steps.length > 0);
  assert.equal(result.browserPlan.browserSession.partition, 'persist:social-spotify-artist01');
  assert.ok(result.capture.fields.streams);
  assert.ok(result.capture.fields.dailyStreams);
});

test('snapshot normalizes captured numbers and never fabricates missing ones', () => {
  const env = home();
  addProfile(env);
  const capture = JSON.stringify({
    snapshotDate: '2026-07-08',
    windowDays: 28,
    streams: 12000,
    listeners: 3400,
    followers: 800,
    saves: null,
    dailyStreams: [
      { date: '2026-07-07', streams: 420 },
      { date: '2026-07-08', streams: 510 },
    ],
    topCities: [{ city: 'London', listeners: 900 }],
    topTracks: [{ name: 'Night Drive', streams: 5000 }],
    sources: { playlists: 40 },
  });
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--no-out', '--capture-json', capture, '--json'], env));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.dataSource, 'spotify-for-artists-browser');
  assert.equal(result.snapshot.metrics.streams, 12000);
  assert.equal(result.snapshot.metrics.saves, null);
  assert.deepEqual(result.snapshot.dailyStreams, [
    { date: '2026-07-07', streams: 420 },
    { date: '2026-07-08', streams: 510 },
  ]);
  assert.equal(result.snapshot.partial, true);
  assert.match(result.snapshot.errors.join(' '), /saves/);
  assert.equal(result.snapshot.geo.topCities[0].city, 'London');
});

test('snapshot writes a snapshot file when --out is given', () => {
  const env = home();
  env.CRAFT_WORKSPACE_PATH = env.SOCIAL_HOME;
  addProfile(env);
  const out = path.join(env.SOCIAL_HOME, 'snap.json');
  const capture = JSON.stringify({ snapshotDate: '2026-07-08', streams: 1, listeners: 1, followers: 1, saves: 1 });
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', capture, '--out', out, '--json'], env));
  assert.equal(result.outPath, out);
  assert.equal(existsSync(out), true);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).snapshot === undefined, true);
});

test('snapshot resolves default and relative output inside the workspace', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-workspace-'));
  addProfile(env);
  const capture = JSON.stringify({ snapshotDate: '2026-07-08', windowDays: 28, streams: 1, listeners: 1, followers: 1, saves: 1 });

  const defaultResult = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', capture, '--workspace', workspace, '--json'], env));
  assert.equal(defaultResult.outPath, path.join(workspace, 'data/spotify/snapshots/2026-07-08-s4a.json'));

  const relativeResult = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', JSON.stringify({ ...JSON.parse(capture), snapshotDate: '2026-07-09' }), '--out', 'captures/latest.json', '--json'], { ...env, CRAFT_WORKSPACE_PATH: workspace }));
  assert.equal(relativeResult.outPath, path.join(workspace, 'captures/latest.json'));
});

test('snapshot marks missing date/window and malformed optional shapes as partial', () => {
  const env = home();
  addProfile(env);
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--no-out', '--capture-json', JSON.stringify({
    streams: -1,
    listeners: 10,
    followers: 5,
    saves: 2,
    topCities: 'not-an-array',
    topCountries: [{ country: 'US', listeners: -2 }, {}],
    topTracks: [{ name: 'Track', streams: 1.5 }, { streams: 10 }],
    sources: ['not-an-object'],
  }), '--json'], env));
  assert.equal(result.snapshot.windowDays, null);
  assert.equal(result.snapshot.metrics.streams, null);
  assert.equal(result.snapshot.partial, true);
  assert.match(result.snapshot.errors.join(' '), /Snapshot date not captured/);
  assert.match(result.snapshot.errors.join(' '), /Reporting window not captured/);
  assert.match(result.snapshot.errors.join(' '), /Top cities capture was not an array/);
  assert.match(result.snapshot.errors.join(' '), /topCountries\[0\]\.listeners/);
  assert.match(result.snapshot.errors.join(' '), /topCountries\[1\] entry/);
  assert.match(result.snapshot.errors.join(' '), /topTracks\[0\]\.streams/);
  assert.match(result.snapshot.errors.join(' '), /topTracks\[1\] entry/);
});

test('snapshot refuses to overwrite an existing file', () => {
  const env = home();
  env.CRAFT_WORKSPACE_PATH = env.SOCIAL_HOME;
  addProfile(env);
  const out = path.join(env.SOCIAL_HOME, 'existing.json');
  writeFileSync(out, '{"keep":true}\n');
  const result = runFailure(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', JSON.stringify({ snapshotDate: '2026-07-08' }), '--out', out, '--json'], env);
  assert.equal(result.code, 'SNAPSHOT_EXISTS');
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { keep: true });
});

test('snapshot refuses a relative output that escapes the workspace', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-workspace-'));
  addProfile(env);
  const result = runFailure(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', JSON.stringify({ snapshotDate: '2026-07-08' }), '--workspace', workspace, '--out', '../escape.json', '--json'], env);
  assert.equal(result.code, 'OUTPUT_OUTSIDE_WORKSPACE');
});

test('snapshot refuses absolute capture and output paths outside the workspace', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-workspace-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'spotify-outside-'));
  addProfile(env);
  const captureFile = path.join(outside, 'capture.json');
  writeFileSync(captureFile, JSON.stringify({ snapshotDate: '2026-07-08' }));

  const captureResult = runFailure(['snapshot', 'spotify', '--profile', 'artist01', '--capture-file', captureFile, '--workspace', workspace, '--no-out', '--json'], env);
  assert.equal(captureResult.code, 'OUTPUT_OUTSIDE_WORKSPACE');

  const outputResult = runFailure(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', JSON.stringify({ snapshotDate: '2026-07-08' }), '--workspace', workspace, '--out', path.join(outside, 'snapshot.json'), '--json'], env);
  assert.equal(outputResult.code, 'OUTPUT_OUTSIDE_WORKSPACE');
});

test('snapshot refuses workspace paths that escape through a symlink', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-workspace-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'spotify-outside-'));
  addProfile(env);
  symlinkSync(outside, path.join(workspace, 'linked-outside'));

  const result = runFailure([
    'snapshot', 'spotify', '--profile', 'artist01',
    '--capture-json', JSON.stringify({ snapshotDate: '2026-07-08' }),
    '--workspace', workspace, '--out', 'linked-outside/snapshot.json', '--json',
  ], env);
  assert.equal(result.code, 'OUTPUT_OUTSIDE_WORKSPACE');
  assert.equal(existsSync(path.join(outside, 'snapshot.json')), false);
});

test('playlist create dry-run normalizes URLs to URIs and keeps order', () => {
  const env = home();
  addProfile(env);
  const result = JSON.parse(run([
    'playlist', 'spotify', 'create',
    '--profile', 'artist01',
    '--name', 'Late Night Drive',
    '--tracks', 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh,https://open.spotify.com/track/1301WleyT98MSxVHPZCA6M',
    '--visibility', 'public',
    '--dry-run', '--json',
  ], env));
  assert.equal(result.status, 'dry_run');
  assert.deepEqual(result.action.payload.tracks, ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh', 'spotify:track:1301WleyT98MSxVHPZCA6M']);
  assert.equal(result.action.payload.visibility, 'public');
  assert.equal(result.browserPlan.accountVerification.requiredBeforeLiveSubmit, true);
});

test('playlist discovery returns a bounded browser plan before capture', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-discovery-'));
  addProfile(env);
  const result = JSON.parse(run([
    'playlist', 'spotify', 'discover', '--profile', 'artist01',
    '--theme', 'Late night alternative', '--seed', 'Artist A', '--seed', 'Artist B',
    '--workspace', workspace, '--json',
  ], env));
  assert.equal(result.status, 'dry_run');
  assert.equal(result.request.limits.rawCandidates, 100);
  assert.equal(result.request.limits.shortlist, 25);
  assert.match(result.browserPlan.steps.join(' '), /do not open or analyze every track page/i);
});

test('playlist discovery filters, ranks, diversifies, and reuses its cache', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-discovery-'));
  addProfile(env);
  const ids = Array.from({ length: 30 }, (_, index) => String(index).padStart(22, '0'));
  const capture = {
    candidates: [
      ...ids.map((id, index) => ({
        spotifyUrl: `https://open.spotify.com/track/${id}`,
        name: `Track ${index}`,
        artist: index < 4 ? 'Repeated Artist' : `Artist ${index}`,
        source: index % 2 === 0 ? 'fans-also-like' : 'playlist',
        popularity: 50,
        seedMatches: index === 0 ? ['Artist A', 'not-a-seed'] : [],
      })),
      { spotifyUrl: `spotify:track:${ids[0]}`, name: 'Duplicate', artist: 'Repeated Artist', source: 'search' },
      { spotifyUrl: 'bad', name: 'Bad', artist: 'Bad Artist' },
    ],
  };
  const captureFile = path.join(workspace, 'capture.json');
  writeFileSync(captureFile, JSON.stringify(capture));
  const args = [
    'playlist', 'spotify', 'discover', '--profile', 'artist01', '--theme', 'Late night alternative',
    '--seed', 'Artist A', '--workspace', workspace, '--capture-file', captureFile, '--json',
  ];
  const first = JSON.parse(run(args, env));
  assert.equal(first.cacheHit, false);
  assert.equal(first.shortlist.length, 25);
  assert.equal(first.shortlist.filter((track) => track.artist === 'Repeated Artist').length, 2);
  assert.equal(first.shortlist[0].seedMatches.includes('not-a-seed'), false);
  assert.ok(first.warnings.some((warning) => /valid Spotify track/i.test(warning)));

  const cached = JSON.parse(run(args.filter((arg) => arg !== '--capture-file' && arg !== captureFile), env));
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(cached.shortlist, first.shortlist);
});

test('playlist discovery caps seeds and raw candidate ingestion', () => {
  const env = home();
  const workspace = mkdtempSync(path.join(tmpdir(), 'spotify-discovery-'));
  addProfile(env);
  const candidates = Array.from({ length: 105 }, (_, index) => ({
    spotifyUrl: `spotify:track:${String(index).padStart(22, '0')}`,
    name: `Track ${index}`,
    artist: `Artist ${index}`,
    source: 'radio',
  }));
  const result = JSON.parse(run([
    'playlist', 'spotify', 'discover', '--profile', 'artist01', '--theme', 'Focused',
    '--seeds', 'A,B,C,D,E,F', '--workspace', workspace,
    '--capture-json', JSON.stringify({ candidates }), '--json',
  ], env));
  assert.deepEqual(result.request.seeds, ['A', 'B', 'C', 'D']);
  assert.equal(result.validCount, 100);
  assert.equal(result.shortlist.length, 25);
  assert.match(result.warnings.join(' '), /100-track cap/);
});

test('playlist create refuses live execution without --confirm yes', () => {
  const env = home();
  addProfile(env);
  const result = runFailure([
    'playlist', 'spotify', 'create',
    '--profile', 'artist01',
    '--name', 'Late Night Drive',
    '--tracks', 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    '--json',
  ], env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'GUARDED_EXECUTE_REQUIRED');
});

test('playlist create refuses direct live execution even with confirmation', () => {
  const env = home();
  addProfile(env);
  const result = runFailure([
    'playlist', 'spotify', 'create',
    '--profile', 'artist01',
    '--name', 'Late Night Drive',
    '--tracks', 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    '--confirm', 'yes',
    '--json',
  ], env);
  assert.equal(result.code, 'GUARDED_EXECUTE_REQUIRED');
});

test('playlist receipt records observed completion and dedupes only after success', () => {
  const env = home();
  addProfile(env);
  const dryRun = JSON.parse(run([
    'playlist', 'spotify', 'create', '--profile', 'artist01', '--name', 'Late Night Drive',
    '--tracks', 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', '--dry-run', '--json',
  ], env));
  const actionFile = path.join(env.SOCIAL_HOME, 'approved.json');
  const verificationFile = path.join(env.SOCIAL_HOME, 'verification.json');
  writeFileSync(actionFile, JSON.stringify(dryRun));
  writeFileSync(verificationFile, JSON.stringify({
    platform: 'spotify', profile: 'artist01', loggedIn: true,
    checkedAt: new Date().toISOString(),
    visibleIdentity: { handle: 'Luna Vale' },
  }));
  const args = [
    'playlist', 'spotify', 'receipt', '--profile', 'artist01', '--action-file', actionFile,
    '--expected-action-id', dryRun.actionId, '--expected-action-digest', dryRun.approvalDigest,
    '--playlist-url', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    '--verification-result', verificationFile, '--json',
  ];

  const receipt = JSON.parse(run(args, env));
  assert.equal(receipt.status, 'succeeded');
  assert.equal(receipt.receipt.playlistUrl, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');

  const duplicate = JSON.parse(run(args, env));
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.duplicateOf, dryRun.actionId);
  assert.equal(duplicate.receipt.playlistUrl, receipt.receipt.playlistUrl);
});

test('playlist receipt rejects stale and future account verification evidence', () => {
  const env = home();
  addProfile(env);
  const dryRun = JSON.parse(run([
    'playlist', 'spotify', 'create', '--profile', 'artist01', '--name', 'Late Night Drive',
    '--tracks', 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', '--dry-run', '--json',
  ], env));
  const actionFile = path.join(env.SOCIAL_HOME, 'approved.json');
  const verificationFile = path.join(env.SOCIAL_HOME, 'verification.json');
  writeFileSync(actionFile, JSON.stringify(dryRun));
  const args = [
    'playlist', 'spotify', 'receipt', '--profile', 'artist01', '--action-file', actionFile,
    '--expected-action-id', dryRun.actionId, '--expected-action-digest', dryRun.approvalDigest,
    '--playlist-url', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    '--verification-result', verificationFile, '--json',
  ];

  for (const checkedAt of [
    new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    new Date(Date.now() + 2 * 60 * 1000).toISOString(),
  ]) {
    writeFileSync(verificationFile, JSON.stringify({
      platform: 'spotify', profile: 'artist01', loggedIn: true, checkedAt,
      visibleIdentity: { handle: 'Luna Vale' },
    }));
    assert.equal(runFailure(args, env).code, 'STALE_VERIFICATION_RESULT');
  }
});

test('playlist create rejects invalid track URIs', () => {
  const env = home();
  addProfile(env);
  const result = runFailure([
    'playlist', 'spotify', 'create',
    '--profile', 'artist01',
    '--name', 'Mood',
    '--tracks', 'not-a-uri',
    '--dry-run', '--json',
  ], env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_ACTION');
});

test('playlist create rejects malformed short Spotify track ids', () => {
  const env = home();
  addProfile(env);
  const result = runFailure([
    'playlist', 'spotify', 'create',
    '--profile', 'artist01',
    '--name', 'Mood',
    '--tracks', 'spotify:track:abc',
    '--dry-run', '--json',
  ], env);
  assert.equal(result.code, 'INVALID_ACTION');
});

test('playlist create rejects duplicate track URIs', () => {
  const env = home();
  addProfile(env);
  const uri = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh';
  const result = runFailure([
    'playlist', 'spotify', 'create', '--profile', 'artist01', '--name', 'Mood',
    '--tracks', `${uri},${uri}`, '--dry-run', '--json',
  ], env);
  assert.equal(result.code, 'INVALID_ACTION');
  assert.match(result.error, /duplicate track URIs/);
});

test('playlist create rejects artist-bait names', () => {
  const env = home();
  addProfile(env);
  const result = runFailure([
    'playlist', 'spotify', 'create',
    '--profile', 'artist01',
    '--name', 'Songs Like Drake',
    '--tracks', 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
    '--dry-run', '--json',
  ], env);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_ACTION');
});
