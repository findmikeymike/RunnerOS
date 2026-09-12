import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

const sandboxHome = mkdtempSync(join(tmpdir(), 'secure-storage-home-'));
const originalProductVariant = process.env.CRAFT_PRODUCT_VARIANT;
const originalConfigDir = process.env.CRAFT_CONFIG_DIR;

mock.module('os', () => ({
  ...os,
  homedir: () => sandboxHome,
}));

process.env.CRAFT_PRODUCT_VARIANT = 'runner';
process.env.CRAFT_CONFIG_DIR = join(sandboxHome, '.craft-agent');
const { SecureStorageBackend } = await import(`./secure-storage.ts?secure-storage-test=${process.pid}-${Date.now()}`);
if (originalProductVariant === undefined) delete process.env.CRAFT_PRODUCT_VARIANT;
else process.env.CRAFT_PRODUCT_VARIANT = originalProductVariant;
if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
else process.env.CRAFT_CONFIG_DIR = originalConfigDir;

afterAll(() => {
  rmSync(sandboxHome, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(sandboxHome, '.craft-agent'), { recursive: true, force: true });
});

function writeUnreadableSafeStorageStore(): { credentialsFile: string; original: Buffer } {
  const credentialsDir = join(sandboxHome, '.craft-agent');
  const credentialsFile = join(credentialsDir, 'credentials.enc');
  const keyFile = join(credentialsDir, 'credentials.key');
  mkdirSync(credentialsDir, { recursive: true });

  const header = Buffer.alloc(64);
  Buffer.from('CRAFT01\0').copy(header, 0);
  randomBytes(32).copy(header, 12);
  const original = Buffer.concat([
    header,
    randomBytes(12),
    randomBytes(16),
    Buffer.from('not-decryptable'),
  ]);

  writeFileSync(credentialsFile, original, { mode: 0o600 });
  writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  return { credentialsFile, original };
}

describe('SecureStorageBackend', () => {
  test('refuses to overwrite an existing store that cannot be unlocked', async () => {
    const { credentialsFile, original } = writeUnreadableSafeStorageStore();
    const backend = new SecureStorageBackend();

    await expect(backend.get({ type: 'user_secret', name: 'EXISTING_SECRET' })).resolves.toBeNull();
    await expect(backend.set(
      { type: 'user_secret', name: 'NEW_SECRET' },
      { value: 'new-secret-value', source: 'user' }
    )).rejects.toThrow('cannot be unlocked');
    expect(readFileSync(credentialsFile).toString('base64')).toBe(original.toString('base64'));
  });

  test('serializes concurrent writes without dropping credentials', async () => {
    const backendA = new SecureStorageBackend();
    const backendB = new SecureStorageBackend();

    await Promise.all([
      backendA.set(
        { type: 'source_apikey', workspaceId: 'ws-test', sourceId: 'source-a' },
        { value: 'secret-a', source: 'native' }
      ),
      backendB.set(
        { type: 'source_apikey', workspaceId: 'ws-test', sourceId: 'source-b' },
        { value: 'secret-b', source: 'native' }
      ),
    ]);

    const reader = new SecureStorageBackend();
    await expect(reader.get({ type: 'source_apikey', workspaceId: 'ws-test', sourceId: 'source-a' })).resolves.toMatchObject({ value: 'secret-a' });
    await expect(reader.get({ type: 'source_apikey', workspaceId: 'ws-test', sourceId: 'source-b' })).resolves.toMatchObject({ value: 'secret-b' });
  });

  test('persists OAuth account metadata inside the encrypted store', async () => {
    const backend = new SecureStorageBackend();
    const id = { type: 'source_oauth' as const, workspaceId: 'ws-test', sourceId: 'gmail' };
    await backend.set(id, {
      value: 'access-token',
      refreshToken: 'refresh-token',
      accountEmail: 'artist@example.com',
      oauthScopes: [
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
      ],
    });

    await expect(new SecureStorageBackend().get(id)).resolves.toMatchObject({
      value: 'access-token',
      refreshToken: 'refresh-token',
      accountEmail: 'artist@example.com',
    });
    const encrypted = readFileSync(join(sandboxHome, '.craft-agent', 'credentials.enc'), 'utf8');
    expect(encrypted).not.toContain('access-token');
    expect(encrypted).not.toContain('artist@example.com');
  });
});
