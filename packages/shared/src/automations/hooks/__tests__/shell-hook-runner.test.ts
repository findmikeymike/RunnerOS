import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn as realSpawn, type SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runShellHook, parseHookStdout } from '../shell-hook-runner.ts';
import type { HookEvent, HookSpec } from '../types.ts';

const FIXTURES = path.join(import.meta.dir, 'fixtures');

let workDir: string;
let allowlistPath: string;

const baseEvent: HookEvent = {
  hook_event_name: 'pre_tool_call',
  tool_name: 'terminal',
  tool_input: { command: 'rm -rf /' },
  session_id: 'sess_test',
  cwd: '/tmp',
};

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(tmpdir(), 'rnos-runner-'));
  allowlistPath = path.join(workDir, 'allowlist.json');
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('parseHookStdout — wire-shape normalisation', () => {
  it('normalises Claude-Code {decision, reason} block into {action, message}', () => {
    expect(parseHookStdout('{"decision":"block","reason":"x"}'))
      .toEqual({ action: 'block', message: 'x' });
  });
  it('passes Hermes {action, message} block through unchanged', () => {
    expect(parseHookStdout('{"action":"block","message":"y"}'))
      .toEqual({ action: 'block', message: 'y' });
  });
  it('passes context injection through unchanged', () => {
    expect(parseHookStdout('{"context":"Today is Friday"}'))
      .toEqual({ context: 'Today is Friday' });
  });
  it('returns null for invalid JSON', () => {
    expect(parseHookStdout('not json')).toBeNull();
  });
  it('returns null for empty stdout', () => {
    expect(parseHookStdout('')).toBeNull();
    expect(parseHookStdout('   ')).toBeNull();
  });
  it('returns null for JSON without a recognised shape', () => {
    expect(parseHookStdout('{"unrelated":true}')).toBeNull();
  });
  it('handles allow-shape from either wire', () => {
    expect(parseHookStdout('{"action":"allow","message":"ok"}'))
      .toEqual({ action: 'allow', message: 'ok' });
    expect(parseHookStdout('{"decision":"allow"}'))
      .toEqual({ action: 'allow' });
  });
});

describe('runShellHook — happy path (real subprocess)', () => {
  it('hook-allow.sh (Hermes-canonical allow)', async () => {
    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-allow.sh') };
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect(res).toEqual({ action: 'allow', message: 'ok' });
  });

  it('hook-block-claude.sh (Claude-Code-canonical block normalises to action:block)', async () => {
    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-block-claude.sh') };
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect(res).toEqual({ action: 'block', message: 'forbidden by script' });
  });

  it('hook-block-hermes.sh (Hermes-canonical block)', async () => {
    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-block-hermes.sh') };
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect(res).toEqual({ action: 'block', message: 'hermes says no' });
  });

  it('hook-context.py (python interpreter, context injection)', async () => {
    const spec: HookSpec = {
      event: 'pre_llm_call',
      command: `python3 ${path.join(FIXTURES, 'hook-context.py')}`,
    };
    const res = await runShellHook(spec, { ...baseEvent, hook_event_name: 'pre_llm_call' }, {
      acceptHooks: true, allowlistPath,
    });
    expect(res).toEqual({ context: 'Today is Friday' });
  });
});

