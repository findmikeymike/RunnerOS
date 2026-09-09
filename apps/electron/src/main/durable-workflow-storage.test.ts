import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDurableKey } from '@craft-agent/shared/durable-execution';
import { createElectronDurableProtection } from './durable-workflow-storage';

function fixture() {
  let ready = true, available = true, backend = 'keychain', locked = false;
  const runtime = { app: { isReady: () => ready }, safeStorage: {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    // Synthetic envelope only; no operating-system protection claim.
    encryptString(value: string) { if (locked) throw new Error('keychain locked'); return Buffer.from(`fixture:${value}`); },
    decryptString(value: Buffer) { if (locked) throw new Error('keychain locked'); return value.toString().slice(8); },
  } };
  return { protection: createElectronDurableProtection(runtime), setReady: (v: boolean) => ready = v,
    setAvailable: (v: boolean) => available = v, setBackend: (v: string) => backend = v, lock: () => locked = true };
}

test('refuses early startup, unavailable encryption and plaintext backend', () => {
  const f = fixture(); f.setReady(false);
  expect(() => f.protection.isEncryptionAvailable()).toThrow('not-ready');
  f.setReady(true); f.setAvailable(false);
  expect(() => f.protection.encryptString('secret')).toThrow('unavailable');
  f.setAvailable(true); f.setBackend('basic_text');
  expect(() => f.protection.decryptString(Buffer.from('secret'))).toThrow('unavailable');
});

test('rechecks storage availability after construction', () => {
  const f = fixture(); expect(f.protection.isEncryptionAvailable()).toBe(true);
  f.setAvailable(false);
  expect(() => f.protection.encryptString('secret')).toThrow('unavailable');
  expect(() => f.protection.decryptString(Buffer.from('secret'))).toThrow('unavailable');
});

test('reopens the same protected key and preserves its envelope when the keychain locks', () => {
  const root = mkdtempSync(join(tmpdir(), 'artist-electron-key-')), f = fixture();
  const keys: Buffer[] = [];
  try {
    keys.push(loadDurableKey(root, f.protection));
    const path = join(root, 'durable-execution/key.envelope'), envelope = readFileSync(path);
    keys.push(loadDurableKey(root, f.protection)); expect(keys[1]).toEqual(keys[0]);
    f.lock(); expect(() => loadDurableKey(root, f.protection)).toThrow('keychain locked');
    expect(readFileSync(path)).toEqual(envelope);
  } finally { keys.forEach(key => key.fill(0)); rmSync(root, { recursive: true, force: true }); }
});
