import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isYouTubeLoggedIn } from '../src/cli.mjs';

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

function fakePage({ visible = [], signInVisible = false } = {}) {
  return {
    waitForTimeout: async () => {},
    getByText: (text) => ({
      first: () => ({
        isVisible: async () => text === 'Sign in' ? signInVisible : visible.includes(String(text)),
      }),
    }),
    locator: (selector) => ({
      first: () => ({
        isVisible: async () => visible.includes(selector),
      }),
    }),
  };
}

test('YouTube auth check only trusts strong logged-in signals', async () => {
  assert.equal(await isYouTubeLoggedIn(fakePage()), false);
  assert.equal(await isYouTubeLoggedIn(fakePage({ signInVisible: true })), false);
  assert.equal(await isYouTubeLoggedIn(fakePage({ visible: ['#avatar-btn'] })), true);
});

test('adds and lists an YouTube profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const added = JSON.parse(run([
    'profile', 'add', 'youtube',
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
  assert.equal(listed.profiles[0].sessionRef, path.join('sessions', 'youtube', 'artist01'));
});

test('updates, statuses, and deletes an YouTube profile with normalized JSON', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run(['profile', 'add', 'youtube', '--profile', 'artist01', '--handle', '@artist01', '--json'], env);

  const updated = JSON.parse(run([
    'profile', 'update', 'youtube',
    '--profile', 'artist01',
    '--handle', '@artist-main',
    '--account-url', 'https://www.youtube.com/@artist-main',
    '--json',
  ], env));
  assert.equal(updated.ok, true);
  assert.equal(updated.command, 'profile.update');
  assert.equal(updated.data.accountHandle, '@artist-main');
  assert.equal(updated.data.accountUrl, 'https://www.youtube.com/@artist-main');

  const status = JSON.parse(run(['profile', 'status', 'youtube', '--profile', 'artist01', '--json'], env));
  assert.equal(status.ok, true);
  assert.equal(status.profileId, 'artist01');
  assert.equal(status.accountHandle, '@artist-main');
  assert.equal(status.sessionExists, false);
  assert.equal(status.profileStatus, 'login_needed');
  assert.equal(status.severity, 'warning');
  assert.equal(status.nextAction, 'open_login');
  assert.equal(status.lastCheckedAt, null);
  assert.equal(status.evidence.type, 'none');
  assert.equal(status.liveChecked, false);
  assert.equal(status.loggedIn, null);
  assert.equal(status.matchesExpected, null);
  assert.equal(status.data.sessionPath, path.join(home, 'sessions', 'youtube', 'artist01'));

  const liveStatus = JSON.parse(run(['profile', 'status', 'youtube', '--profile', 'artist01', '--live', '--json'], env));
  assert.equal(liveStatus.ok, true);
  assert.equal(liveStatus.ready, false);
  assert.equal(liveStatus.profileStatus, 'login_needed');
  assert.equal(liveStatus.severity, 'warning');
  assert.equal(liveStatus.nextAction, 'open_login');
  assert.equal(liveStatus.evidence.type, 'delegated_browser_plan');
  assert.equal(liveStatus.evidence.code, 'RUNNER_CDP_DELEGATED');
  assert.equal(liveStatus.liveChecked, false);
  assert.equal(liveStatus.loggedIn, null);
  assert.equal(liveStatus.matchesExpected, null);
  assert.equal(liveStatus.live.delegated, true);
  assert.equal(liveStatus.live.code, 'RUNNER_CDP_DELEGATED');
  assert.equal(liveStatus.live.browserPlan.accountVerification.verificationTargetKnown, true);
  assert.equal(liveStatus.live.browserPlan.accountVerification.identityProbe.normalizedExpectedHandle, '@artist-main');

  mkdirSync(path.join(home, 'sessions', 'youtube', 'artist01'), { recursive: true });
  const verified = JSON.parse(run([
    'profile', 'status', 'youtube',
    '--profile', 'artist01',
    '--live',
    '--verification-json', JSON.stringify({
      platform: 'youtube',
      profile: 'artist01',
      loggedIn: true,
      visibleIdentity: { handle: '@artist-main' },
    }),
    '--json',
  ], env));
  assert.equal(verified.ready, true);
  assert.equal(verified.profileStatus, 'verified');
  assert.equal(verified.loggedIn, true);
  assert.equal(verified.matchesExpected, true);
  assert.equal(verified.evidence.type, 'live_check');
  assert.equal(verified.evidence.visibleIdentity.handle, '@artist-main');

  const login = JSON.parse(run(['profile', 'login', 'youtube', '--profile', 'artist01', '--json'], env));
  assert.equal(login.ok, true);
  assert.equal(login.status, 'delegated');
  assert.equal(login.liveChecked, false);
  assert.equal(login.code, 'RUNNER_CDP_DELEGATED');

  const deleted = JSON.parse(run(['profile', 'delete', 'youtube', '--profile', 'artist01', '--json'], env));
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, true);
  const listed = JSON.parse(run(['profile', 'list', '--json'], env));
  assert.equal(listed.profiles.length, 0);
});

