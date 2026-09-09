import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export interface DurableSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
export function privateDurableDirectory(configRoot: string): string {
  if (!isAbsolute(configRoot)) throw new Error('absolute-config-root-required');
  const directory = join(configRoot, 'durable-execution');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error('unsafe-durable-directory');
  chmodSync(directory, 0o700);
  return directory;
}
/** OS protected envelope only. A locked keychain is an error, never a new key. */
export function loadDurableKey(configRoot: string, protection: DurableSafeStorage): Buffer {
  if (!protection.isEncryptionAvailable() || protection.getSelectedStorageBackend?.() === 'basic_text') throw new Error('durable-secure-storage-unavailable');
  const directory = privateDurableDirectory(configRoot);
  const path = join(directory, 'key.envelope');
  const read = () => {
    if (lstatSync(path).isSymbolicLink()) throw new Error('unsafe-key-path');
    chmodSync(path, 0o600);
    const encoded = protection.decryptString(readFileSync(path));
    if (!/^[a-f0-9]{64}$/.test(encoded)) throw new Error('invalid-durable-key');
    return Buffer.from(encoded, 'hex');
  };
  if (existsSync(path)) return read();
  if (existsSync(join(directory, 'journal.sqlite'))) throw new Error('durable-key-missing');
  const temporary = join(directory, `.key-${process.pid}-${randomBytes(8).toString('hex')}`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, protection.encryptString(randomBytes(32).toString('hex')));
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    try { linkSync(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const directoryFd = openSync(directory, 'r');
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  } finally { unlinkSync(temporary); }
  return read();
}
