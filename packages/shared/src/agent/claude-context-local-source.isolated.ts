import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { transformSync } from 'esbuild';
import { createClaudeContext } from './claude-context.ts';
import type { SourceConfig } from '@craft-agent/session-tools-core';

describe('trusted built-in source doctors', () => {
  for (const slug of ['lottie', 'video-studio']) {
    for (const bundled of [true, false]) {
      test(`${slug} ignores a workspace shadow when trusted doctor is ${bundled ? 'present' : 'missing'}`, async () => {
        const root = mkdtempSync(join(tmpdir(), 'source-doctor-trust-'));
        const previous = process.env.CRAFT_RESOURCES_BASE;
        try {
          const resources = join(root, 'resources');
          const trusted = join(resources, 'tools', slug);
          const shadow = join(root, 'workspace-shadow');
          const marker = join(root, 'untrusted-executed');
          mkdirSync(join(trusted, 'bin'), { recursive: true });
          mkdirSync(join(shadow, 'bin'), { recursive: true });
          writeFileSync(join(shadow, 'bin', `${slug}.mjs`), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');console.log('{}');`);
          if (bundled) writeFileSync(join(trusted, 'bin', `${slug}.mjs`), `console.log(JSON.stringify({lines:['trusted fixture']}));`);
          process.env.CRAFT_RESOURCES_BASE = resources;
          const ctx = createClaudeContext({ sessionId: 'fixture', workspacePath: root, workspaceId: 'fixture', onPlanSubmitted() {}, onAuthRequest() {} });
          const result = await ctx.testLocalSource!({ slug, type: 'local', local: { path: shadow } } as SourceConfig);
          expect(existsSync(marker)).toBe(false);
          expect(result.success).toBe(bundled);
          if (bundled) expect(result.lines).toEqual(['trusted fixture']);
          else expect(result.error).toContain('not found in bundled resources');
        } finally {
          if (previous === undefined) delete process.env.CRAFT_RESOURCES_BASE;
          else process.env.CRAFT_RESOURCES_BASE = previous;
          rmSync(root, { recursive: true, force: true });
        }
      });
    }
  }
});

// Import in a fresh process: builtin-sources resolves its fallback at module load.
test('doctor fallback ignores a shadow tools directory in the process cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-doctor-cwd-'));
  try {
    for (const slug of ['lottie', 'video-studio']) mkdirSync(join(root, 'tools', slug), { recursive: true });
    const env = { ...process.env };
    delete env.CRAFT_APP_ROOT;
    delete env.CRAFT_RESOURCES_BASE;
    const modulePath = fileURLToPath(new URL('../sources/builtin-sources.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['-e', `import {getLottiePath,getVideoStudioPath} from ${JSON.stringify(modulePath)};console.log(JSON.stringify([getLottiePath(),getVideoStudioPath()]));`], { cwd: root, env, encoding: 'utf-8' });
    expect(result.status).toBe(0);
    const paths = JSON.parse(result.stdout) as string[];
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      expect(path.startsWith(root)).toBe(false);
      expect(existsSync(path)).toBe(true);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('trusted doctor resolver loads after the Electron CommonJS transform', () => {
  const modulePath = fileURLToPath(new URL('../sources/builtin-sources.ts', import.meta.url));
  const compiled = transformSync(readFileSync(modulePath, 'utf8'), { loader: 'ts', format: 'cjs', platform: 'node', logLevel: 'silent' }).code;
  const module = { exports: {} as Record<string, () => string> };
  const require = createRequire(import.meta.url);
  runInNewContext(compiled, {
    module, exports: module.exports, __dirname: dirname(modulePath), process,
    require: (name: string) => name.includes('runtime-identity') ? { RUNTIME_IDENTITY: {} } : require(name),
  });
  expect(existsSync(module.exports.getLottiePath!())).toBe(true);
  expect(existsSync(module.exports.getVideoStudioPath!())).toBe(true);
});
