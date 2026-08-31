import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { requestConsent } from '../consent.ts';
import { readAllowlist, computeScriptContentHash } from '../allowlist-store.ts';
import { HookConsentRequiredError, type HookSpec } from '../types.ts';

let workDir: string;
let allowlistPath: string;
let scriptPath: string;
let spec: HookSpec;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'rnos-consent-'));
  allowlistPath = path.join(workDir, 'allowlist.json');
  scriptPath = path.join(workDir, 'hook.sh');
  await fs.writeFile(scriptPath, '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });
  spec = { event: 'pre_tool_call', command: scriptPath };
  delete process.env.RUNNEROS_ACCEPT_HOOKS;
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('requestConsent — first-use gate', () => {
  it('non-TTY without acceptHooks throws HookConsentRequiredError', async () => {
    let caught: unknown = null;
    try {
      await requestConsent(spec, { isTTY: false, acceptHooks: false, allowlistPath });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HookConsentRequiredError);
  });

  it('non-TTY with acceptHooks=true silently approves and persists the entry', async () => {
    const ok = await requestConsent(spec, { isTTY: false, acceptHooks: true, allowlistPath });
    expect(ok).toBe(true);
    const list = await readAllowlist(allowlistPath);
    expect(list).toHaveLength(1);
    expect(list[0]!.event).toBe('pre_tool_call');
    // Allowlist key is the realpath-canonical script path (defends against
    // symlink swap), which on macOS resolves /var → /private/var.
    expect(list[0]!.scriptPath).toBe(await fs.realpath(scriptPath));
  });

  it('non-TTY honors RUNNEROS_ACCEPT_HOOKS=1 env var', async () => {
    process.env.RUNNEROS_ACCEPT_HOOKS = '1';
    const ok = await requestConsent(spec, { isTTY: false, allowlistPath });
    expect(ok).toBe(true);
  });

  it('TTY prompt: "y" approves and writes the entry', async () => {
    const ok = await requestConsent(spec, {
      isTTY: true,
      allowlistPath,
      promptFn: async () => 'y',
    });
    expect(ok).toBe(true);
    const list = await readAllowlist(allowlistPath);
    expect(list).toHaveLength(1);
  });

  it('TTY prompt: anything-but-yes is a soft decline (returns false, no entry)', async () => {
    const ok = await requestConsent(spec, {
      isTTY: true,
      allowlistPath,
      promptFn: async () => 'n',
    });
    expect(ok).toBe(false);
    const list = await readAllowlist(allowlistPath);
    expect(list).toEqual([]);
  });
});

describe('requestConsent — re-use behaviour', () => {
  it('second call with same script + hash is silent (no prompt)', async () => {
    await requestConsent(spec, { isTTY: false, acceptHooks: true, allowlistPath });
    let promptCalls = 0;
    const ok = await requestConsent(spec, {
      isTTY: true,
      allowlistPath,
      promptFn: async () => { promptCalls++; return 'n'; },
    });
    expect(ok).toBe(true);
    expect(promptCalls).toBe(0);
  });

  it('script body change forces re-prompt (sha256 mismatch invalidates entry)', async () => {
    await requestConsent(spec, { isTTY: false, acceptHooks: true, allowlistPath });
    const hashBefore = await computeScriptContentHash(scriptPath);

    await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho v2\n', { mode: 0o755 });
    const hashAfter = await computeScriptContentHash(scriptPath);
    expect(hashAfter).not.toBe(hashBefore);

    let promptCalls = 0;
    const ok = await requestConsent(spec, {
      isTTY: true,
      allowlistPath,
      promptFn: async () => { promptCalls++; return 'y'; },
    });
    expect(promptCalls).toBe(1);
    expect(ok).toBe(true);
  });
});
