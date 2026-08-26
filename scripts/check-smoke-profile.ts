import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const artistPath = join(root, 'smoke/local/artist-context.md');
const campaignPath = join(root, 'smoke/local/campaign-context.md');
const servicePath = join(root, 'smoke/local/service-profile.md');

type Check = {
  label: string;
  path: string;
};

const checks: Check[] = [
  { label: 'artist context', path: artistPath },
  { label: 'campaign context', path: campaignPath },
  { label: 'service profile', path: servicePath },
];

function looksFilled(path: string): boolean {
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return text
    .split(/\r?\n/)
    .some((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('##')) return false;
      if (!trimmed.startsWith('-')) return false;
      return !trimmed.endsWith(':') && !trimmed.endsWith(': [ ]');
    });
}

const present = checks.filter((check) => existsSync(check.path));
const filled = checks.filter((check) => looksFilled(check.path));

console.log('Smoke profile check');
for (const check of checks) {
  const exists = existsSync(check.path);
  const status = exists ? (looksFilled(check.path) ? 'filled' : 'blank') : 'missing';
  console.log(`${status.padStart(7)}  ${check.label}`);
}

if (present.length < checks.length) {
  console.log('');
  console.log(
    'Create missing local files from smoke/templates/. These files describe what to test; they do not store keys.',
  );
}

if (filled.length === 0) {
  console.log('');
  console.log('No filled local smoke context detected yet.');
}

console.log('');
console.log('Keys should be added through the app UI. App-entered credentials persist outside the repo in ~/.trade-god/credentials.enc.');