test('dry-runs an YouTube comment', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  const result = JSON.parse(run([
    'comment', 'youtube',
    '--profile', 'smoke',
    '--url', 'https://www.youtube.com/@user/video/123',
    '--text', 'nice post',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.action.verb, 'comment');
  assert.equal(result.action.payload.targetUrl, 'https://www.youtube.com/@user/video/123');
});

test('YouTube rejects unsupported dm command', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const result = runFailure([
    'dm', 'youtube',
    '--profile', 'smoke',
    '--to', 'testuser',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_COMMAND');
});

test('sets require-confirm policy on a profile', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'youtube',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'profile', 'set-policy', 'youtube',
    '--profile', 'artist01',
    '--confirm-policy', 'require-confirm',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.data.confirmPolicy, 'require-confirm');
});

test('dry-runs a YouTube full video with normalized action output', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'video.mp4');
  writeFileSync(media, 'fake');
  const env = { SOCIAL_HOME: home };
  run([
    'profile', 'add', 'youtube',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], env);

  const result = JSON.parse(run([
    'post', 'youtube',
    '--profile', 'artist01',
    '--post-type', 'video',
    '--text', 'new drop tonight',
    '--description', 'full upload description',
    '--media', media,
    '--visibility', 'unlisted',
    '--dry-run',
    '--json',
  ], env));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.action.platform, 'youtube');
  assert.equal(result.action.payload.postType, 'video');
  assert.equal(result.action.payload.title, 'new drop tonight');
  assert.equal(result.action.payload.description, 'full upload description');
  assert.equal(result.action.payload.visibility, 'unlisted');
  assert.deepEqual(result.browserPlan.steps, [
    'open persistent session',
    'verify visible account/channel matches profile',
    'go to YouTube Studio upload',
    'attach video',
    'set title',
    'set description',
    'set made-for-kids',
    'set visibility',
    'publish video',
  ]);
  assert.equal(result.browserPlan.accountVerification.requiredBeforeLiveSubmit, true);
  assert.equal(result.browserPlan.accountVerification.verificationTargetKnown, true);
  assert.equal(result.browserPlan.accountVerification.fallbackExpectedIdentity, '@artist01');
});

test('dry-runs a YouTube Short upload', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const media = path.join(home, 'short.mp4');
  writeFileSync(media, 'fake');

  const result = JSON.parse(run([
    'post', 'youtube',
    '--profile', 'smoke',
    '--post-type', 'shorts',
    '--text', 'short title',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.action.payload.postType, 'short');
  assert.equal(result.action.payload.visibility, 'private');
  assert.equal(result.browserPlan.steps.at(-1), 'publish as Short');
});

test('dry-run rejects invalid YouTube media', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-cli-'));
  const invalid = path.join(home, 'not-video.jpg');
  writeFileSync(invalid, 'fake');

  const result = runFailure([
    'post', 'youtube',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', invalid,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home });

  assert.equal(result.ok, false);
  assert.match(result.error, /YouTube upload media must be a video file/);
});