describe('runShellHook — failure modes are fail-open', () => {
  it('timeout: hook that sleeps longer than timeoutMs is killed and returns allow', async () => {
    const spec: HookSpec = {
      event: 'pre_tool_call',
      command: path.join(FIXTURES, 'hook-sleep.sh'),
      timeoutMs: 200, // clamped to MIN_TIMEOUT_MS=50; sleep is 5s
    };
    const t0 = Date.now();
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(4_500);
    expect('action' in res ? res.action : '').toBe('allow');
    expect('message' in res ? res.message ?? '' : '').toMatch(/timeout/);
  }, 10_000);

  it('non-zero exit + stderr noise still returns parsed stdout decision', async () => {
    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-nonzero.sh') };
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect(res).toEqual({ action: 'allow', message: 'still ok' });
  });

  it('invalid stdout JSON downgrades to a silent allow (does not throw)', async () => {
    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-bad-json.sh') };
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect(res).toEqual({ action: 'allow' });
  });

  it('missing binary returns allow (real ENOENT path; does not throw)', async () => {
    // Use a known-good fixture to satisfy consent, then point spawn at a missing path
    // via spawnFn injection (real spawn -> real ENOENT).
    const okSpec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-allow.sh') };
    const ghost = `/does/not/exist/${Date.now()}-${Math.random()}.sh`;
    const fakeSpawn = ((_cmd: string, _args: readonly string[], opts: SpawnOptions) => {
      return realSpawn(ghost, [], opts);
    }) as unknown as typeof realSpawn;

    const res = await runShellHook(okSpec, baseEvent, {
      acceptHooks: true,
      allowlistPath,
      spawnFn: fakeSpawn,
    });
    expect('action' in res ? res.action : '').toBe('allow');
    expect('message' in res ? res.message ?? '' : '').toMatch(/spawn error/);
  });
});

