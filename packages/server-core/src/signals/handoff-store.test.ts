import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { clearSignalHandoff, readSignalHandoff, signalHandoffKey, writeSignalHandoff } from './handoff-store';

let root: string;
const reference = { hqWorkspaceId: 'hq', outputId: 'report', contentHash: 'a'.repeat(64), entryId: 'idea-1' };
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'signals-draft-')); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('persists only a bounded reference with private file permissions, then clears idempotently', () => {
  expect(readSignalHandoff(root)).toBeNull();
  writeSignalHandoff(root, reference);
  expect(readSignalHandoff(root)).toEqual(reference);
  expect(statSync(join(root, 'signal-handoff.json')).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(join(root, 'signal-handoff.json'), 'utf8'))).toEqual({ version: 1, reference });
  clearSignalHandoff(root);
  clearSignalHandoff(root);
  expect(readSignalHandoff(root)).toBeNull();
});

test('reference identity is independent of object key order and changes with every source coordinate', () => {
  expect(signalHandoffKey({ entryId: 'idea-1', contentHash: reference.contentHash, outputId: 'report', hqWorkspaceId: 'hq' })).toBe(signalHandoffKey(reference));
  for (const key of ['hqWorkspaceId', 'outputId', 'contentHash', 'entryId'] as const) {
    expect(signalHandoffKey({ ...reference, [key]: 'different' })).not.toBe(signalHandoffKey(reference));
  }
});

test('rejects malformed writes without losing a previous valid binding', () => {
  writeSignalHandoff(root, reference);
  expect(() => writeSignalHandoff(root, { ...reference, contentHash: 'bad' })).toThrow();
  expect(readSignalHandoff(root)).toEqual(reference);
});

test('damaged, oversized and unsupported files fail closed but remain explicitly discardable', () => {
  for (const data of ['{', 'x'.repeat(5000), JSON.stringify({ version: 2, reference }), JSON.stringify({ version: 1, reference: { ...reference, entryId: '../../other' } })]) {
    writeFileSync(join(root, 'signal-handoff.json'), data);
    expect(() => readSignalHandoff(root)).toThrow('damaged');
    clearSignalHandoff(root);
  }
});

test('never follows a reference-file symlink', () => {
  writeFileSync(join(root, 'other.json'), JSON.stringify({ version: 1, reference }));
  symlinkSync(join(root, 'other.json'), join(root, 'signal-handoff.json'));
  expect(() => readSignalHandoff(root)).toThrow('Cannot read');
  clearSignalHandoff(root);
  expect(readFileSync(join(root, 'other.json'), 'utf8')).toContain('idea-1');
});

test.skipIf(process.platform === 'win32')('rejects FIFO references without waiting for a writer', () => {
  execFileSync('mkfifo', [join(root, 'signal-handoff.json')]);
  expect(() => readSignalHandoff(root)).toThrow('damaged');
  clearSignalHandoff(root);
});
