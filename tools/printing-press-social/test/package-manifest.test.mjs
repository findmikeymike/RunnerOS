import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const rootPackagePath = fileURLToPath(new URL('../package.json', import.meta.url));
const spotifyPackagePath = fileURLToPath(new URL('../spotify-cli/package.json', import.meta.url));

test('root package ships and tests the Spotify CLI', () => {
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
  const spotifyFiles = rootPackage.files.filter((entry) => entry.startsWith('spotify-cli/'));
  assert.deepEqual(spotifyFiles, [
    'spotify-cli/README.md', 'spotify-cli/HARNESS.md', 'spotify-cli/package.json', 'spotify-cli/skills', 'spotify-cli/src',
  ]);
  assert.match(rootPackage.scripts.test, /npm test --prefix spotify-cli/);
});

test('Spotify smoke remains dry-run only', () => {
  const spotifyPackage = JSON.parse(readFileSync(spotifyPackagePath, 'utf8'));
  assert.equal(spotifyPackage.scripts.test, 'node --test');
  assert.match(spotifyPackage.scripts.smoke, /--dry-run/);
  assert.doesNotMatch(spotifyPackage.scripts.smoke, /--confirm/);
});
