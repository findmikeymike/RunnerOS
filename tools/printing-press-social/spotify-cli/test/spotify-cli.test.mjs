import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
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

test('snapshot without capture returns a browser plan + capture contract', () => {
  const env = home();
  addProfile(env);
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--json'], env));
  assert.equal(result.status, 'dry_run');
  assert.ok(result.browserPlan.steps.length > 0);
  assert.equal(result.browserPlan.browserSession.partition, 'persist:social-spotify-artist01');
  assert.ok(result.capture.fields.streams);
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
    topCities: [{ city: 'London', listeners: 900 }],
    topTracks: [{ name: 'Night Drive', streams: 5000 }],
    sources: { playlists: 40 },
  });
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--no-out', '--capture-json', capture, '--json'], env));
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.dataSource, 'spotify-for-artists-browser');
  assert.equal(result.snapshot.metrics.streams, 12000);
  assert.equal(result.snapshot.metrics.saves, null);
  assert.equal(result.snapshot.partial, true);
  assert.match(result.snapshot.errors.join(' '), /saves/);
  assert.equal(result.snapshot.geo.topCities[0].city, 'London');
});

test('snapshot writes a snapshot file when --out is given', () => {
  const env = home();
  addProfile(env);
  const out = path.join(env.SOCIAL_HOME, 'snap.json');
  const capture = JSON.stringify({ snapshotDate: '2026-07-08', streams: 1, listeners: 1, followers: 1, saves: 1 });
  const result = JSON.parse(run(['snapshot', 'spotify', '--profile', 'artist01', '--capture-json', capture, '--out', out, '--json'], env));
  assert.equal(result.outPath, out);
  assert.equal(existsSync(out), true);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).snapshot === undefined, true);
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
  assert.equal(result.code, 'CONFIRM_REQUIRED');
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
