import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function fixture(scope: 'hq' | 'campaign' | 'general' = 'campaign') {
  const sandbox = mkdtempSync(join(tmpdir(), 'artist-migration-test-'));
  sandboxes.push(sandbox);
  const runnerRoot = join(sandbox, 'runner');
  const artistRoot = join(sandbox, 'artist');
  const workspaceRoot = join(sandbox, 'source-workspace');
  mkdirSync(runnerRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ name: 'Campaign' }));
  writeFileSync(join(workspaceRoot, 'asset.txt'), 'preserve-me\n');
  writeFileSync(join(runnerRoot, 'credentials.enc'), 'must-not-copy');
  writeFileSync(join(runnerRoot, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'campaign-one',
      name: 'Campaign One',
      rootPath: workspaceRoot,
      artistWorkspaceScope: scope,
      createdAt: 1,
    }],
    activeWorkspaceId: 'campaign-one',
    activeSessionId: null,
  }));
  return { sandbox, runnerRoot, artistRoot, workspaceRoot };
}

async function run(args: string[]) {
  const child = Bun.spawn([
    process.execPath,
    'run',
    'scripts/migrate-runner-to-artist-os.ts',
    ...args,
  ], {
    cwd: join(import.meta.dir, '..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('Runner to Artist OS selective migration', () => {
  test('dry-run reports exact work without creating Artist OS state', async () => {
    const paths = fixture();
    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).mode).toBe('dry-run');
    expect(existsSync(paths.artistRoot)).toBe(false);
    expect(readFileSync(join(paths.workspaceRoot, 'asset.txt'), 'utf8')).toBe('preserve-me\n');
  });

  test('rejects ambiguous general workspaces without a second explicit flag', async () => {
    const paths = fixture('general');
    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('--allow-general');
    expect(existsSync(paths.artistRoot)).toBe(false);
  });

  test('apply copies with checksum proof and leaves Runner data and credentials untouched', async () => {
    const paths = fixture('hq');
    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout) as { manifestPath: string };
    const destination = join(paths.artistRoot, 'workspaces', 'campaign-one');
    expect(readFileSync(join(destination, 'asset.txt'), 'utf8')).toBe('preserve-me\n');
    expect(readFileSync(join(paths.workspaceRoot, 'asset.txt'), 'utf8')).toBe('preserve-me\n');
    expect(readFileSync(join(paths.runnerRoot, 'credentials.enc'), 'utf8')).toBe('must-not-copy');
    expect(existsSync(join(paths.artistRoot, 'credentials.enc'))).toBe(false);
    expect(existsSync(output.manifestPath)).toBe(true);
  });

  test('refuses to overwrite an existing Artist OS workspace', async () => {
    const paths = fixture();
    mkdirSync(join(paths.artistRoot, 'workspaces', 'campaign-one'), { recursive: true });
    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('refusing to overwrite');
  });

  test('rejects registry conflicts before copying any workspace data', async () => {
    const paths = fixture();
    mkdirSync(paths.artistRoot, { recursive: true });
    writeFileSync(join(paths.artistRoot, 'config.json'), JSON.stringify({
      workspaces: [{ id: 'campaign-one', name: 'Existing', rootPath: '/existing' }],
      activeWorkspaceId: 'campaign-one',
      activeSessionId: null,
    }));
    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('registry already contains');
    expect(existsSync(join(paths.artistRoot, 'workspaces', 'campaign-one'))).toBe(false);
  });

  test('refuses embedded source credentials instead of copying them across products', async () => {
    const paths = fixture();
    const sourceDir = join(paths.workspaceRoot, 'sources', 'private-api');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'config.json'), JSON.stringify({
      api: { googleOAuthClientSecret: 'runner-secret' },
    }));

    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('embedded credentials');
    expect(existsSync(paths.artistRoot)).toBe(false);
  });

  test('refuses symbolic links that could keep Artist OS attached to Runner data', async () => {
    const paths = fixture();
    symlinkSync(join(paths.workspaceRoot, 'asset.txt'), join(paths.workspaceRoot, 'linked-asset.txt'));

    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(paths.artistRoot)).toBe(false);
  });
});
