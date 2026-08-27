import { app, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity';
import { isUuidV4 } from '@craft-agent/shared/licensing';
import type { DesktopLicenseRecordStore, DesktopLicenseRecordV1, InstallationIdentityStore } from '@craft-agent/server-core/licensing';

const OWNER = 'artistos_license';
const APP_DATA_DIR = resolve(RUNTIME_IDENTITY.dataRoot);
const ROOT = join(APP_DATA_DIR, 'licensing');
const INSTALLATION_PATH = join(ROOT, 'installation.json');
const LICENSE_PATH = join(ROOT, `${OWNER}.bin`);

export class ElectronInstallationIdentityStore implements InstallationIdentityStore {
  async getOrCreate(): Promise<string> {
    ensureRoot();
    if (exists(INSTALLATION_PATH)) {
      const value = readNoFollow(INSTALLATION_PATH, 1024).toString('utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(value); } catch { parsed = null; }
      if (!isExactInstallation(parsed)) {
        renameSync(INSTALLATION_PATH, join(ROOT, `installation.corrupt-${randomUUID()}.json`));
        throw new Error('Invalid installation identity');
      }
      return parsed.installationId;
    }
    const installationId = randomUUID();
    atomicWrite(INSTALLATION_PATH, Buffer.from(JSON.stringify({ schemaVersion: 1, installationId }) + '\n'), false);
    return installationId;
  }
}

export class ElectronProtectedLicenseStore implements DesktopLicenseRecordStore {
  async read(): Promise<unknown | null> {
    ensureProtectedStorage();
    ensureRoot();
    if (!exists(LICENSE_PATH)) return null;
    const encrypted = readNoFollow(LICENSE_PATH, 64 * 1024);
    try {
      return JSON.parse(safeStorage.decryptString(encrypted));
    } catch {
      throw new Error('Protected license record cannot be decrypted');
    }
  }

  async write(record: DesktopLicenseRecordV1): Promise<void> {
    ensureProtectedStorage();
    ensureRoot();
    const encrypted = safeStorage.encryptString(JSON.stringify(record));
    atomicWrite(LICENSE_PATH, encrypted, true);
  }

  async remove(): Promise<void> {
    ensureProtectedStorage();
    ensureRoot();
    if (!exists(LICENSE_PATH)) return;
    const root = pinRoot();
    const stat = lstatSync(LICENSE_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Licensing record is unsafe');
    assertRoot(root);
    unlinkSync(LICENSE_PATH);
  }

  async quarantine(): Promise<void> {
    ensureRoot();
    if (!exists(LICENSE_PATH)) return;
    const root = pinRoot();
    const stat = lstatSync(LICENSE_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Licensing record is unsafe');
    const quarantine = join(ROOT, `${OWNER}.corrupt-${randomUUID()}.bin`);
    assertRoot(root);
    renameSync(LICENSE_PATH, quarantine);
  }
}

function ensureProtectedStorage(): void {
  if (app.isPackaged && !safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage is required for packaged licensing');
  }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Electron safeStorage is unavailable');
}

function ensureRoot(): void {
  assertPathWithinRoot(APP_DATA_DIR, ROOT, 'Licensing root');
  if (!exists(ROOT)) mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const stat = lstatSync(ROOT);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Licensing root is unsafe');
}

function readNoFollow(path: string, limit: number): Buffer {
  const root = pinRoot();
  assertPathWithinRoot(ROOT, path, 'Licensing record');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > limit) throw new Error('Licensing record is unsafe');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || !opened.isFile()) throw new Error('Licensing record changed during read');
    const bytes = readFileSync(fd);
    if (bytes.byteLength !== stat.size) throw new Error('Licensing record changed during read');
    assertRoot(root);
    return bytes;
  } finally { closeSync(fd); }
}

function atomicWrite(path: string, bytes: Buffer, replace: boolean): void {
  const root = pinRoot();
  assertPathWithinRoot(ROOT, path, 'Licensing record');
  if (exists(path)) {
    const stat = lstatSync(path);
    if (!replace || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Licensing record is unsafe');
  }
  const temporary = join(ROOT, `.${OWNER}-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    assertRoot(root);
    renameSync(temporary, path);
    const rootFd = openSync(ROOT, constants.O_RDONLY);
    try { fsyncSync(rootFd); } finally { closeSync(rootFd); }
  } catch (error) {
    if (exists(temporary)) unlinkSync(temporary);
    throw error;
  }
}

interface PinnedRoot { realpath: string; dev: number; ino: number }

function pinRoot(): PinnedRoot {
  const stat = lstatSync(ROOT);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Licensing root is unsafe');
  return { realpath: realpathSync(ROOT), dev: stat.dev, ino: stat.ino };
}

function assertRoot(expected: PinnedRoot): void {
  const current = pinRoot();
  if (current.realpath !== expected.realpath || current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('Licensing root changed during operation');
  }
}

function isExactInstallation(input: unknown): input is { schemaVersion: 1; installationId: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return Object.keys(record).sort().join('\0') === ['installationId', 'schemaVersion'].join('\0')
    && record.schemaVersion === 1 && isUuidV4(record.installationId);
}

function exists(path: string): boolean {
  try { lstatSync(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertPathWithinRoot(rootPath: string, candidatePath: string, label: string): void {
  const rel = relative(resolve(rootPath), resolve(candidatePath));
  if (rel === '' || (!rel.startsWith('..') && !rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`))) return;
  throw new Error(`${label} escapes its owned data root`);
}
