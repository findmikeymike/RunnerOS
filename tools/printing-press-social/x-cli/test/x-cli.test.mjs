import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isXLoggedIn } from '../src/cli.mjs';

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

function fakePage({ visible = [], loginFields = 0 } = {}) {
  return {
    waitForTimeout: async () => {},
    locator: (selector) => ({
      count: async () => (selector.includes('input[name="username"]') ? loginFields : 0),
      first: () => ({
        isVisible: async () => visible.includes(selector),
      }),
    }),
  };
}

test('X auth check only trusts strong logged-in signals', async () => {
  assert.equal(await isXLoggedIn(fakePage()), false);
  assert.equal(await isXLoggedIn(fakePage({ loginFields: 1 })), false);
  assert.equal(await isXLoggedIn(fakePage({ visible: ['[data-testid="SideNav_AccountSwitcher_Button"]'] })), true);
});

test('adds and lists an X profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const added = JSON.parse(run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], env));

  assert.equal(added.ok, true);
  assert.equal(added.data.adapter, 'runner-cdp');
  assert.equal(added.data.confirmPolicy, 'require-confirm');
  assert.equal(added.data.accountHandle, '@artist01');

  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 1);
  assert.equal(listed.profiles[0].id, 'artist01');
  assert.equal(listed.profiles[0].profile, 'artist01');
  assert.equal(listed.profiles[0].accountHandle, '@artist01');
  assert.equal(listed.profiles[0].sessionRef, path.join('sessions', 'x', 'artist01'));
});

test('updates, statuses, and deletes an X profile with normalized JSON', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run(['profile', 'add', 'x', '--profile', 'artist01', '--handle', '@artist01', '--json'], env);

  const updated = JSON.parse(run([
    'profile', 'update', 'x',
    '--profile', 'artist01',
    '--handle', '@artist-main',
    '--account-url', 'https://x.com/artist-main',
    '--json',
  ], env));
  assert.equal(updated.ok, true);
  assert.equal(updated.command, 'profile.update');
  assert.equal(updated.data.accountHandle, '@artist-main');
  assert.equal(updated.data.accountUrl, 'https://x.com/artist-main');

  const status = JSON.parse(run(['profile', 'status', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(status.ok, true);
  assert.equal(status.profileId, 'artist01');
  assert.equal(status.accountHandle, '@artist-main');
  assert.equal(status.sessionExists, false);
  assert.equal(status.localSessionExists, false);
  assert.equal(status.liveChecked, false);
  assert.equal(status.loggedIn, null);
  assert.equal(status.matchesExpected, null);
  assert.equal(status.data.sessionPath, path.join(home, 'sessions', 'x', 'artist01'));

  const liveStatus = JSON.parse(run(['profile', 'status', 'x', '--profile', 'artist01', '--live', '--json'], env));
  assert.equal(liveStatus.ok, true);
  assert.equal(liveStatus.ready, false);
  assert.equal(liveStatus.liveChecked, false);
  assert.equal(liveStatus.loggedIn, null);
  assert.equal(liveStatus.matchesExpected, null);
  assert.equal(liveStatus.live.delegated, true);
  assert.equal(liveStatus.live.code, 'RUNNER_CDP_DELEGATED');
  assert.equal(liveStatus.live.browserPlan.accountVerification.verificationTargetKnown, true);

  const login = JSON.parse(run(['profile', 'login', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(login.ok, true);
  assert.equal(login.status, 'delegated');
  assert.equal(login.liveChecked, false);
  assert.equal(login.code, 'RUNNER_CDP_DELEGATED');

  const deleted = JSON.parse(run(['profile', 'delete', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, true);
  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 0);
});

test('dry-runs an X comment', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'comment', 'x',
    '--profile', 'smoke',
    '--url', 'https://x.com/user/status/123',
    '--text', 'nice post',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'comment');
  assert.equal(result.action.payload.targetUrl, 'https://x.com/user/status/123');
});

test('dry-runs an X dm', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'dm', 'x',
    '--profile', 'smoke',
    '--to', 'testuser',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'dm');
  assert.equal(result.action.payload.recipient, 'testuser');
});

test('sets require-confirm policy on a profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'profile', 'set-policy', 'x',
    '--profile', 'artist01',
    '--confirm-policy', 'require-confirm',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.data.confirmPolicy, 'require-confirm');
});

test('dry-runs a text-only X post with normalized action output', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'post', 'x',
    '--profile', 'artist01',
    '--text', 'new drop tonight',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.action.platform, 'x');
  assert.equal(result.action.payload.text, 'new drop tonight');
  assert.deepEqual(result.browserPlan.steps, ['open persistent session', 'verify visible account matches profile', 'open X composer', 'enter post text', 'post']);
  assert.equal(result.browserPlan.accountVerification.requiredBeforeLiveSubmit, true);
  assert.equal(result.browserPlan.accountVerification.verificationTargetKnown, true);
  assert.equal(result.browserPlan.accountVerification.fallbackExpectedIdentity, '@artist01');
});

test('dry-runs an X media post', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'video.mp4');
  writeFileSync(media, 'fake');

  const result = JSON.parse(run([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'new clip',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.action.payload.media, [media]);
  assert.deepEqual(result.browserPlan.steps, ['open persistent session', 'verify visible account matches profile', 'open X composer', 'enter post text', 'attach media', 'post']);
});

test('dry-run rejects invalid X media', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const invalid = path.join(home, 'not-media.txt');
  writeFileSync(invalid, 'fake');

  const result = runFailure([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', invalid,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.match(result.error, /X post media must be image\/video/);
});
