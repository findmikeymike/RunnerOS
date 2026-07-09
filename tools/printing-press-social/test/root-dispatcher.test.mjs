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
  assert.ok(registry.platforms.spotify);
  assert.ok(registry.commands.some((command) => command.verb === 'snapshot' && command.platform === 'spotify'));
  assert.ok(registry.commands.some((command) => command.verb === 'playlist' && command.platform === 'spotify'));
  assert.ok(registry.commands.some((command) => command.verb === 'doctor'));
  assert.ok(registry.commands.some((command) => command.verb === 'catalog'));
  assert.ok(registry.commands.some((command) => command.verb === 'execute'));
});

test('root doctor reports install and platform health', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const result = JSON.parse(run(['doctor', '--json'], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.command, 'doctor');
  assert.equal(result.model, 'CLI-Anything');
  assert.equal(result.browserEngine, 'runner-cdp');
  assert.equal(result.checks.find((check) => check.name === 'browser-engine')?.mode, 'delegated');
  assert.equal(result.platforms.length, 5);
  assert.ok(result.platforms.some((platform) => platform.platform === 'spotify'));
  assert.deepEqual(result.summary, {
    totalProfiles: 0,
    readyProfiles: 0,
    loginNeeded: 0,
    unverified: 0,
    wrongAccount: 0,
    failed: 0,
  });
  assert.ok(result.platforms.find((platform) => platform.platform === 'x'));
  assert.ok(result.checks.find((check) => check.name === 'browser-engine'));
});

test('root doctor surfaces Settings-ready profile status fields', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const env = { SOCIAL_HOME: home };
  run(['profile', 'add', 'x', '--profile', 'artist01', '--handle', '@artist01', '--json'], env);
  mkdirSync(path.join(home, 'sessions', 'x', 'artist01'), { recursive: true });

  const result = JSON.parse(run(['doctor', '--json'], env));
  const profile = result.platforms.find((item) => item.platform === 'x').profiles[0];
  assert.equal(result.summary.totalProfiles, 1);
  assert.equal(result.summary.unverified, 1);
  assert.equal(profile.profileStatus, 'session_exists_unverified');
  assert.equal(profile.severity, 'warning');
  assert.equal(profile.nextAction, 'verify_session');
  assert.equal(profile.accountHandle, '@artist01');
  assert.equal(profile.ready, false);
  assert.equal(profile.localSessionExists, true);
  assert.equal(profile.evidence.type, 'local_session');
});

test('root catalog groups account sets without exposing local session paths or secrets', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const env = { SOCIAL_HOME: home };
  run(['profile', 'add', 'instagram', '--profile', 'mikey-ig', '--account-group', 'MikeyReal', '--handle', '@mikeyreal', '--json'], env);
  run(['profile', 'add', 'tiktok', '--profile', 'mikey-tt', '--account-group', 'MikeyReal', '--handle', '@mikeyreal', '--json'], env);
  run(['profile', 'add', 'youtube', '--profile', 'music-fan-yt', '--account-group', 'Music Fan Page', '--account-url', 'https://www.youtube.com/@musicfan', '--json'], env);

  const result = JSON.parse(run(['catalog', '--json'], env));
  const serialized = JSON.stringify(result);
  const mikeyReal = result.accountSets.find((set) => set.name === 'MikeyReal');
  const musicFan = result.accountSets.find((set) => set.name === 'Music Fan Page');

  assert.equal(result.ok, true);
  assert.equal(result.command, 'catalog');
  assert.equal(result.noSecrets, true);
  assert.equal(result.summary.accountSets, 2);
  assert.deepEqual(mikeyReal.platforms, {
    instagram: 'instagram/mikey-ig',
    tiktok: 'tiktok/mikey-tt',
  });
  assert.deepEqual(musicFan.platforms, {
    youtube: 'youtube/music-fan-yt',
  });
  assert.equal(result.profiles.find((profile) => profile.ref === 'instagram/mikey-ig').browserSession.partition, 'persist:social-instagram-mikey-ig');
  assert.ok(!serialized.includes(home));
  assert.ok(!serialized.includes('sessionPath'));
  assert.ok(!serialized.match(/cookie|token|password|2fa/i));
});

