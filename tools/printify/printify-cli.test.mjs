import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const cli = join(import.meta.dir, 'bin', 'printify.mjs');

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '',
      HOME: join(tmpdir(), 'runneros-printify-test-home-without-cli'),
      RUNNEROS_DISABLE_PRINTIFY_BUNDLED_CLI: '1',
      ...env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ? JSON.parse(result.stdout) : null,
    stderr: result.stderr,
  };
}

describe('printify cli wrapper', () => {
  test('reports missing upstream binary clearly', () => {
    const result = run(['shops-json', '--agent']);

    expect(result.status).toBe(127);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.error).toContain('printify-pp-cli binary not found or not executable');
    expect(JSON.stringify(result.stdout)).not.toContain('PRINTIFY_API_TOKEN=');
  });

  test('write-like product create is approval-gated before binary resolution', () => {
    const result = run([
      'shops',
      'products-json',
      'create-anew-product',
      '123',
      '--title',
      'Smoke',
      '--agent',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.ok).toBe(true);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.approveCommand).toContain('--confirm-runner');
  });

  test('product publish is approval-gated before binary resolution', () => {
    const result = run(['shops', 'products-json', 'publish', '123', 'abc', '--agent']);

    expect(result.status).toBe(0);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.operation).toBe('printify.write');
  });

  test('unknown commands are approval-gated by default', () => {
    const result = run(['future-provider-command', '--agent']);

    expect(result.status).toBe(0);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.operation).toBe('printify.write');
  });

  test('sync and tail are approval-gated because they can be long-running or locally mutating', () => {
    const sync = run(['sync', '--agent']);
    const tail = run(['tail', '--agent']);

    expect(sync.status).toBe(0);
    expect(sync.stdout.requiresApproval).toBe(true);
    expect(tail.status).toBe(0);
    expect(tail.stdout.requiresApproval).toBe(true);
  });

  test('approval command shell-quotes args and keeps argv form', () => {
    const result = run(['products-json', 'create-anew-product', '--title', "Summer Tee's Best", '--agent']);

    expect(result.status).toBe(0);
    expect(result.stdout.command).toContain("'Summer Tee'\\''s Best'");
    expect(result.stdout.argv).toContain("Summer Tee's Best");
    expect(result.stdout.approveArgv).toContain('--confirm-runner');
  });

  test('approval packet redacts token-like command args', () => {
    const result = run([
      'products-json',
      'create-anew-product',
      '--api-key',
      'secret-value',
      '--agent',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.requiresApproval).toBe(true);
    expect(result.stdout.command).not.toContain('secret-value');
    expect(result.stdout.approveCommand).not.toContain('secret-value');
    expect(result.stdout.argv).not.toContain('secret-value');
    expect(result.stdout.approveArgv).not.toContain('secret-value');
  });

  test('dry-run write-like upload is allowed to reach binary resolution', () => {
    const result = run(['uploads', 'an-image', '--body-json', '{}', '--dry-run', '--agent']);

    expect(result.status).toBe(127);
    expect(result.stdout.ok).toBe(false);
    expect(result.stdout.error).toContain('printify-pp-cli binary not found or not executable');
  });

  test('private artwork upload can execute without approval', () => {
    const result = run(['uploads', 'an-image', '--body-json', '{}', '--private-draft', '--agent']);

    expect(result.status).toBe(127);
    expect(result.stdout.requiresApproval).not.toBe(true);
    expect(result.stdout.error).toContain('printify-pp-cli binary not found or not executable');
  });

  test('private unpublished product creation can execute without approval', () => {
    const result = run([
      'shops',
      'products-json',
      'create-anew-product',
      '123',
      '--title',
      'Draft',
      '--private-draft',
      '--agent',
    ]);

    expect(result.status).toBe(127);
    expect(result.stdout.requiresApproval).not.toBe(true);
  });

  test('private-draft flag cannot bypass approval for publish', () => {
    const result = run([
      'shops',
      'products-json',
      'publish',
      '123',
      'product',
      '--private-draft',
      '--agent',
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout.requiresApproval).toBe(true);
  });
});

