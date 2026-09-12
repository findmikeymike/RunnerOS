import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { StoredConfig } from './storage.ts';

const BACKUP_NAME = /^config\.json\.bak-\d{4}-\d{2}-\d{2}$/;

function parseSnapshot(raw: string): StoredConfig {
  const value = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!value || !Array.isArray(value.workspaces)
    || value.workspaces.some((workspace: unknown) => !workspace || typeof workspace !== 'object'
      || ['id', 'name', 'rootPath'].some(key => typeof (workspace as Record<string, unknown>)[key] !== 'string'
        || !(workspace as Record<string, string>)[key]?.trim())
      || ('slug' in workspace && typeof workspace.slug !== 'string'))) {
    throw new Error('Invalid app workspace registry');
  }
  return value;
}

function isPresent(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function readSnapshot(path: string): { raw: string; config: StoredConfig } {
  if (!lstatSync(path).isFile()) throw new Error('App config snapshot must be a regular file');
  const raw = readFileSync(path, 'utf8');
  return { raw, config: parseSnapshot(raw) };
}

/** Flush bytes before publication; interrupted writes never expose a partial snapshot. */
export function writeConfigSnapshot(path: string, raw: string): void {
  parseSnapshot(raw);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    // Windows does not support opening directories through this fs API.
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally { rmSync(temporary, { force: true }); }
}

function preserveEvidence(path: string): void {
  if (!lstatSync(path).isFile()) throw new Error('App config evidence must be a regular file');
  const raw = readFileSync(path);
  const evidence = `${path}.corrupt-${randomUUID()}`;
  const fd = openSync(evidence, 'wx', 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
}

function backupNames(path: string): string[] {
  const dir = dirname(path);
  return existsSync(dir) ? readdirSync(dir).filter(name => BACKUP_NAME.test(name)).sort().reverse() : [];
}

/** Recover only from a validated snapshot; absence and corruption are distinct. */
export function readConfigSnapshot(path: string): StoredConfig | null {
  const present = isPresent(path);
  if (present) {
    try { return readSnapshot(path).config; } catch { /* inspect recovery copies below */ }
  }
  const backups = backupNames(path);
  for (const name of backups) {
    let snapshot: ReturnType<typeof readSnapshot>;
    try { snapshot = readSnapshot(join(dirname(path), name)); } catch { continue; }
    // Keep the original in place until replacement is fully written. An I/O
    // failure must not fall through into first-run setup or an older snapshot.
    if (present) preserveEvidence(path);
    writeConfigSnapshot(path, snapshot.raw);
    return snapshot.config;
  }
  if (present || backups.length) throw new Error('App config could not be recovered; original config and snapshots were preserved.');
  return null;
}

/** Retain the first valid snapshot of each day, never rotating good copies for corrupt data. */
export function backupConfigSnapshot(path: string, now = new Date()): void {
  if (!isPresent(path)) return;
  const snapshot = readSnapshot(path);
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dated = join(dirname(path), `config.json.bak-${stamp}`);
  let existingValid = false;
  if (isPresent(dated)) {
    try { readSnapshot(dated); existingValid = true; } catch { preserveEvidence(dated); }
  }
  if (!existingValid) writeConfigSnapshot(dated, snapshot.raw);
  const valid = backupNames(path).filter(name => {
    try { readSnapshot(join(dirname(path), name)); return true; } catch { return false; }
  });
  for (const name of valid.slice(3)) rmSync(join(dirname(path), name));
}
