import { expect, test } from 'bun:test';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('compiled CommonJS resolves real tools via packaged roots and checkout cwd, and runs offline help', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'signals-cjs-tool-'));
  const root = resolve(import.meta.dir, '../../../..');
  const output = join(directory, 'tool-path.cjs');
  try {
    const result = await build({ entryPoints: [join(import.meta.dir, 'tool-path.ts')], outfile: output, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
    expect(result.warnings).toHaveLength(0);
    for (const source of ['resources', 'app', 'repo-cwd', 'server-cwd', 'electron-cwd', 'electron-host']) {
      const env = { ...process.env, CRAFT_IS_PACKAGED: ['resources', 'app'].includes(source) ? '1' : '0',
        CRAFT_RESOURCES_BASE: source === 'resources' ? root : source === 'electron-host' ? join(root, 'apps/electron') : '',
        CRAFT_APP_ROOT: source === 'app' ? root : source === 'electron-host' ? join(root, 'apps/electron') : '' };
      const cwd = source === 'repo-cwd' ? root : source === 'server-cwd' ? join(root, 'packages/server-core')
        : source === 'electron-cwd' ? join(root, 'apps/electron') : directory;
      for (const name of ['youtube-research', 'youtube-intelligence']) {
        const stdout = execFileSync('node', ['-e', `const {resolveSignalToolPath}=require(process.argv[1]); const {execFileSync}=require('node:child_process'); const path=resolveSignalToolPath(process.argv[2]); process.stdout.write(execFileSync(process.execPath,[path,'--help'],{encoding:'utf8',timeout:15000}));`, output, name], { cwd, env, encoding: 'utf8', timeout: 20_000 });
        expect(stdout.toLowerCase()).toContain('usage');
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60_000);

test('compiled lookup rejects unrelated ancestors, untrusted cwd fallbacks and escaped tools', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'signals-tool-trust-'));
  const output = join(directory, 'tool-path.cjs');
  const checkout = resolve(import.meta.dir, '../../../..');
  const script = 'try { process.stdout.write(require(process.argv[1]).resolveSignalToolPath("youtube-research")); } catch { process.stdout.write("unavailable"); }';
  const lookup = (cwd: string, resources = '', app = '', packaged = '0') => execFileSync('node', ['-e', script, output], {
    cwd, env: { ...process.env, CRAFT_RESOURCES_BASE: resources, CRAFT_APP_ROOT: app, CRAFT_IS_PACKAGED: packaged }, encoding: 'utf8', timeout: 5000,
  });
  try {
    await build({ entryPoints: [join(import.meta.dir, 'tool-path.ts')], outfile: output, bundle: true, format: 'cjs', platform: 'node', logLevel: 'silent' });
    const toolDir = join(directory, 'tools/youtube-research/bin');
    const child = join(directory, 'artist/workspace');
    mkdirSync(toolDir, { recursive: true }); mkdirSync(child, { recursive: true });
    const tool = join(toolDir, 'youtube-research.mjs'); writeFileSync(tool, 'throw new Error("must never execute");');
    expect(lookup(child)).toBe('unavailable');
    expect(lookup(directory)).toBe('unavailable');
    expect(lookup(checkout, join(directory, 'missing'))).toBe('unavailable');
    expect(lookup(checkout, '', '', '1')).toBe('unavailable');
    expect(lookup(child, directory, '', '1')).toBe(realpathSync(tool));
    const escaped = join(directory, 'packaged'); mkdirSync(escaped);
    symlinkSync(join(directory, 'tools'), join(escaped, 'tools'), 'dir');
    expect(lookup(child, escaped, '', '1')).toBe('unavailable');
    const app = join(directory, 'valid-app');
    mkdirSync(join(app, 'tools/youtube-research/bin'), { recursive: true });
    const fallback = join(app, 'tools/youtube-research/bin/youtube-research.mjs'); writeFileSync(fallback, '// trusted app fallback');
    expect(lookup(child, escaped, app, '1')).toBe(realpathSync(fallback));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