function importFixture(action) {
  const dir = mkdtempSync(join(tmpdir(), 'printify-approval-test-'));
  const input = join(dir, 'input.jsonl');
  const binary = join(dir, 'fake-provider');
  const marker = join(dir, 'executed');
  const original = '{"title":"Reviewed A"}\n';
  writeFileSync(input, original);
  writeFileSync(binary, `#!${process.execPath}
import { readFileSync, writeFileSync, statSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(process.env.EXECUTED_MARKER, 'yes');
if (process.env.MUTATE_SOURCE) writeFileSync(process.env.MUTATE_SOURCE, 'changed after verification');
const index = args.indexOf('--input');
const path = index >= 0 ? args[index + 1] : undefined;
console.log(JSON.stringify({ args, path, bytes: path && path !== '-' ? readFileSync(path, 'utf8') : null,
  mode: path && path !== '-' ? statSync(path).mode & 0o777 : null }));
process.exitCode = Number(process.env.CHILD_EXIT_CODE || 0);
`, { mode: 0o700 });
  try { action({ input, original, marker, env: { PRINTIFY_PP_CLI: binary, EXECUTED_MARKER: marker } }); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('Printify import file approval binding', () => {
  for (const style of ['long', 'short', 'equals', 'short-equals', 'attached']) {
    test(`captures actual bytes and executes a cleaned-up snapshot (${style})`, () => importFixture(({ input, original, env }) => {
      const inputArgs = style === 'long' ? ['--input', input] : style === 'short' ? ['-i', input]
        : style === 'equals' ? [`--input=${input}`] : style === 'short-equals' ? [`-i=${input}`] : [`-i${input}`];
      const packet = run(['import', 'products', ...inputArgs]).stdout;
      const digestIndex = packet.approveArgv.indexOf('--runner-input-sha256');
      expect(packet.approveArgv[digestIndex + 1]).toBe(createHash('sha256').update(original).digest('hex'));
      const result = run(packet.approveArgv.slice(2), { ...env, MUTATE_SOURCE: input });
      expect(result.status).toBe(0);
      expect(result.stdout.bytes).toBe(original);
      expect(readFileSync(input, 'utf8')).toBe('changed after verification');
      expect(result.stdout.path).not.toBe(input);
      expect(result.stdout.mode).toBe(0o400);
      expect(result.stdout.args).not.toContain('--runner-input-sha256');
      expect(result.stdout.args).not.toContain('--confirm-runner');
      expect(existsSync(result.stdout.path)).toBe(false);
    }));
  }

  test('changed source rejects old approval; a fresh review succeeds', () => importFixture(({ input, marker, env }) => {
    const packet = run(['import', 'products', '--input', input]).stdout;
    writeFileSync(input, '{"title":"Changed B"}\n');
    const stale = run(packet.approveArgv.slice(2), env);
    expect(stale.status).toBe(1);
    expect(stale.stdout.error).toContain('changed since review');
    expect(existsSync(marker)).toBe(false);
    const fresh = run(['import', 'products', '--input', input]).stdout;
    const result = run(fresh.approveArgv.slice(2), env);
    expect(result.status).toBe(0);
    expect(result.stdout.bytes).toContain('Changed B');
  }));

  test('file confirmation without reviewed digest does not execute', () => importFixture(({ input, marker, env }) => {
    const result = run(['import', 'products', '--input', input, '--confirm-runner'], env);
    expect(result.status).toBe(1);
    expect(result.stdout.error).toContain('digest missing');
    expect(existsSync(marker)).toBe(false);
  }));

  test('unconfirmed digest cannot substitute for independently captured bytes', () => importFixture(({ input, original }) => {
    const result = run(['import', 'products', '--input', input, '--runner-input-sha256', '0'.repeat(64)]);
    expect(result.stdout.approveArgv.at(-1)).toBe(createHash('sha256').update(original).digest('hex'));
  }));

  test('stdin, missing input and dry run keep existing dispatch behavior', () => importFixture(({ input, env }) => {
    for (const args of [
      ['import', 'products', '--input', '-', '--confirm-runner'],
      ['import', 'products', '--confirm-runner'],
      ['import', 'products', '--input', input, '--dry-run'],
    ]) {
      const result = run(args, env);
      expect(result.status).toBe(0);
      expect(result.stdout.args).not.toContain('--runner-input-sha256');
    }
  }));
});


test('import approval recognizes native global flags before the command', () => importFixture(({ input, env }) => {
  for (const prefix of [['--agent'], ['--config', 'import'], ['--profile', 'selected'], ['--timeout=5s']]) {
    const packet = run([...prefix, 'import', 'products', '--input', input]).stdout;
    expect(packet.approveArgv).toContain('--runner-input-sha256');
    const result = run(packet.approveArgv.slice(2), env);
    expect(result.status).toBe(0);
    expect(result.stdout.path).not.toBe(input);
  }
}));

test('ambiguous import file flags cannot forward an unverified path', () => importFixture(({ input, marker, env }) => {
  const result = run(['import', 'products', '--input', input, '-i', input, '--confirm-runner', '--runner-input-sha256', '0'.repeat(64)], env);
  expect(result.status).toBe(1);
  expect(result.stdout.error).toContain('unambiguous');
  expect(existsSync(marker)).toBe(false);
}));


test('failed provider execution also removes the verified snapshot', () => importFixture(({ input, env }) => {
  const packet = run(['import', 'products', '--input', input]).stdout;
  const result = run(packet.approveArgv.slice(2), { ...env, CHILD_EXIT_CODE: '7' });
  expect(result.status).toBe(7);
  expect(existsSync(result.stdout.path)).toBe(false);
  expect(existsSync(input)).toBe(true);
}));
