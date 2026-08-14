#!/usr/bin/env bun

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const variant = Bun.argv[2] ?? 'runner';
if (variant !== 'runner' && variant !== 'artist-os') {
  throw new Error(`Unknown WebUI product variant: ${variant}`);
}

const repoRoot = join(import.meta.dir, '..');
const outputDir = join(repoRoot, 'apps', 'webui', 'dist');
if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });

const child = Bun.spawn([
  'bun',
  'run',
  'vite',
  'build',
  '--config',
  'apps/webui/vite.config.ts',
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    CRAFT_PRODUCT_VARIANT: variant,
    VITE_CRAFT_PRODUCT_VARIANT: variant,
    NODE_OPTIONS: '--max-old-space-size=4096',
  },
  stdout: 'inherit',
  stderr: 'inherit',
});

process.exit(await child.exited);
