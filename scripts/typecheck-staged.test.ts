import { test, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.each(['ts', 'mjs', 'cjs'])('staged check skips documentation and checks staged %s code', (extension) => {
  const root = mkdtempSync(join(tmpdir(), 'typecheck-staged-'));
  const script = join(import.meta.dir, 'typecheck-staged.sh');
  try {
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: root });
      expect(result.exitCode).toBe(0);
    };
    git('init', '-q');
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'calls');
    writeFileSync(join(bin, 'bun'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CHECK_CALLS"\n');
    chmodSync(join(bin, 'bun'), 0o755);
    const run = () => Bun.spawnSync(['bash', script], { cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CHECK_CALLS: log } });
    writeFileSync(join(root, 'notes.md'), 'documentation');
    git('add', 'notes.md');
    expect(run().exitCode).toBe(0);
    writeFileSync(join(root, `module with spaces.${extension}`), 'export {};');
    git('add', `module with spaces.${extension}`);
    expect(run().exitCode).toBe(0);
    expect(readFileSync(log, 'utf8')).toBe('run check:dependency-containment\nrun typecheck:all\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
