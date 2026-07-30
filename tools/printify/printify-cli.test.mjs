import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cli = join(import.meta.dir, 'bin', 'printify.mjs');

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '',
      HOME: join(tmpdir(), 'runneros-printify-test-home-without-cli'),
      RUNNEROS_DISABLE_PRINTIFY_BUNDLED_CLI: '1',
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
