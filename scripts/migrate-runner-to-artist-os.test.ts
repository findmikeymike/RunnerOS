import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
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

  test('refuses plaintext credential caches and environment files inside a workspace', async () => {
    const paths = fixture();
    const sourceDir = join(paths.workspaceRoot, 'sources', 'private-api');
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, '.credential-cache.json'), JSON.stringify({ value: 'runner-secret' }));
    writeFileSync(join(paths.workspaceRoot, '.env.local'), 'PRIVATE_TOKEN=runner-secret\n');

    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('.credential-cache.json');
    expect(result.stderr).toContain('.env.local');
    expect(existsSync(paths.artistRoot)).toBe(false);
  });

  test('streams checksum verification for large media files', async () => {
    const paths = fixture('hq');
    const largeMaster = join(paths.workspaceRoot, 'large-master.wav');
    writeFileSync(largeMaster, '');
    truncateSync(largeMaster, 32 * 1024 * 1024);

    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(paths.artistRoot, 'workspaces', 'campaign-one', 'large-master.wav'))).toBe(true);
  });

  test('preserves unrelated staging-looking directories regardless of age', async () => {
    const paths = fixture('hq');
    const workspacesRoot = join(paths.artistRoot, 'workspaces');
    const stale = join(workspacesRoot, 'campaign-one.migration-abandoned.tmp');
    const recent = join(workspacesRoot, 'campaign-one.migration-active.tmp');
    mkdirSync(stale, { recursive: true });
    mkdirSync(recent, { recursive: true });
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    const result = await run([
      '--runner-root', paths.runnerRoot,
      '--artist-root', paths.artistRoot,
      '--workspace', 'campaign-one',
      '--apply',
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(stale)).toBe(true);
    expect(existsSync(recent)).toBe(true);
  });

  test.each(['../../escaped', '../other', 'nested/path', '..', 'bad\\id'])(
    'rejects unsafe registry ID %s before creating destination state', async (id) => {
      const paths = fixture();
      const configPath = join(paths.runnerRoot, 'config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      config.workspaces[0].id = id;
      writeFileSync(configPath, JSON.stringify(config));
      const result = await run(['--runner-root', paths.runnerRoot, '--artist-root', paths.artistRoot, '--workspace', id, '--apply']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Invalid workspace ID');
      expect(existsSync(paths.artistRoot)).toBe(false);
      expect(readFileSync(join(paths.workspaceRoot, 'asset.txt'), 'utf8')).toBe('preserve-me\n');
    },
  );

  test('never sweeps a source workspace that resembles old staging', async () => {
    const paths = fixture();
    const source = join(paths.artistRoot, 'workspaces', 'campaign-one.migration-personal.tmp');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'precious.txt'), 'original only');
    const configPath = join(paths.runnerRoot, 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.workspaces[0].rootPath = source;
    writeFileSync(configPath, JSON.stringify(config));
    const old = new Date(1);
    utimesSync(source, old, old);
    const result = await run(['--runner-root', paths.runnerRoot, '--artist-root', paths.artistRoot, '--workspace', 'campaign-one', '--apply']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('completely separate');
    expect(readFileSync(join(source, 'precious.txt'), 'utf8')).toBe('original only');
  });

  test('rejects an Artist profile inside the actual source via an ancestor symlink', async () => {
    const paths = fixture();
    const alias = join(paths.sandbox, 'alias');
    symlinkSync(paths.workspaceRoot, alias);
    const result = await run(['--runner-root', paths.runnerRoot, '--artist-root', join(alias, 'new-profile'), '--workspace', 'campaign-one', '--apply']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('completely separate');
    expect(existsSync(join(paths.workspaceRoot, 'new-profile'))).toBe(false);
  });

  test('rejects a workspace destination redirected outside the Artist profile', async () => {
    const paths = fixture();
    const outside = join(paths.sandbox, 'unrelated');
    mkdirSync(outside);
    mkdirSync(paths.artistRoot);
    symlinkSync(outside, join(paths.artistRoot, 'workspaces'));
    const result = await run(['--runner-root', paths.runnerRoot, '--artist-root', paths.artistRoot, '--workspace', 'campaign-one', '--apply']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('inside the Artist OS root');
    expect(existsSync(join(outside, 'campaign-one'))).toBe(false);
    expect(existsSync(join(paths.artistRoot, 'config.json'))).toBe(false);
  });

  test('failed publication cleans only its own copy and preserves unrelated old staging', async () => {
    const paths = fixture();
    const unrelated = join(paths.artistRoot, 'workspaces', 'campaign-one.migration-old.tmp');
    mkdirSync(unrelated, { recursive: true });
    writeFileSync(join(unrelated, 'precious.txt'), 'keep');
    utimesSync(unrelated, new Date(1), new Date(1));
    // A file prevents creation of the migrations directory after copy publication.
    writeFileSync(join(paths.artistRoot, 'migrations'), 'block manifest write');
    const result = await run(['--runner-root', paths.runnerRoot, '--artist-root', paths.artistRoot, '--workspace', 'campaign-one', '--apply']);
    expect(result.exitCode).not.toBe(0);
    expect(readFileSync(join(unrelated, 'precious.txt'), 'utf8')).toBe('keep');
    expect(existsSync(join(paths.artistRoot, 'workspaces', 'campaign-one'))).toBe(false);
    expect(readFileSync(join(paths.workspaceRoot, 'asset.txt'), 'utf8')).toBe('preserve-me\n');
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
