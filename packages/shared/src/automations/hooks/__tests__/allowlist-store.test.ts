import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  addAllowlistEntry,
  computeScriptContentHash,
  findEntry,
  parseCommand,
  pickScriptPath,
  readAllowlist,
  resolveScriptPath,
} from '../allowlist-store.ts';

let workDir: string;
let allowlistPath: string;
let scriptPath: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'rnos-allowlist-'));
  allowlistPath = path.join(workDir, 'allowlist.json');
  scriptPath = path.join(workDir, 'hook.sh');
  await fs.writeFile(scriptPath, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('parseCommand', () => {
  it('splits a simple command into argv', () => {
    expect(parseCommand('echo hello world')).toEqual(['echo', 'hello', 'world']);
  });
  it('honors quoted arguments', () => {
    expect(parseCommand('echo "hello world"')).toEqual(['echo', 'hello world']);
  });
  it('rejects shell operators (pipes, redirects, substitutions)', () => {
    expect(() => parseCommand('echo hi | grep h')).toThrow(/shell operator/);
    expect(() => parseCommand('echo hi > /tmp/x')).toThrow(/shell operator/);
    expect(() => parseCommand('echo $(date)')).toThrow();
  });
  it('rejects empty commands', () => {
    expect(() => parseCommand('   ')).toThrow();
  });
});

describe('pickScriptPath / resolveScriptPath', () => {
  it('prefers a script-extension argument over argv[0]', () => {
    expect(pickScriptPath(['python3', '/abs/hook.py'])).toBe('/abs/hook.py');
    expect(pickScriptPath(['/usr/bin/env', 'bash', './hook.sh'])).toBe('./hook.sh');
  });
  it('falls back to argv[0] when no script extension present', () => {
    expect(pickScriptPath(['mycmd'])).toBe('mycmd');
  });
  it('expands ~ in the picked path', () => {
    const { scriptPath: sp } = resolveScriptPath('python3 ~/hook.py');
    expect(sp).toContain('hook.py');
    expect(sp.startsWith('~')).toBe(false);
  });
});

describe('computeScriptContentHash', () => {
  it('produces the same sha256 for identical contents', async () => {
    const h1 = await computeScriptContentHash(scriptPath);
    const h2 = await computeScriptContentHash(scriptPath);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes when the file body changes', async () => {
    const h1 = await computeScriptContentHash(scriptPath);
    await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho changed\n');
    const h2 = await computeScriptContentHash(scriptPath);
    expect(h1).not.toBe(h2);
  });
});

describe('allowlist round-trip', () => {
  it('writes, reads back, and finds an entry by (event, scriptPath, hash)', async () => {
    const hash = await computeScriptContentHash(scriptPath);
    await addAllowlistEntry(
      {
        event: 'pre_tool_call',
        command: scriptPath,
        scriptPath,
        scriptContentHash: hash,
        registeredAt: new Date().toISOString(),
      },
      allowlistPath
    );
    const all = await readAllowlist(allowlistPath);
    expect(all).toHaveLength(1);
    const hit = await findEntry('pre_tool_call', scriptPath, hash, allowlistPath);
    expect(hit).not.toBeNull();
    const miss = await findEntry('pre_tool_call', scriptPath, 'deadbeef', allowlistPath);
    expect(miss).toBeNull();
  });

  it('replaces a prior entry for the same (event, scriptPath) pair', async () => {
    const hash1 = await computeScriptContentHash(scriptPath);
    await addAllowlistEntry(
      {
        event: 'pre_tool_call',
        command: scriptPath,
        scriptPath,
        scriptContentHash: hash1,
        registeredAt: new Date().toISOString(),
      },
      allowlistPath
    );
    await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho v2\n');
    const hash2 = await computeScriptContentHash(scriptPath);
    expect(hash2).not.toBe(hash1);
    await addAllowlistEntry(
      {
        event: 'pre_tool_call',
        command: scriptPath,
        scriptPath,
        scriptContentHash: hash2,
        registeredAt: new Date().toISOString(),
      },
      allowlistPath
    );
    const all = await readAllowlist(allowlistPath);
    expect(all).toHaveLength(1);
    expect(all[0]!.scriptContentHash).toBe(hash2);
  });

  it('returns empty array when allowlist file is missing', async () => {
    const ghost = path.join(workDir, 'never-existed.json');
    const all = await readAllowlist(ghost);
    expect(all).toEqual([]);
  });
});
