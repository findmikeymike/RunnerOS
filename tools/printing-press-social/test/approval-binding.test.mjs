import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { computeApprovalDigest } from '../src/approval-contract.mjs';

const cli = fileURLToPath(new URL('../src/social.mjs', import.meta.url));
function fixture(platform = 'x') {
  const home = mkdtempSync(join(tmpdir(), 'social-approval-binding-'));
  const call = args => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      env: { ...process.env, SOCIAL_HOME: home }, encoding: 'utf8',
    });
    return { code: result.status, value: JSON.parse(result.stdout || result.stderr) };
  };
  assert.equal(call(['profile', 'add', platform, '--profile', 'artist', '--handle', '@artist']).code, 0);
  const media = join(home, platform === 'instagram' ? 'image.jpg' : 'video.mp4');
  writeFileSync(media, 'approved media');
  const preview = args => {
    const result = call([...args, '--profile', 'artist', '--dry-run']);
    assert.equal(result.code, 0, JSON.stringify(result.value));
    return result.value;
  };
  return {
    call, media, preview,
    execute: (draft, digest = draft.approvalDigest) => {
      const path = join(home, 'approved.json');
      writeFileSync(path, JSON.stringify(draft));
      return call(['execute', '--action-file', path, '--expected-action-id', draft.actionId,
        ...(digest ? ['--expected-action-digest', digest] : []), '--engine', 'runner-cdp', '--confirm', 'yes']);
    },
    dispose: () => rmSync(home, { recursive: true, force: true }),
  };
}

test('all social post previews emit approval digests and fresh approved handoffs work', () => {
  for (const platform of ['x', 'instagram', 'tiktok', 'youtube']) {
    const f = fixture(platform);
    try {
      const draft = f.preview(['post', platform, '--text', 'Approved text', '--media', f.media]);
      assert.match(draft.approvalDigest || '', /^sha256:[a-f0-9]{64}$/);
      const result = f.execute(draft);
      assert.equal(result.code, 0, JSON.stringify(result.value));
      assert.equal(result.value.status, 'delegated');
    } finally { f.dispose(); }
  }
});

test('caption edits cannot reuse the original action id and approval', () => {
  const f = fixture();
  try {
    const draft = f.preview(['post', 'x', '--text', 'Approved text']);
    const digest = draft.approvalDigest;
    draft.action.payload.text = 'Changed after approval';
    assert.notEqual(f.execute(draft, digest).code, 0);
  } finally { f.dispose(); }
});

test('recipient edits cannot reuse a DM approval', () => {
  const f = fixture();
  try {
    const draft = f.preview(['dm', 'x', '--to', 'approved-person', '--text', 'Private text']);
    const digest = draft.approvalDigest;
    draft.action.payload.recipient = 'different-person';
    assert.notEqual(f.execute(draft, digest).code, 0);
  } finally { f.dispose(); }
});

test('same-path media replacement invalidates the approval', () => {
  const f = fixture();
  try {
    const draft = f.preview(['post', 'x', '--text', 'Approved text', '--media', f.media]);
    writeFileSync(f.media, 'replaced media');
    assert.notEqual(f.execute(draft).code, 0);
  } finally { f.dispose(); }
});

test('removing or omitting the independently approved digest cannot bypass binding', () => {
  const f = fixture();
  try {
    const draft = f.preview(['post', 'x', '--text', 'Approved text']);
    assert.notEqual(f.execute(draft, null).code, 0);
    const digest = draft.approvalDigest;
    delete draft.approvalDigest;
    assert.notEqual(f.execute(draft, digest).code, 0);
  } finally { f.dispose(); }
});

test('recomputing an edited file digest cannot replace the independently approved digest', () => {
  const f = fixture();
  try {
    const draft = f.preview(['post', 'x', '--text', 'Approved text']);
    const approvedDigest = draft.approvalDigest;
    draft.action.payload.text = 'Changed after approval';
    draft.approvalDigest = computeApprovalDigest(draft.action, draft.browserPlan);
    const result = f.execute(draft, approvedDigest);
    assert.notEqual(result.code, 0);
    assert.equal(result.value.code, 'ACTION_DIGEST_MISMATCH');
  } finally { f.dispose(); }
});

test('unchanged media bytes remain authorized after a file rewrite', () => {
  const f = fixture();
  try {
    const draft = f.preview(['post', 'x', '--text', 'Approved text', '--media', f.media]);
    writeFileSync(f.media, 'approved media');
    assert.equal(f.execute(draft).code, 0);
  } finally { f.dispose(); }
});

test('media fingerprints cover every chunk and reject a missing attachment', () => {
  const f = fixture();
  try {
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 23);
    bytes[bytes.length - 1] = 99;
    writeFileSync(f.media, bytes);
    const draft = f.preview(['post', 'x', '--text', 'Approved text', '--media', f.media]);
    assert.deepEqual(draft.action.mediaApproval, [{
      path: f.media, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    }]);
    assert.equal(f.execute(draft).code, 0);
    rmSync(f.media);
    const result = f.execute(draft);
    assert.notEqual(result.code, 0);
    assert.equal(result.value.code, 'MEDIA_APPROVAL_UNAVAILABLE');
  } finally { f.dispose(); }
});
