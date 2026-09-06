#!/usr/bin/env bun
/**
 * Refuse to package an app that will die at boot.
 *
 * sharp's JavaScript is bundled into main.cjs, but its native binaries ship as
 * per-platform optional packages under node_modules/@img. electron-builder
 * copies those via extraResources — and copies nothing, silently, if they were
 * never installed for the platform/arch being built. bun installs only the
 * host's by default, so a cross-arch build produces a package that fails with
 *   Could not load the "sharp" module using the darwin-x64 runtime
 * the first time the artwork tools load. That is exactly what shipped on
 * 2026-09-05. This gate makes it a build error instead.
 *
 *   bun run scripts/gate-sharp-natives.ts gate [--platform darwin|win32|linux] [--arch arm64|x64]
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const platform = arg('--platform') ?? process.platform;
const arch = arg('--arch') ?? process.arch;
const command = process.argv[2] === 'gate' ? 'gate' : process.argv[2];

if (command !== 'gate') {
  console.log([
    'Usage:',
    '  gate [--platform darwin|win32|linux] [--arch arm64|x64]',
    '',
    'Checks that the sharp native packages for the target exist under node_modules/@img.',
  ].join('\n'));
  process.exit(command ? 1 : 0);
}

// sharp on Windows bundles libvips inside the runtime package; darwin and linux
// keep libvips in a sibling package. Both must be present where applicable.
const required = [`sharp-${platform}-${arch}`];
if (platform !== 'win32') required.push(`sharp-libvips-${platform}-${arch}`);

const missing = required.filter((name) => !existsSync(join(root, 'node_modules', '@img', name)));

const payload = {
  ok: missing.length === 0,
  platform,
  arch,
  required,
  missing,
  hint: missing.length
    ? `Install sharp for ${platform}-${arch} from the repository root before packaging. `
      + 'For a cross-arch build see https://sharp.pixelplumbing.com/install#cross-platform.'
    : undefined,
};
console.log(JSON.stringify(payload, null, 2));
if (missing.length) process.exit(1);