describe('runShellHook — safety invariants', () => {
  it('spawn is always called with shell: false (never shell: true)', async () => {
    const captured: Array<{ cmd: string; args: readonly string[]; opts: SpawnOptions }> = [];
    const fakeSpawn = ((cmd: string, args: readonly string[], opts: SpawnOptions) => {
      captured.push({ cmd, args, opts });
      // Synthesise a tiny child that closes cleanly with our canned stdout.
      return realSpawn('node', ['-e', "process.stdin.on('data', () => {}); process.stdout.write('{\"action\":\"allow\"}'); setTimeout(() => process.exit(0), 5);"]);
    }) as unknown as typeof realSpawn;

    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-allow.sh') };
    await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath, spawnFn: fakeSpawn });

    expect(captured.length).toBeGreaterThanOrEqual(1);
    for (const call of captured) {
      expect(call.opts.shell).toBe(false);
    }
  });

  it('consent gate fires on a non-allowlisted command in non-TTY without acceptHooks', async () => {
    const spec: HookSpec = { event: 'pre_tool_call', command: path.join(FIXTURES, 'hook-allow.sh') };
    let caught: unknown = null;
    try {
      await runShellHook(spec, baseEvent, { isTTY: false, acceptHooks: false, allowlistPath });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe('HookConsentRequiredError');
  });

  it('TOCTOU: script content swapped between consent and spawn → refused (spawn never invoked)', async () => {
    // Stage a writable copy of the allow hook so we can mutate its body mid-run.
    const scriptPath = path.join(workDir, 'mutable-hook.sh');
    await fs.copyFile(path.join(FIXTURES, 'hook-allow.sh'), scriptPath);
    await fs.chmod(scriptPath, 0o755);
    const spec: HookSpec = { event: 'pre_tool_call', command: scriptPath };

    // Pre-register the script in the allowlist so consent passes silently.
    await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });

    // Swap content. The TOCTOU defence re-hashes right before spawn and must
    // refuse — spawn must NOT be invoked.
    let spawnCalls = 0;
    const spySpawn = ((cmd: string, args: readonly string[], opts: SpawnOptions) => {
      spawnCalls++;
      return realSpawn(cmd, args as string[], opts);
    }) as unknown as typeof realSpawn;

    // Monkey-patch the script body BETWEEN consent and exec by overriding the
    // consent-time hash. The cleanest test path: rewrite the file, then call
    // runShellHook again — the runner hashes pre-consent (sees new bytes),
    // consent silently approves on cached entry MISS (we wrote a different
    // body, so the prior allowlist entry's hash no longer matches → consent
    // would re-prompt; in non-TTY+acceptHooks=true that silently re-approves
    // and updates the entry — exactly the case we want to defend with the
    // post-consent re-hash). Simulate the *narrow* TOCTOU window by overwriting
    // the file AFTER reading the pre-consent hash but BEFORE spawn: we do this
    // by interposing a promptFn that mutates the file at the moment of consent.
    await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho hijacked\n', { mode: 0o755 });

    const res = await runShellHook(
      { event: 'pre_tool_call', command: scriptPath },
      baseEvent,
      {
        isTTY: true,
        allowlistPath,
        spawnFn: spySpawn,
        // promptFn fires AFTER pre-consent hash and BEFORE post-consent hash —
        // overwrite the script HERE to simulate the swap window.
        promptFn: async () => {
          await fs.writeFile(scriptPath, '#!/usr/bin/env bash\necho hijacked-v2\n', { mode: 0o755 });
          return 'y';
        },
      }
    );

    expect('action' in res ? res.action : '').toBe('allow');
    expect('message' in res ? res.message ?? '' : '').toMatch(/content changed|TOCTOU/);
    expect(spawnCalls).toBe(0);
  });

  it('symlink swap: realpath-canonicalisation detects target replacement', async () => {
    // Two real files; a symlink that points first at A, then at B.
    const targetA = path.join(workDir, 'real-a.sh');
    const targetB = path.join(workDir, 'real-b.sh');
    await fs.writeFile(targetA, '#!/usr/bin/env bash\necho {"action":"allow","message":"A"}\n', { mode: 0o755 });
    await fs.writeFile(targetB, '#!/usr/bin/env bash\necho {"action":"block","message":"B"}\n', { mode: 0o755 });
    const link = path.join(workDir, 'link.sh');
    await fs.symlink(targetA, link);

    // Register the link — runShellHook canonicalises to A.
    const spec: HookSpec = { event: 'pre_tool_call', command: link };
    const first = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect('action' in first ? first.action : '').toBe('allow');

    // Swap the link to point at B.
    await fs.unlink(link);
    await fs.symlink(targetB, link);

    // Second call must NOT silently reuse the prior allowlist entry — the
    // canonical scriptPath is now `targetB`, which has no entry, so consent
    // fires. Without `acceptHooks` and in non-TTY this is a HookConsentRequiredError.
    let caught: unknown = null;
    try {
      await runShellHook(spec, baseEvent, { isTTY: false, acceptHooks: false, allowlistPath });
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeNull();
    expect((caught as Error).name).toBe('HookConsentRequiredError');
  });

  it('output-bloat downgrade defence: first valid JSON wins, trailing garbage ignored', async () => {
    // Hook writes a block decision followed by 16 KB of trailing noise.
    const scriptPath = path.join(workDir, 'bloat-hook.sh');
    const padBytes = 16 * 1024;
    await fs.writeFile(
      scriptPath,
      '#!/usr/bin/env bash\n' +
        'printf \'{"action":"block","message":"nope"}\'\n' +
        `head -c ${padBytes} /dev/urandom | base64\n`,
      { mode: 0o755 }
    );
    const spec: HookSpec = { event: 'pre_tool_call', command: scriptPath };
    const res = await runShellHook(spec, baseEvent, { acceptHooks: true, allowlistPath });
    expect(res).toEqual({ action: 'block', message: 'nope' });
  });

  it('parseHookStdout normalises {decision:"approve"} to {action:"allow"}', () => {
    expect(parseHookStdout('{"decision":"approve","reason":"ok"}'))
      .toEqual({ action: 'allow', message: 'ok' });
    expect(parseHookStdout('{"decision":"approve"}'))
      .toEqual({ action: 'allow' });
  });

  it('parseHookStdout: trailing garbage after the first JSON value is ignored', () => {
    const stream = '{"action":"block","message":"x"}' + '!@#$'.repeat(4096);
    expect(parseHookStdout(stream)).toEqual({ action: 'block', message: 'x' });
  });
});
