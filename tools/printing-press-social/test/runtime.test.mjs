import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireProfileLock,
  releaseProfileLock,
  runLiveAction,
} from '../src/runtime.mjs';

function tempHome() {
  return mkdtempSync(path.join(tmpdir(), 'social-runtime-'));
}

function action(overrides = {}) {
  return {
    actionId: 'act_test',
    platform: 'instagram',
    profile: 'artist01',
    verb: 'post',
    payload: { text: 'hello', media: [] },
    options: {},
    ...overrides,
  };
}

test('per-profile lock is exclusive and reclaimable after release', () => {
  const home = tempHome();
  const act = action();
  const lock = acquireProfileLock(home, act);
  assert.ok(existsSync(lock));
  assert.throws(() => acquireProfileLock(home, act), /PROFILE_LOCKED|busy/);
  releaseProfileLock(lock);
  const relock = acquireProfileLock(home, act);
  assert.ok(existsSync(relock));
  releaseProfileLock(relock);
});

test('locks are scoped per platform+profile, not global', () => {
  const home = tempHome();
  const a = acquireProfileLock(home, action({ profile: 'artist01' }));
  const b = acquireProfileLock(home, action({ profile: 'artist02' }));
  assert.ok(existsSync(a) && existsSync(b));
  releaseProfileLock(a);
  releaseProfileLock(b);
});

test('runLiveAction records success then dedupes an identical repeat', async () => {
  const home = tempHome();
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true, artifacts: [] }; };

  const first = await runLiveAction({ homeDir: home, action: action(), flags: {}, run });
  assert.equal(first.ok, true);
  assert.notEqual(first.status, 'duplicate');
  assert.equal(calls, 1);

  const second = await runLiveAction({ homeDir: home, action: action(), flags: {}, run });
  assert.equal(second.status, 'duplicate');
  assert.equal(second.deduped, true);
  assert.equal(calls, 1, 'second identical live action must not execute run()');
});

test('runLiveAction --allow-duplicate forces a repeat', async () => {
  const home = tempHome();
  let calls = 0;
  const run = async () => { calls += 1; return { ok: true, artifacts: [] }; };

  await runLiveAction({ homeDir: home, action: action(), flags: {}, run });
  const forced = await runLiveAction({ homeDir: home, action: action(), flags: { 'allow-duplicate': true }, run });
  assert.notEqual(forced.status, 'duplicate');
  assert.equal(calls, 2);
});

test('runLiveAction does not record or dedupe failed actions', async () => {
  const home = tempHome();
  let calls = 0;
  const run = async () => { calls += 1; return { ok: false, error: 'boom', artifacts: [] }; };

  const first = await runLiveAction({ homeDir: home, action: action(), flags: {}, run });
  assert.equal(first.ok, false);
  const second = await runLiveAction({ homeDir: home, action: action(), flags: {}, run });
  assert.equal(second.ok, false, 'failed action must remain retryable');
  assert.equal(calls, 2);
});

test('runLiveAction releases the lock even when run() throws', async () => {
  const home = tempHome();
  const run = async () => { throw new Error('kaboom'); };
  await assert.rejects(() => runLiveAction({ homeDir: home, action: action(), flags: {}, run }), /kaboom/);
  // Lock dir must be gone so a retry can proceed.
  const locks = path.join(home, 'locks');
  assert.ok(!existsSync(locks) || readdirSync(locks).length === 0);
});
