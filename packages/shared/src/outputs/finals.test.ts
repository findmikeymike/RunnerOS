import { afterEach, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOutputBundle } from './storage';
import { promoteOutputToFinal, readOutputFinalsRegistry, removeOutputFromFinal } from './finals';
import { getContextDocFile } from '../workspace-context/storage';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'finals-integrity-')); roots.push(root);
  const output = createOutputBundle(root, { workspaceId: 'ws', title: 'Saved text', kind: 'document', content: 'Artist-owned content', origin: { source: 'session', sessionId: 'session' } });
  const path = getContextDocFile(root, 'finals');
  return { root, output, path };
}

for (const [label, bytes] of [
  ['malformed frontmatter', '---\nname: [unterminated\n---\n{"schemaVersion":1,"finals":[]}'],
  ['missing required name', '---\ndescription: Saved Finals\n---\n{"schemaVersion":1,"finals":[]}'],
  ['invalid JSON body', '---\nname: Finals\n---\n{ broken body'],
]) {
  test(`${label} is preserved on promotion and removal`, () => {
    const { root, output, path } = fixture();
    fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, bytes!);
    expect(() => readOutputFinalsRegistry(root, { strict: true })).toThrow('Finals registry is invalid');
    expect(() => promoteOutputToFinal(root, output, { outputId: output.id, scope: 'hq', slot: 'cover' })).toThrow('Finals registry is invalid');
    expect(() => removeOutputFromFinal(root, { outputId: output.id })).toThrow('Finals registry is invalid');
    expect(fs.readFileSync(path, 'utf8')).toBe(bytes!);
    // Browsing remains tolerant; only mutation/preservation callers request strict reads.
    expect(readOutputFinalsRegistry(root).finals).toEqual([]);
  });
}

test('absent first-use registry initializes and healthy later promotion appends', () => {
  const { root, output } = fixture();
  expect(readOutputFinalsRegistry(root, { strict: true }).finals).toEqual([]);
  const first = promoteOutputToFinal(root, output, { outputId: output.id, scope: 'hq', slot: 'cover' });
  const second = promoteOutputToFinal(root, output, { outputId: output.id, scope: 'hq', slot: 'press' });
  expect(readOutputFinalsRegistry(root, { strict: true }).finals.map(final => final.id)).toEqual([first.id, second.id]);
  expect(removeOutputFromFinal(root, { outputId: output.id, slot: 'cover' })).toBe(1);
  expect(readOutputFinalsRegistry(root, { strict: true }).finals.map(final => final.id)).toEqual([second.id]);
});

for (const parent of [false, true]) {
  test(`dangling ${parent ? 'parent' : 'file'} link is not mistaken for an absent registry`, () => {
    const { root, output, path } = fixture();
    const linkedPath = parent ? dirname(path) : path;
    fs.mkdirSync(dirname(linkedPath), { recursive: true });
    const missingTarget = join(root, 'missing-target');
    fs.symlinkSync(missingTarget, linkedPath);
    expect(() => readOutputFinalsRegistry(root, { strict: true })).toThrow('Finals registry is invalid');
    expect(() => promoteOutputToFinal(root, output, { outputId: output.id, scope: 'hq', slot: 'cover' })).toThrow('Finals registry is invalid');
    expect(() => removeOutputFromFinal(root, { outputId: output.id })).toThrow('Finals registry is invalid');
    expect(fs.readlinkSync(linkedPath)).toBe(missingTarget);
    expect(fs.existsSync(missingTarget)).toBe(false);
  });
}

test('read errors preserve a present registry instead of replacing it with empty data', () => {
  const { root, output, path } = fixture();
  promoteOutputToFinal(root, output, { outputId: output.id, scope: 'hq', slot: 'cover' });
  const bytes = fs.readFileSync(path, 'utf8');
  const realRead = fs.readFileSync;
  const read = spyOn(fs, 'readFileSync').mockImplementation(((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) => {
    if (String(file) === path) throw Object.assign(new Error('injected read failure'), { code: 'EACCES' });
    return Reflect.apply(realRead, fs, [file, ...args]);
  }) as typeof fs.readFileSync);
  try {
    expect(() => promoteOutputToFinal(root, output, { outputId: output.id, scope: 'hq', slot: 'press' })).toThrow('Finals registry is invalid');
    expect(() => removeOutputFromFinal(root, { outputId: output.id })).toThrow('Finals registry is invalid');
  } finally { read.mockRestore(); }
  expect(fs.readFileSync(path, 'utf8')).toBe(bytes);
});
