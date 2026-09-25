import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitVideoProjectContent } from './project-storage.mjs';

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'video-project-commit-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const baseline = '{ "title": "baseline" }\n';

function startWriter(path, expectedContent, content, ready, barrier) {
  const source = `
    import { commitVideoProjectContent } from ${JSON.stringify(new URL('./project-storage.mjs', import.meta.url).href)};
    import { existsSync, writeFileSync } from 'node:fs';
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!existsSync(${JSON.stringify(barrier)})) await new Promise(resolve => setTimeout(resolve, 5));
    try { commitVideoProjectContent(${JSON.stringify(path)}, ${JSON.stringify(content)}, { expectedContent: ${JSON.stringify(expectedContent)} }); console.log('saved'); }
    catch (error) { console.log(error.code); process.exitCode = 1; }
  `;
  const child = spawn('node', ['--input-type=module', '-e', source]);
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout: stdout.trim(), stderr }));
  });
  return { child, done };
}

describe('cross-process video project commits', () => {
  test.each([false, true])('exactly one concurrent writer wins, symlink alias=%s', async (alias) => {
    const path = join(root, 'video.runner-video.json');
    writeFileSync(path, baseline);
    const secondPath = alias ? join(root, 'alias.runner-video.json') : path;
    if (alias) symlinkSync(path, secondPath);
    const barrier = join(root, 'go');
    const firstReady = join(root, 'first-ready'), secondReady = join(root, 'second-ready');
    const first = startWriter(path, baseline, '{"title":"first"}', firstReady, barrier);
    const second = startWriter(secondPath, baseline, '{"title":"second"}', secondReady, barrier);
    try {
      const deadline = Date.now() + 5000;
      while ((!existsSync(firstReady) || !existsSync(secondReady)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
      expect(existsSync(firstReady) && existsSync(secondReady)).toBe(true);
      writeFileSync(barrier, 'go');
      const results = await Promise.all([first.done, second.done]);
      expect(results.filter((result) => result.code === 0)).toHaveLength(1);
      expect(results.find((result) => result.code !== 0).stdout).toMatch(/^VIDEO_PROJECT_(CONFLICT|BUSY)$/);
      const winner = results[0].code === 0 ? 'first' : 'second';
      expect(JSON.parse(readFileSync(path, 'utf8')).title).toBe(winner);
      expect(readFileSync(path + '.bak', 'utf8')).toBe(baseline);
      expect(existsSync(path + '.write-lock')).toBe(false);
      if (alias) expect(readFileSync(secondPath, 'utf8')).toBe(readFileSync(path, 'utf8'));
    } finally { first.child.kill(); second.child.kill(); }
  });

  test('conflict preserves project, backup and releases its lock', () => {
    const path = join(root, 'project.json');
    writeFileSync(path, '{"title":"newer"}'); writeFileSync(path + '.bak', baseline);
    expect(() => commitVideoProjectContent(path, '{"title":"stale"}', { expectedContent: baseline })).toThrow(/changed since it was read/);
    expect(readFileSync(path, 'utf8')).toBe('{"title":"newer"}');
    expect(readFileSync(path + '.bak', 'utf8')).toBe(baseline);
    expect(existsSync(path + '.write-lock')).toBe(false);
  });

  test('recovery cannot overwrite a newer save or its last-good backup', () => {
    const path = join(root, 'project.json');
    writeFileSync(path, '{"title":"newer"}'); writeFileSync(path + '.bak', baseline);
    expect(() => commitVideoProjectContent(path, baseline, { expectedContent: 'broken {{{', backupExisting: false })).toThrow(/changed since it was read/);
    expect(readFileSync(path, 'utf8')).toBe('{"title":"newer"}');
    expect(readFileSync(path + '.bak', 'utf8')).toBe(baseline);
  });

  test('recovering corrupt content retains good backup and archives corrupt bytes', () => {
    const path = join(root, 'project.json');
    writeFileSync(path, 'broken {{{'); writeFileSync(path + '.bak', baseline);
    commitVideoProjectContent(path, '{"title":"repaired"}', { expectedContent: 'broken {{{' });
    expect(readFileSync(path + '.bak', 'utf8')).toBe(baseline);
    expect(readdirSync(root).some((name) => name.endsWith('.corrupt.bak'))).toBe(true);
  });

  test('failed backup write cleans temporary files and lock without changing live file', () => {
    const path = join(root, 'project.json');
    writeFileSync(path, baseline); mkdirSync(path + '.bak');
    expect(() => commitVideoProjectContent(path, '{"title":"new"}', { expectedContent: baseline })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(baseline);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp') || name.endsWith('.write-lock'))).toHaveLength(0);
  });

  test('a crashed lock owner fails closed without touching lock or content', () => {
    const path = join(root, 'project.json');
    writeFileSync(path, baseline); writeFileSync(path + '.write-lock', '{"pid":99999999,"createdAt":"2000-01-01"}');
    expect(() => commitVideoProjectContent(path, '{"title":"new"}', { expectedContent: baseline })).toThrow(/owner crashed/);
    expect(readFileSync(path, 'utf8')).toBe(baseline);
    expect(existsSync(path + '.write-lock')).toBe(true);
  });

  test('rejects hardlinked projects before modifying either name', () => {
    const path = join(root, 'project.json'), alias = join(root, 'alias.json');
    writeFileSync(path, baseline); linkSync(path, alias);
    expect(() => commitVideoProjectContent(alias, '{"title":"new"}', { expectedContent: baseline })).toThrow(/hard link/);
    expect(readFileSync(path, 'utf8')).toBe(baseline);
    expect(readFileSync(alias, 'utf8')).toBe(baseline);
  });
});
