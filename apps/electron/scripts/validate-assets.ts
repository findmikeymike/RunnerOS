/**
 * Build validation script for bundled assets.
 *
 * Runs after build to verify all required assets exist in dist/resources/.
 * Fails the build if any assets are missing, preventing broken releases.
 *
 * Run: bun scripts/validate-assets.ts
 */

import { existsSync, readdirSync } from 'fs';

const REQUIRED_ASSET_DIRS = [
  { path: 'dist/resources/themes', minFiles: 1, description: 'preset themes' },
  { path: 'dist/resources/docs', minFiles: 1, description: 'documentation' },
  { path: 'dist/resources/permissions', minFiles: 1, description: 'default permissions' },
  { path: 'dist/resources/tool-icons', minFiles: 1, description: 'tool icons' },
];

let hasErrors = false;

console.log('Validating bundled assets...\n');

for (const { path, minFiles, description } of REQUIRED_ASSET_DIRS) {
  if (!existsSync(path)) {
    console.error(`❌ MISSING: ${path} (${description})`);
    hasErrors = true;
    continue;
  }

  const files = readdirSync(path);
  if (files.length < minFiles) {
    console.error(`❌ EMPTY: ${path} has ${files.length} files, expected at least ${minFiles}`);
    hasErrors = true;
    continue;
  }

  console.log(`✓ ${path} (${files.length} files)`);
}

console.log('');

if (hasErrors) {
  console.error('❌ Asset validation FAILED - some required assets are missing!');
  console.error('   Make sure resources/ folder contains all required assets.');
  process.exit(1);
}

console.log('✅ All required assets validated successfully');
