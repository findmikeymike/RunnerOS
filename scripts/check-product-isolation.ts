import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

interface SnapshotEntry {
  hash: string;
  mtimeMs: number;
  size: number;
}

function snapshotTree(root: string): Record<string, SnapshotEntry> {
  if (!existsSync(root)) return {};
  const result: Record<string, SnapshotEntry> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const stats = statSync(path);
      result[relative(root, path)] = {
        hash: createHash('sha256').update(readFileSync(path)).digest('hex'),
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      };
    }
  };
  walk(root);
  return result;
}

function isWithin(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function checkStaticBoundaries(repoRoot: string): void {
  const candidates = [
    'apps/electron/src',
    'packages/shared/src',
    'packages/server-core/src',
    'packages/server/src',
    'packages/session-mcp-server/src',
    'packages/session-tools-core/src',
    'tools/google-ads',
    'tools/youtube-research',
    'tools/youtube-intelligence',
  ];
  const forbidden = [
    /join\(homedir\(\),\s*['"]\.craft-agent['"]/,
    /join\(homedir\(\),\s*['"]\.agents['"]/,
    /join\(homedir\(\),\s*['"]\.workflows['"]/,
    /join\(homedir\(\),\s*['"]\.config['"],\s*['"]runneros['"]/,
    /join\(homedir\(\),\s*['"]\.config['"],\s*['"]printing-press-clis['"]/,
    /parsed\.protocol\s*[!=]==?\s*['"]craftagents:['"]/,
    /`craftagents:\/\//,
  ];
  const allow = new Set([
    'packages/shared/src/config/runtime-identity.ts',
  ]);
  const violations: string[] = [];

  for (const base of candidates) {
    const glob = new Bun.Glob('**/*.{ts,tsx,js,mjs,cjs}');
    for (const relativeFile of glob.scanSync({ cwd: join(repoRoot, base), onlyFiles: true })) {
      const file = join(base, relativeFile).replace(/\\/g, '/');
      if (allow.has(file) || /(?:^|\/)(?:__tests__|test|tests)(?:\/|$)/.test(file) || /\.(?:test|spec)\./.test(file)) continue;
      const content = readFileSync(join(repoRoot, file), 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(content)) violations.push(`${file}: ${pattern}`);
      }
    }
  }

  assert(violations.length === 0, `Hardcoded product boundary violations:\n${violations.join('\n')}`);

  const commonBuilder = readFileSync(join(repoRoot, 'apps/electron/electron-builder.common.yml'), 'utf8');
  const runnerBuilder = readFileSync(join(repoRoot, 'apps/electron/electron-builder.yml'), 'utf8');
  const artistBuilder = readFileSync(join(repoRoot, 'apps/electron/electron-builder.artist-os.yml'), 'utf8');
  assert(commonBuilder.includes('appId: com.findmikeymike.runner'), 'Runner app ID changed unexpectedly');
  assert(commonBuilder.includes('productName: Runner'), 'Runner product name changed unexpectedly');
  assert(!commonBuilder.includes('schemes:'), 'Shared package config must not register a product protocol');
  assert(runnerBuilder.includes('extends: ./electron-builder.common.yml'), 'Runner package does not extend the shared config');
  assert(artistBuilder.includes('extends: ./electron-builder.common.yml'), 'Artist OS package does not extend the shared config');
  assert(
    (commonBuilder.match(/from: \.\.\/\.\.\/node_modules\/@anthropic-ai/g) ?? []).length === 3,
    'Shared package config must bundle the root Claude SDK for macOS, Windows, and Linux',
  );
  assert(
    !commonBuilder.includes('from: node_modules/@anthropic-ai'),
    'Shared package config still points at the empty Electron-local Claude SDK path',
  );
  assert(artistBuilder.includes('appId: com.findmikeymike.artistos'), 'Artist OS app ID is missing');
  assert(artistBuilder.includes('productName: Artist OS'), 'Artist OS product name is missing');
  assert(!artistBuilder.includes('RunnerOS/releases'), 'Artist OS update feed points at Runner');
  assert(!artistBuilder.includes('Runner-${arch}'), 'Artist OS inherits a Runner artifact name');
  assert(artistBuilder.includes('title: Artist OS'), 'Artist OS DMG title is missing');
  assert(runnerBuilder.includes('- craftagents'), 'Runner package protocol is missing');
  assert(artistBuilder.includes('- artistos'), 'Artist OS package protocol is missing');
  assert(!artistBuilder.includes('- craftagents'), 'Artist OS package still registers Runner protocol');
  assert(artistBuilder.includes('extendInfo: null'), 'Artist OS does not clear Runner macOS icon metadata');
  assert(
    (artistBuilder.match(/artifactName: Artist-OS-/g) ?? []).length >= 5,
    'Artist OS must override root, macOS, Windows, Linux, and DMG artifact names',
  );
  for (const icon of ['artist-os-icon.icns', 'artist-os-icon.ico', 'artist-os-icon.png']) {
    assert(artistBuilder.includes(icon), `Artist OS packaging icon is missing: ${icon}`);
  }

  const bootstrapSource = readFileSync(join(repoRoot, 'apps/electron/src/main/bootstrap.ts'), 'utf8');
  const mainSource = readFileSync(join(repoRoot, 'apps/electron/src/main/index.ts'), 'utf8');
  const shellEnvSource = readFileSync(join(repoRoot, 'apps/electron/src/main/shell-env.ts'), 'utf8');
  const serverSource = readFileSync(join(repoRoot, 'packages/server/src/index.ts'), 'utf8');
  assert(
    bootstrapSource.includes('CRAFT_INTEGRATION_CACHE_ROOT: RUNTIME_IDENTITY.integrationCacheRoot'),
    'Electron does not propagate the product-owned integration cache root',
  );
  assert(
    !bootstrapSource.includes("process.env['CRAFT_RPC_PORT'] ??="),
    'Electron product default overrides the user-selected embedded server port',
  );
  assert(
    serverSource.includes("process.env['CRAFT_INTEGRATION_CACHE_ROOT'] = RUNTIME_IDENTITY.integrationCacheRoot"),
    'Headless server does not propagate the product-owned integration cache root',
  );
  assert(!mainSource.includes("import { loadShellEnv } from './shell-env'"), 'Electron reloads shell identity after bootstrap');
  for (const key of [
    'CRAFT_PRODUCT_VARIANT',
    'CRAFT_CONFIG_DIR',
    'CRAFT_GLOBAL_SKILLS_DIR',
    'CRAFT_INTEGRATION_CACHE_ROOT',
    'CRAFT_RPC_PORT',
    'CRAFT_TRIGGER_PORT',
    'SOCIAL_HOME',
  ]) {
    assert(shellEnvSource.includes(`'${key}'`), `Shell environment can overwrite sealed product identity: ${key}`);
  }
}

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dir, '..');
  checkStaticBoundaries(repoRoot);

  const sandbox = mkdtempSync(join(tmpdir(), 'artist-os-isolation-'));
  const runnerRoot = join(sandbox, '.craft-agent');
  const runnerAgents = join(sandbox, '.agents');
  const runnerWorkflows = join(sandbox, '.workflows');
  const artistRoot = join(sandbox, '.artist-os');

  try {
    for (const [directory, filename] of [
      [runnerRoot, 'runner-canary.txt'],
      [runnerAgents, 'runner-agents-canary.txt'],
      [runnerWorkflows, 'runner-workflows-canary.txt'],
    ] as const) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, filename), `do-not-touch:${filename}\n`, 'utf8');
    }

    const before = {
      state: snapshotTree(runnerRoot),
      agents: snapshotTree(runnerAgents),
      workflows: snapshotTree(runnerWorkflows),
    };

    const child = Bun.spawn([
      process.execPath,
      'run',
      'scripts/product-isolation-probe.ts',
    ], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: sandbox,
        CRAFT_PRODUCT_VARIANT: 'artist-os',
        CRAFT_CONFIG_DIR: artistRoot,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    assert(exitCode === 0, `Artist OS isolation probe failed:\n${stderr}`);

    const payload = JSON.parse(stdout.trim()) as {
      identity: { variant: string; dataRoot: string };
      paths: Record<string, string>;
    };
    assert(payload.identity.variant === 'artist-os', 'Probe did not run as Artist OS');
    assert(resolve(payload.identity.dataRoot) === resolve(artistRoot), 'Artist OS used the wrong data root');
    for (const [name, path] of Object.entries(payload.paths)) {
      assert(isWithin(artistRoot, path), `${name} escaped Artist OS root: ${path}`);
      assert(existsSync(path), `${name} was not created at the isolated path: ${path}`);
    }

    const after = {
      state: snapshotTree(runnerRoot),
      agents: snapshotTree(runnerAgents),
      workflows: snapshotTree(runnerWorkflows),
    };
    assert(JSON.stringify(after) === JSON.stringify(before), 'Artist OS modified Runner canary state');

    console.log('Product isolation gate passed: Artist OS writes contained; Runner canaries unchanged.');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
