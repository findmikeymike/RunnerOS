import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  acquireProfileLock,
  duplicateActionResult,
  findCompletedAction,
  recordCompletedAction,
} from '../src/action-safety.mjs';

const cli = fileURLToPath(new URL('../src/social.mjs', import.meta.url));

function run(args, env = {}) {
  return execFileSync(process.execPath, [cli, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('root registry returns CLI-Anything style command metadata', () => {
  const registry = JSON.parse(run(['registry', '--json']));
  assert.equal(registry.model, 'CLI-Anything');
  assert.ok(registry.platforms.instagram);
  assert.ok(registry.platforms.tiktok);
  assert.ok(registry.platforms.x);
  assert.ok(registry.platforms.youtube);
  assert.ok(registry.commands.some((command) => command.verb === 'doctor'));
});

test('root doctor reports install and platform health', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const result = JSON.parse(run(['doctor', '--json'], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.command, 'doctor');
  assert.equal(result.model, 'CLI-Anything');
  assert.equal(result.browserEngine, 'runner-cdp');
  assert.equal(result.checks.find((check) => check.name === 'browser-engine')?.mode, 'delegated');
  assert.equal(result.platforms.length, 4);
  assert.ok(result.platforms.find((platform) => platform.platform === 'x'));
  assert.ok(result.checks.find((check) => check.name === 'browser-engine'));
});

test('root dispatcher routes Instagram dry-run', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const media = path.join(home, 'image.jpg');
  writeFileSync(media, 'fake');
  const result = JSON.parse(run([
    'post', 'instagram',
    '--profile', 'smoke',
    '--text', 'hello',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'instagram');
  assert.equal(result.browserPlan.accountVerification.requiredBeforeLiveSubmit, true);
  assert.equal(result.browserPlan.accountVerification.platform, 'instagram');
  assert.equal(result.browserPlan.accountVerification.verificationTargetKnown, false);
  assert.equal(result.browserPlan.accountVerification.fallbackExpectedIdentity, null);
});

test('root dispatcher routes YouTube dry-run', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const media = path.join(home, 'short.mp4');
  writeFileSync(media, 'fake');
  const result = JSON.parse(run([
    'post', 'youtube',
    '--profile', 'smoke',
    '--post-type', 'short',
    '--text', 'hello',
    '--media', media,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'youtube');
  assert.equal(result.action.payload.postType, 'short');
  assert.equal(result.browserPlan.accountVerification.requiredBeforeLiveSubmit, true);
  assert.equal(result.browserPlan.accountVerification.platform, 'youtube');
});

test('root dispatcher routes X dry-run', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const result = JSON.parse(run([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.platform, 'x');
});

test('root dispatcher lists assets and content from explicit roots', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const assetRoot = path.join(home, 'assets');
  const contentRoot = path.join(home, 'content');
  mkdirSync(path.join(assetRoot, 'release'), { recursive: true });
  mkdirSync(path.join(contentRoot, 'captions'), { recursive: true });
  writeFileSync(path.join(assetRoot, 'release', 'cover.jpg'), 'fake');
  writeFileSync(path.join(assetRoot, 'release', 'short.mp4'), 'fake');
  writeFileSync(path.join(contentRoot, 'captions', 'launch.txt'), 'new drop tonight');

  const assets = JSON.parse(run([
    'assets',
    '--asset-root', assetRoot,
    '--platform', 'instagram',
    '--json',
  ], { SOCIAL_HOME: home }));
  const content = JSON.parse(run([
    'content',
    '--content-root', contentRoot,
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.deepEqual(assets.assets.map((item) => item.relativePath), ['release/cover.jpg', 'release/short.mp4']);
  assert.deepEqual(content.content.map((item) => item.relativePath), ['captions/launch.txt']);
});

test('root dispatcher rejects invalid asset platform filters', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const assetRoot = path.join(home, 'assets');
  mkdirSync(assetRoot, { recursive: true });
  writeFileSync(path.join(assetRoot, 'short.mp4'), 'fake');

  let result;
  try {
    run([
      'assets',
      '--asset-root', assetRoot,
      '--platform', 'instgram',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNSUPPORTED_PLATFORM');
});

test('root dispatcher resolves post text and media from explicit roots', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const assetRoot = path.join(home, 'assets');
  const contentRoot = path.join(home, 'content');
  mkdirSync(assetRoot, { recursive: true });
  mkdirSync(contentRoot, { recursive: true });
  const media = path.join(assetRoot, 'cover.jpg');
  const caption = path.join(contentRoot, 'caption.txt');
  writeFileSync(media, 'fake');
  writeFileSync(caption, 'new drop tonight');
  run([
    'profile', 'add', 'instagram',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], { SOCIAL_HOME: home });

  const result = JSON.parse(run([
    'post', 'instagram',
    '--profile', 'artist01',
    '--text-file', 'caption.txt',
    '--media', 'cover.jpg',
    '--content-root', contentRoot,
    '--asset-root', assetRoot,
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.action.payload.text, 'new drop tonight');
  assert.deepEqual(result.action.payload.media, [media]);
  assert.equal(result.action.contentContext.assetRoot, assetRoot);
  assert.equal(result.action.contentContext.contentRoot, contentRoot);
  assert.equal(result.action.contentContext.textSource.path, caption);
});

test('root dispatcher rejects absolute media outside explicit asset root', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const assetRoot = path.join(home, 'assets');
  const outsideRoot = path.join(home, 'outside');
  mkdirSync(assetRoot, { recursive: true });
  mkdirSync(outsideRoot, { recursive: true });
  const media = path.join(outsideRoot, 'cover.jpg');
  writeFileSync(media, 'fake');
  run([
    'profile', 'add', 'instagram',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], { SOCIAL_HOME: home });

  let result;
  try {
    run([
      'post', 'instagram',
      '--profile', 'artist01',
      '--text', 'new drop tonight',
      '--media', media,
      '--asset-root', assetRoot,
      '--dry-run',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ASSET_PATH_OUTSIDE_ROOT');
});

test('root dispatcher reports missing content files with typed errors', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const assetRoot = path.join(home, 'assets');
  const contentRoot = path.join(home, 'content');
  mkdirSync(assetRoot, { recursive: true });
  mkdirSync(contentRoot, { recursive: true });
  writeFileSync(path.join(assetRoot, 'cover.jpg'), 'fake');
  run([
    'profile', 'add', 'instagram',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], { SOCIAL_HOME: home });

  let result;
  try {
    run([
      'post', 'instagram',
      '--profile', 'artist01',
      '--text-file', 'missing.txt',
      '--media', 'cover.jpg',
      '--content-root', contentRoot,
      '--asset-root', assetRoot,
      '--dry-run',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONTENT_FILE_NOT_FOUND');
});

test('root dispatcher does not allow smoke profile for live actions', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  let result;
  try {
    run([
      'post', 'x',
      '--profile', 'smoke',
      '--text', 'hello',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROFILE_NOT_FOUND');
});

test('live actions require a real account verification target', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  run(['profile', 'add', 'x', '--profile', 'artist01', '--json'], { SOCIAL_HOME: home });

  let result;
  try {
    run([
      'post', 'x',
      '--profile', 'artist01',
      '--text', 'hello',
      '--confirm', 'yes',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCOUNT_VERIFICATION_REQUIRED');
});

test('autorun policy does not bypass explicit live confirmation', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--confirm-policy', 'autorun',
    '--json',
  ], { SOCIAL_HOME: home });

  let result;
  try {
    run([
      'post', 'x',
      '--profile', 'artist01',
      '--text', 'hello',
      '--autorun',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
});

test('profile lock fails fast for concurrent actions', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const action = {
    actionId: 'act_lock',
    platform: 'x',
    profile: 'artist01',
    verb: 'post',
    payload: { text: 'hello' },
    options: {},
  };

  const release = acquireProfileLock({ action, socialHome: home });
  try {
    assert.throws(
      () => acquireProfileLock({ action, socialHome: home }),
      /already running/
    );
  } finally {
    release();
  }
});

test('stale profile locks are recovered', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const lockDir = path.join(home, 'locks');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(path.join(lockDir, 'x-artist01.lock'), JSON.stringify({
    actionId: 'old',
    platform: 'x',
    profile: 'artist01',
    verb: 'post',
    pid: 99999999,
    startedAt: '2000-01-01T00:00:00.000Z',
  }));
  const action = {
    actionId: 'act_lock',
    platform: 'x',
    profile: 'artist01',
    verb: 'post',
    payload: { text: 'hello' },
    options: {},
  };

  const release = acquireProfileLock({ action, socialHome: home });
  release();
});

test('completed live actions are deduped by idempotency key', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const action = {
    actionId: 'act_first',
    platform: 'x',
    profile: 'artist01',
    verb: 'post',
    payload: { text: 'hello' },
    options: { idempotencyKey: 'post-once' },
  };

  recordCompletedAction({
    action,
    socialHome: home,
    result: { ok: true },
    command: 'post.x',
  });

  const duplicate = findCompletedAction({ action, socialHome: home });
  assert.equal(duplicate.actionId, 'act_first');

  const result = duplicateActionResult(
    { ...action, actionId: 'act_second' },
    duplicate,
    'post.x'
  );
  assert.equal(result.status, 'duplicate');
  assert.equal(result.duplicateOf, 'act_first');
});

test('completed live actions are not deduped by payload alone', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const action = {
    actionId: 'act_first',
    platform: 'x',
    profile: 'artist01',
    verb: 'post',
    payload: { text: 'hello' },
    options: {},
  };

  recordCompletedAction({
    action,
    socialHome: home,
    result: { ok: true },
    command: 'post.x',
  });

  assert.equal(findCompletedAction({ action: { ...action, actionId: 'act_second' }, socialHome: home }), null);
});
