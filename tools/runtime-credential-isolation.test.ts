import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '..');
const googleWrapper = join(repoRoot, 'tools', 'google-ads', 'bin', 'google-ads.mjs');
const youtubeWrapper = join(repoRoot, 'tools', 'youtube-research', 'bin', 'youtube-research.mjs');
const intelligenceWrapper = join(repoRoot, 'tools', 'youtube-intelligence', 'bin', 'youtube-intelligence.mjs');
const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

function sandbox(): string {
  const path = mkdtempSync(join(tmpdir(), 'tool-credential-isolation-'));
  sandboxes.push(path);
  return path;
}

function cleanEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]): value is string => typeof value === 'string'),
  );
  for (const key of [
    'CRAFT_INTEGRATION_CACHE_ROOT',
    'GOOGLE_ADS_ACCESS_TOKEN',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
    'YOUTUBE_API_KEY',
    'SUPADATA_API_KEY',
  ]) delete env[key];
  return env;
}

function fakeBinary(root: string): string {
  const path = join(root, 'capture-env.mjs');
  writeFileSync(path, `#!/usr/bin/env node
console.log(JSON.stringify({
  googleAccess: process.env.GOOGLE_ADS_ACCESS_TOKEN || null,
  googleDeveloper: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null,
  googleCustomer: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null,
  youtube: process.env.YOUTUBE_API_KEY || null
}));
`);
  chmodSync(path, 0o755);
  return path;
}

function runJson(command: string[], env: Record<string, string>): unknown {
  const result = Bun.spawnSync(command, { env, stdout: 'pipe', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return JSON.parse(result.stdout.toString().trim());
}

describe('managed tool credential-cache boundary', () => {
  test('Artist OS wrappers never fall back to Runner caches under HOME', () => {
    const root = sandbox();
    const home = join(root, 'home');
    const binary = fakeBinary(root);
    const googleLegacy = join(home, '.config', 'runneros', 'google-ads');
    const youtubeLegacy = join(home, '.config', 'runneros', 'youtube-research');
    const intelligenceLegacy = join(home, '.config', 'runneros', 'youtube-intelligence');
    mkdirSync(googleLegacy, { recursive: true });
    mkdirSync(youtubeLegacy, { recursive: true });
    mkdirSync(intelligenceLegacy, { recursive: true });
    writeFileSync(join(googleLegacy, 'credentials.json'), JSON.stringify({ accessToken: 'runner-google' }));
    writeFileSync(join(youtubeLegacy, 'credentials.json'), JSON.stringify({ apiKey: 'runner-youtube' }));
    writeFileSync(join(intelligenceLegacy, 'credentials.json'), JSON.stringify({ supadataApiKey: 'runner-supadata' }));

    const base = { ...cleanEnv(), HOME: home, CRAFT_PRODUCT_VARIANT: 'artist-os' };
    const google = runJson([process.execPath, googleWrapper], { ...base, GOOGLE_ADS_PP_CLI: binary });
    const youtube = runJson([process.execPath, youtubeWrapper], { ...base, YOUTUBE_PP_CLI: binary });
    const intelligence = runJson([process.execPath, intelligenceWrapper, 'doctor'], base) as {
      supadata: { configured: boolean; configPath: string | null };
    };

    expect(google).toEqual({ googleAccess: null, googleDeveloper: null, googleCustomer: null, youtube: null });
    expect(youtube).toEqual({ googleAccess: null, googleDeveloper: null, googleCustomer: null, youtube: null });
    expect(intelligence.supadata).toEqual({ configured: false, env: false, configPath: null });
  });

  test('wrappers consume only the cache root supplied by the active product', () => {
    const root = sandbox();
    const cacheRoot = join(root, 'artist-cache');
    const binary = fakeBinary(root);
    mkdirSync(join(cacheRoot, 'google-ads'), { recursive: true });
    mkdirSync(join(cacheRoot, 'youtube-research'), { recursive: true });
    mkdirSync(join(cacheRoot, 'youtube-intelligence'), { recursive: true });
    writeFileSync(join(cacheRoot, 'google-ads', 'credentials.json'), JSON.stringify({
      accessToken: 'artist-google',
      developerToken: 'artist-developer',
      loginCustomerId: 'artist-customer',
    }));
    writeFileSync(join(cacheRoot, 'youtube-research', 'credentials.json'), JSON.stringify({ apiKey: 'artist-youtube' }));
    writeFileSync(join(cacheRoot, 'youtube-intelligence', 'credentials.json'), JSON.stringify({ supadataApiKey: 'artist-supadata' }));

    const base = {
      ...cleanEnv(),
      CRAFT_PRODUCT_VARIANT: 'artist-os',
      CRAFT_INTEGRATION_CACHE_ROOT: cacheRoot,
    };
    const google = runJson([process.execPath, googleWrapper], { ...base, GOOGLE_ADS_PP_CLI: binary }) as Record<string, string>;
    const youtube = runJson([process.execPath, youtubeWrapper], { ...base, YOUTUBE_PP_CLI: binary }) as Record<string, string>;
    const intelligence = runJson([process.execPath, intelligenceWrapper, 'doctor'], base) as {
      supadata: { configured: boolean; env: boolean; configPath: string | null };
    };

    expect(google.googleAccess).toBe('artist-google');
    expect(google.googleDeveloper).toBe('artist-developer');
    expect(google.googleCustomer).toBe('artist-customer');
    expect(youtube.youtube).toBe('artist-youtube');
    expect(intelligence.supadata.configured).toBe(true);
    expect(intelligence.supadata.configPath).toBe(join(cacheRoot, 'youtube-intelligence', 'credentials.json'));
  });
});