test('root dispatcher routes normalized profile lifecycle commands', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const env = { SOCIAL_HOME: home };
  const added = JSON.parse(run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--account-group', 'MikeyReal',
    '--handle', '@artist01',
    '--json',
  ], env));
  assert.equal(added.ok, true);
  assert.equal(added.data.accountGroup, 'MikeyReal');
  assert.equal(added.data.accountHandle, '@artist01');

  const updated = JSON.parse(run([
    'profile', 'update', 'x',
    '--profile', 'artist01',
    '--account-group', 'Music Fan Page',
    '--account-url', 'https://x.com/artist01',
    '--json',
  ], env));
  assert.equal(updated.command, 'profile.update');
  assert.equal(updated.data.accountGroup, 'Music Fan Page');
  assert.equal(updated.data.accountUrl, 'https://x.com/artist01');

  const cleared = JSON.parse(run([
    'profile', 'update', 'x',
    '--profile', 'artist01',
    '--clear-account-group',
    '--clear-handle',
    '--clear-account-url',
    '--json',
  ], env));
  assert.equal(cleared.command, 'profile.update');
  assert.equal(cleared.data.accountGroup, null);
  assert.equal(cleared.data.accountHandle, null);
  assert.equal(cleared.data.accountUrl, null);

  const restored = JSON.parse(run([
    'profile', 'update', 'x',
    '--profile', 'artist01',
    '--account-group', 'MikeyReal',
    '--handle', '@artist01',
    '--account-url', 'https://x.com/artist01',
    '--json',
  ], env));
  assert.equal(restored.data.accountGroup, 'MikeyReal');
  assert.equal(restored.data.accountHandle, '@artist01');
  assert.equal(restored.data.accountUrl, 'https://x.com/artist01');

  const status = JSON.parse(run(['profile', 'status', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(status.profileId, 'artist01');
  assert.equal(status.accountHandle, '@artist01');
  assert.equal(status.accountUrl, 'https://x.com/artist01');
  assert.equal(status.accountGroup, 'MikeyReal');
  assert.equal(status.sessionPath, path.join(home, 'sessions', 'x', 'artist01'));
  assert.equal(status.sessionExists, false);
  assert.equal(status.profileStatus, 'login_needed');
  assert.equal(status.severity, 'warning');
  assert.equal(status.nextAction, 'open_login');
  assert.equal(status.lastCheckedAt, null);
  assert.equal(status.evidence.type, 'none');
  assert.equal(status.liveChecked, false);
  assert.equal(status.loggedIn, null);
  assert.equal(status.matchesExpected, null);

  const liveStatus = JSON.parse(run(['profile', 'status', 'x', '--profile', 'artist01', '--live', '--json'], env));
  assert.equal(liveStatus.ok, true);
  assert.equal(liveStatus.ready, false);
  assert.equal(liveStatus.profileStatus, 'login_needed');
  assert.equal(liveStatus.severity, 'warning');
  assert.equal(liveStatus.nextAction, 'open_login');
  assert.equal(liveStatus.evidence.type, 'delegated_browser_plan');
  assert.equal(liveStatus.evidence.code, 'RUNNER_CDP_DELEGATED');
  assert.equal(liveStatus.live.delegated, true);
  assert.equal(liveStatus.live.code, 'RUNNER_CDP_DELEGATED');

  const login = JSON.parse(run(['profile', 'login', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(login.ok, true);
  assert.equal(login.status, 'delegated');
  assert.equal(login.code, 'RUNNER_CDP_DELEGATED');

  mkdirSync(status.sessionPath, { recursive: true });
  const unverified = JSON.parse(run(['profile', 'status', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(unverified.ready, false);
  assert.equal(unverified.localSessionExists, true);
  assert.equal(unverified.profileStatus, 'session_exists_unverified');
  assert.equal(unverified.severity, 'warning');
  assert.equal(unverified.nextAction, 'verify_session');
  assert.equal(unverified.evidence.type, 'local_session');

  const verificationFile = path.join(home, 'verification.json');
  writeFileSync(verificationFile, JSON.stringify({
    platform: 'x',
    profile: 'artist01',
    loggedIn: true,
    visibleIdentity: { handle: '@artist01' },
  }));
  const verified = JSON.parse(run([
    'profile', 'status', 'x',
    '--profile', 'artist01',
    '--live',
    '--verification-result', verificationFile,
    '--json',
  ], env));
  assert.equal(verified.ready, true);
  assert.equal(verified.profileStatus, 'verified');
  assert.equal(verified.evidence.type, 'live_check');
  assert.equal(verified.evidence.visibleIdentity.handle, '@artist01');

  writeFileSync(verificationFile, JSON.stringify({
    platform: 'x',
    profile: 'artist01',
    loggedIn: true,
    visibleIdentity: { handle: '@other-account' },
  }));
  const wrongAccount = JSON.parse(run([
    'profile', 'status', 'x',
    '--profile', 'artist01',
    '--live',
    '--verification-result', verificationFile,
    '--json',
  ], env));
  assert.equal(wrongAccount.ready, false);
  assert.equal(wrongAccount.profileStatus, 'wrong_account');
  assert.equal(wrongAccount.severity, 'error');
  assert.equal(wrongAccount.matchesExpected, false);
  assert.equal(wrongAccount.evidence.visibleIdentity.handle, '@other-account');

  writeFileSync(verificationFile, JSON.stringify({
    platform: 'x',
    profile: 'artist01',
    loggedIn: true,
    matchesExpected: true,
    visibleIdentity: { handle: '@other-account' },
  }));
  const selfAttestedWrongAccount = JSON.parse(run([
    'profile', 'status', 'x',
    '--profile', 'artist01',
    '--live',
    '--verification-result', verificationFile,
    '--json',
  ], env));
  assert.equal(selfAttestedWrongAccount.ready, false);
  assert.equal(selfAttestedWrongAccount.profileStatus, 'wrong_account');
  assert.equal(selfAttestedWrongAccount.matchesExpected, false);

  writeFileSync(verificationFile, JSON.stringify({
    platform: 'x',
    profile: 'artist01',
    loggedIn: true,
    visibleIdentity: { rawText: 'Current profile URL https://x.com/artist010' },
  }));
  const partialRawTextMatch = JSON.parse(run([
    'profile', 'status', 'x',
    '--profile', 'artist01',
    '--live',
    '--verification-result', verificationFile,
    '--json',
  ], env));
  assert.equal(partialRawTextMatch.ready, false);
  assert.equal(partialRawTextMatch.profileStatus, 'wrong_account');

  const missingTargetHome = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  run(['profile', 'add', 'x', '--profile', 'noid', '--json'], { SOCIAL_HOME: missingTargetHome });
  mkdirSync(path.join(missingTargetHome, 'sessions', 'x', 'noid'), { recursive: true });
  writeFileSync(path.join(missingTargetHome, 'verification.json'), JSON.stringify({
    platform: 'x',
    profile: 'noid',
    loggedIn: true,
    matchesExpected: true,
    visibleIdentity: { handle: '@somebody' },
  }));
  const missingTarget = JSON.parse(run([
    'profile', 'status', 'x',
    '--profile', 'noid',
    '--live',
    '--verification-result', path.join(missingTargetHome, 'verification.json'),
    '--json',
  ], { SOCIAL_HOME: missingTargetHome }));
  assert.equal(missingTarget.ready, false);
  assert.equal(missingTarget.profileStatus, 'wrong_account');
  assert.equal(missingTarget.matchesExpected, false);

  const deleted = JSON.parse(run(['profile', 'delete', 'x', '--profile', 'artist01', '--json'], env));
  assert.equal(deleted.ok, true);
  assert.equal(deleted.deleted, true);
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
  assert.deepEqual(result.browserPlan.browserSession, {
    kind: 'runneros-electron-partition',
    platform: 'x',
    profile: 'smoke',
    instanceId: 'social-x-smoke',
    partition: 'persist:social-x-smoke',
  });
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

test('root execute requires explicit approval', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const actionFile = path.join(home, 'action.json');
  writeFileSync(actionFile, JSON.stringify({
    action: {
      actionId: 'act_execute_confirm',
      verb: 'post',
      platform: 'x',
      profile: 'artist01',
      mode: 'browser',
      payload: { text: 'hello', media: [], postType: 'post' },
      options: { dryRun: true, idempotencyKey: null, headed: false },
    },
  }));

  let result;
  try {
    run(['execute', '--action-file', actionFile, '--json'], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRM_REQUIRED');
});

test('root execute rejects non-dry-run action files', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const actionFile = path.join(home, 'action.json');
  writeFileSync(actionFile, JSON.stringify({
    ok: true,
    status: 'succeeded',
    actionId: 'act_execute_live',
    platform: 'x',
    profile: 'artist01',
    action: {
      actionId: 'act_execute_live',
      verb: 'post',
      platform: 'x',
      profile: 'artist01',
      mode: 'browser',
      payload: { text: 'hello', media: [], postType: 'post' },
      options: { dryRun: false, idempotencyKey: null, headed: false },
    },
    browserPlan: {
      accountVerification: { verificationTargetKnown: true },
    },
  }));

  let result;
  try {
    run(['execute', '--action-file', actionFile, '--confirm', 'yes', '--json'], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACTION_NOT_DRY_RUN');
});

test('root execute rejects bare forged action files', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const actionFile = path.join(home, 'action.json');
  writeFileSync(actionFile, JSON.stringify({
    actionId: 'act_forged',
    verb: 'post',
    platform: 'x',
    profile: 'ghost',
    mode: 'browser',
    payload: { text: 'forged', media: [], postType: 'post' },
    options: { dryRun: true, idempotencyKey: null, headed: false },
  }));

  let result;
  try {
    run(['execute', '--action-file', actionFile, '--confirm', 'yes', '--json'], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_ACTION_FILE');
});

test('root execute checks expected action id before replay', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const actionFile = path.join(home, 'action.json');
  writeFileSync(actionFile, JSON.stringify({
    ok: true,
    status: 'dry_run',
    actionId: 'act_execute_actual',
    platform: 'x',
    profile: 'artist01',
    action: {
      actionId: 'act_execute_actual',
      verb: 'post',
      platform: 'x',
      profile: 'artist01',
      mode: 'browser',
      payload: { text: 'hello', media: [], postType: 'post' },
      options: { dryRun: true, idempotencyKey: null, headed: false },
    },
    browserPlan: {
      accountVerification: { verificationTargetKnown: true },
    },
  }));

  let result;
  try {
    run([
      'execute',
      '--action-file', actionFile,
      '--expected-action-id', 'act_execute_expected',
      '--confirm', 'yes',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACTION_ID_MISMATCH');
});

test('root execute requires expected action id before replay', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const actionFile = path.join(home, 'dry-run.json');
  writeFileSync(actionFile, JSON.stringify({
    ok: true,
    status: 'dry_run',
    actionId: 'act_execute_expected',
    platform: 'x',
    profile: 'artist01',
    action: {
      actionId: 'act_execute_expected',
      verb: 'post',
      platform: 'x',
      profile: 'artist01',
      mode: 'browser',
      payload: { text: 'hello', media: [], postType: 'post' },
      options: { dryRun: true, idempotencyKey: null, headed: false },
    },
    browserPlan: {
      sessionPath: 'x',
      accountVerification: {
        requiredBeforeLiveSubmit: true,
        verificationTargetKnown: true,
        platform: 'x',
        profile: 'artist01',
        expectedHandle: '@artist01',
        expectedAccountUrl: null,
        fallbackExpectedIdentity: '@artist01',
        evidenceRequired: ['visible account identity'],
      },
      steps: [],
    },
  }));

  let result;
  try {
    run([
      'execute',
      '--action-file', actionFile,
      '--confirm', 'yes',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'EXPECTED_ACTION_ID_REQUIRED');
});

test('root execute rejects dry-run results without account verification target', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  const dryRun = JSON.parse(run([
    'post', 'x',
    '--profile', 'smoke',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));
  const actionFile = path.join(home, 'dry-run.json');
  writeFileSync(actionFile, JSON.stringify(dryRun));

  let result;
  try {
    run([
      'execute',
      '--action-file', actionFile,
      '--expected-action-id', dryRun.actionId,
      '--confirm', 'yes',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCOUNT_VERIFICATION_REQUIRED');
});

test('root execute returns delegated runner-cdp result for approved dry-run result', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], { SOCIAL_HOME: home });

  const dryRun = JSON.parse(run([
    'post', 'x',
    '--profile', 'artist01',
    '--text', 'hello',
    '--idempotency-key', 'execute-once',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));
  const actionFile = path.join(home, 'dry-run.json');
  writeFileSync(actionFile, JSON.stringify(dryRun));

  const result = JSON.parse(run([
    'execute',
    '--action-file', actionFile,
    '--expected-action-id', dryRun.actionId,
    '--confirm', 'yes',
    '--json',
  ], { SOCIAL_HOME: home }));

  assert.equal(result.ok, true);
  assert.equal(result.status, 'delegated');
  assert.equal(result.actionId, dryRun.actionId);
  assert.equal(result.code, 'RUNNER_CDP_DELEGATED');
  assert.deepEqual(result.browserPlan.browserSession, {
    kind: 'runneros-electron-partition',
    platform: 'x',
    profile: 'artist01',
    instanceId: 'social-x-artist01',
    partition: 'persist:social-x-artist01',
  });
  assert.match(result.next.join(' '), /browserPlan\.browserSession/);
  assert.match(result.next.join(' '), /submit when the visible account and draft match/);
  assert.doesNotMatch(result.next.join(' '), /pause before final submit/i);
});

test('root execute rejects dry-runs when current profile verification target changed', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], { SOCIAL_HOME: home });

  const dryRun = JSON.parse(run([
    'post', 'x',
    '--profile', 'artist01',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));
  run([
    'profile', 'update', 'x',
    '--profile', 'artist01',
    '--handle', '@artist02',
    '--json',
  ], { SOCIAL_HOME: home });

  const actionFile = path.join(home, 'dry-run.json');
  writeFileSync(actionFile, JSON.stringify(dryRun));

  let result;
  try {
    run([
      'execute',
      '--action-file', actionFile,
      '--expected-action-id', dryRun.actionId,
      '--confirm', 'yes',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROFILE_VERIFICATION_MISMATCH');
});

test('root execute rejects dry-runs with tampered browser session identity', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'social-root-'));
  run([
    'profile', 'add', 'x',
    '--profile', 'artist01',
    '--handle', '@artist01',
    '--json',
  ], { SOCIAL_HOME: home });

  const dryRun = JSON.parse(run([
    'post', 'x',
    '--profile', 'artist01',
    '--text', 'hello',
    '--dry-run',
    '--json',
  ], { SOCIAL_HOME: home }));
  dryRun.browserPlan.browserSession.partition = 'persist:social-x-other';
  const actionFile = path.join(home, 'dry-run.json');
  writeFileSync(actionFile, JSON.stringify(dryRun));

  let result;
  try {
    run([
      'execute',
      '--action-file', actionFile,
      '--expected-action-id', dryRun.actionId,
      '--confirm', 'yes',
      '--json',
    ], { SOCIAL_HOME: home });
  } catch (error) {
    result = JSON.parse(error.stdout.toString());
  }

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROFILE_BROWSER_SESSION_MISMATCH');
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

test('completed live actions are deduped by payload digest when no idempotency key is supplied', () => {
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

  const duplicate = findCompletedAction({ action: { ...action, actionId: 'act_second' }, socialHome: home });
  assert.equal(duplicate.actionId, 'act_first');
  assert.equal(duplicate.idempotencyKey, null);
  assert.ok(duplicate.payloadDigest);
});

test('completed live actions are not deduped when no idempotency key is supplied and payload changes', () => {
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

  assert.equal(findCompletedAction({
    action: { ...action, actionId: 'act_second', payload: { text: 'hello again' } },
    socialHome: home,
  }), null);
});
