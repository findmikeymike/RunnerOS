import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDurableTextOutput, type DurableTextOutputInput } from './durable-text.ts';
import { listOutputManifests } from './storage.ts';

let root: string;
const input: DurableTextOutputInput = { id: 'dd38148b-74d8-5fce-9f33-47886ead6297', workspaceId: 'workspace', workflowRunId: 'run', workflowSlug: 'report', stepId: 'final', title: 'My report', kind: 'report', content: '# Saved result', createdAt: '2026-09-09T00:00:00.000Z' };
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'durable-output-test-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const publish = (change: Partial<DurableTextOutputInput> = {}) => ensureDurableTextOutput(root, { ...input, ...change });

describe('durable text output publication', () => {
  test('same title from different runs has distinct stable slugs', () => {
    publish();
    publish({ id: 'dd38148b-74d8-5fce-9f33-47886ead6298', workflowRunId: 'run-two' });
    const outputs = listOutputManifests(root);
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs.map(output => output.slug)).size).toBe(2);
  });
  test('repeated publication reuses exact bundle and leaves no live staging directory', () => {
    expect(publish()).toEqual({ outputId: input.id });
    const manifestPath = join(root, 'outputs', input.id, 'output.json');
    const saved = readFileSync(manifestPath, 'utf8');
    expect(publish()).toEqual({ outputId: input.id });
    expect(readFileSync(manifestPath, 'utf8')).toBe(saved);
    expect(listOutputManifests(root)).toHaveLength(1);
    expect(readdirSync(root).filter(name => name.startsWith('.durable-output-'))).toEqual([]);
  });
  test('changed identity or content cannot overwrite publication', () => {
    publish();
    expect(() => publish({ workflowRunId: 'other' })).toThrow('durable-output-conflict');
    expect(() => publish({ content: 'changed' })).toThrow('durable-output-conflict');
    expect(readFileSync(join(root, 'outputs', input.id, 'content.md'), 'utf8')).toBe(input.content);
  });
  test('modified bytes and incomplete existing bundle fail closed', () => {
    publish();
    const content = join(root, 'outputs', input.id, 'content.md');
    writeFileSync(content, 'user change');
    expect(() => publish()).toThrow('durable-output-conflict');
    rmSync(content);
    expect(() => publish()).toThrow('durable-output-conflict');
  });
  test('orphaned private stage is not discovered or adopted', () => {
    mkdirSync(join(root, '.durable-output-orphan', 'outputs', input.id), { recursive: true });
    expect(listOutputManifests(root)).toEqual([]);
    publish();
    expect(listOutputManifests(root)).toHaveLength(1);
  });
  test('invalid identity and linked output root are rejected', () => {
    expect(() => publish({ id: '../escape' })).toThrow();
    const target = join(root, 'outside'); mkdirSync(target);
    symlinkSync(target, join(root, 'outputs'));
    expect(() => publish()).toThrow('durable-output-symlink');
    expect(readdirSync(target)).toEqual([]);
  });
  test('dangling final link and content link cannot be followed', () => {
    mkdirSync(join(root, 'outputs'));
    const dir = join(root, 'outputs', input.id);
    symlinkSync(join(root, 'absent'), dir);
    expect(() => publish()).toThrow('durable-output-symlink');
    rmSync(dir); publish();
    rmSync(join(dir, 'content.md'));
    symlinkSync(join(root, 'absent'), join(dir, 'content.md'));
    expect(() => publish()).toThrow('durable-output-symlink');
  });
});
