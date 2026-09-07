import { expect, test } from 'bun:test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('compiled CommonJS resolves real tools via packaged roots and checkout cwd, and runs offline help', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'signals-cjs-tool-'));
  const root = resolve(import.meta.dir, '../../../..');
  const output = join(directory, 'tool-path.cjs');
  try {
    const result = await build({ entryPoints: [join(import.meta.dir, 'tool-path.ts')], outfile: output, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
    expect(result.warnings).toHaveLength(0);
    for (const source of ['resources', 'app', 'cwd']) {
      const env = { ...process.env, CRAFT_RESOURCES_BASE: source === 'resources' ? root : '', CRAFT_APP_ROOT: source === 'app' ? root : '' };
      const cwd = source === 'cwd' ? join(root, 'packages/server-core') : directory;
      for (const name of ['youtube-research', 'youtube-intelligence']) {
        const stdout = execFileSync('node', ['-e', `const {resolveSignalToolPath}=require(process.argv[1]); const {execFileSync}=require('node:child_process'); const path=resolveSignalToolPath(process.argv[2]); process.stdout.write(execFileSync(process.execPath,[path,'--help'],{encoding:'utf8',timeout:15000}));`, output, name], { cwd, env, encoding: 'utf8', timeout: 20_000 });
        expect(stdout.toLowerCase()).toContain('usage');
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60_000);
