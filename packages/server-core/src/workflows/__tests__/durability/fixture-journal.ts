/** P-01 synthetic proof only. Not exported by, or connected to, the product runtime. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

interface Statement {
  run(...args: any[]): { changes: number | bigint };
  get(...args: any[]): any;
  all(...args: any[]): any[];
}
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
export function openDatabase(path: string): Database {
  // Same runtime selection as the existing escalation store; no new native dependency.
  const moduleId = [process.versions.bun ? 'bun' : 'node', 'sqlite'].join(':');
  const binding = require(moduleId);
  return new (binding.Database ?? binding.DatabaseSync)(path);
}

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) throw new Error('invalid-canonical-input');
    return '[' + value.map(canonical).join(',') + ']';
  }
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  throw new Error('invalid-canonical-input');
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');

export type EffectClass = 'read' | 'idempotent-external' | 'nonreplayable-external';
export interface Contract { tool: string; version: number; effect: EffectClass; resultVersion: number }
export interface Operation {
  id: string; contract: Contract; request: unknown; requestDigest: string;
  status: 'prepared' | 'dispatched' | 'unknown' | 'succeeded';
  attempts: number; reserved: number; result?: unknown;
}
export interface FixtureRun {
  id: string; workspace: string; account: string; contract: Contract;
  state: 'running' | 'waiting-approval' | 'paused' | 'cancelled' | 'needs-attention' | 'succeeded';
  allowed: boolean; deadline: number; budget: number;
  operations: Record<string, Operation>;
  approval?: { digest: string; expires: number; decision?: 'approve' | 'deny'; consumed: boolean };
  child?: { id: string; joined: boolean; result?: unknown[] };
  output?: unknown;
}
export interface RunRow { id: string; workspace: string; epoch: number; version: number; pid: number; payload: string }
export const manifest: Readonly<Record<string, Contract>> = Object.freeze({
  model: Object.freeze({ tool: 'model', version: 1, effect: 'read', resultVersion: 1 }),
  read: Object.freeze({ tool: 'read', version: 1, effect: 'read', resultVersion: 1 }),
  effect: Object.freeze({ tool: 'effect', version: 1, effect: 'idempotent-external', resultVersion: 1 }),
  opaque: Object.freeze({ tool: 'opaque', version: 1, effect: 'nonreplayable-external', resultVersion: 1 }),
});
export function certify(contract: Contract): void {
  if (!manifest[contract.tool] || digest(manifest[contract.tool]) !== digest(contract)) throw new Error('uncertified-adapter');
}

export class FixtureJournal {
  readonly db: Database;
  readonly path: string;
  constructor(readonly root: string, private readonly key: Buffer) {
    const rel = relative(realpathSync(tmpdir()), realpathSync(root));
    if (!rel.startsWith('artist-os-durability-') || rel.split(sep).includes('..') || !existsSync(join(root, 'fixture-only'))) throw new Error('disposable-fixture-root-required');
    if (key.length !== 32) throw new Error('fixture-key-required');
    chmodSync(root, 0o700);
    this.path = join(root, 'journal.sqlite');
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(this.path + suffix) && lstatSync(this.path + suffix).isSymbolicLink()) throw new Error('unsafe-storage-path');
    }
    this.db = openDatabase(this.path);
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get().user_version);
      if (version !== 0 && version !== 1) throw new Error('unsupported-schema');
      this.db.exec('PRAGMA busy_timeout=150; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, pid INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(run_id, seq));
        CREATE TABLE IF NOT EXISTS outbox(run_id TEXT NOT NULL REFERENCES runs(id), event_key TEXT NOT NULL, ack INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(run_id, event_key));
        CREATE TABLE IF NOT EXISTS commands(run_id TEXT NOT NULL REFERENCES runs(id), command_id TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(run_id, command_id));
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;`);
      if (this.db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('corrupt-storage');
      this.checkStorage();
    } catch (error) { this.db.close(); throw error; }
  }
  checkStorage(): void {
    if (this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal' || Number(this.db.prepare('PRAGMA synchronous').get().synchronous) !== 2 || Number(this.db.prepare('PRAGMA foreign_keys').get().foreign_keys) !== 1) throw new Error('unsafe-storage-mode');
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(this.path + suffix)) {
      chmodSync(this.path + suffix, 0o600);
      if ((statSync(this.path + suffix).mode & 0o777) !== 0o600) throw new Error('unsafe-storage-permissions');
    }
  }
  private seal(run: FixtureRun): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`${run.workspace}:${run.id}:1`));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(run)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  decode(row: RunRow): FixtureRun {
    const bytes = Buffer.from(row.payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${row.workspace}:${row.id}:1`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  }
  row(id: string, workspace: string): RunRow {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=? AND workspace=?').get(id, workspace);
    if (!row) throw new Error('run-not-found');
    return row;
  }
  read(id: string, workspace = 'fixture'): FixtureRun { return this.decode(this.row(id, workspace)); }
  transaction<T>(fn: () => T): T {
    this.checkStorage();
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) {
      // SQLITE_FULL/IOERR can already have rolled the transaction back. Preserve
      // the storage cause instead of replacing it with "no transaction is active".
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    }
  }
  admit(run: FixtureRun, insideTransaction?: () => void): void {
    certify(run.contract);
    this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM runs WHERE id=?').get(run.id) as RunRow | undefined;
      if (old) {
        const existing = this.decode(old);
        if (digest([existing.workspace, existing.account, existing.contract, existing.budget, existing.deadline]) !== digest([run.workspace, run.account, run.contract, run.budget, run.deadline])) throw new Error('admission-diverged');
        return;
      }
      this.db.prepare('INSERT INTO runs(id,workspace,payload) VALUES(?,?,?)').run(run.id, run.workspace, this.seal(run));
      insideTransaction?.(); // Synchronous fault barrier, fixture-only; never used by product code.
      this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(run.id, 0, 'admitted');
      this.db.prepare('INSERT INTO outbox(run_id,event_key) VALUES(?,?)').run(run.id, 'admitted');
    });
  }
  claim(id: string, workspace = 'fixture'): number {
    return this.transaction(() => {
      if (this.db.prepare("SELECT value FROM meta WHERE key='dispatch-disabled'").get()) throw new Error('restore-dispatch-disabled');
      const row = this.row(id, workspace);
      this.decode(row); // A missing/wrong key never resets the run or permits dispatch.
      if (row.pid) {
        let live = true;
        try { process.kill(row.pid, 0); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') live = false; }
        if (live) throw new Error('owner-active');
      }
      this.db.prepare('UPDATE runs SET epoch=epoch+1,pid=? WHERE id=? AND epoch=?').run(process.pid, id, row.epoch);
      return row.epoch + 1;
    });
  }
  update(id: string, workspace: string, epoch: number | null, kind: string, mutate: (run: FixtureRun) => void): void {
    this.transaction(() => {
      const row = this.row(id, workspace);
      if (epoch !== null && (row.epoch !== epoch || row.pid !== process.pid)) throw new Error('stale-owner');
      const run = this.decode(row);
      mutate(run);
      this.db.prepare('UPDATE runs SET payload=?,version=version+1 WHERE id=? AND version=?').run(this.seal(run), id, row.version);
      this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(id, row.version + 1, kind);
      this.db.prepare('INSERT OR IGNORE INTO outbox(run_id,event_key) VALUES(?,?)').run(id, kind + ':' + (row.version + 1));
    });
  }
  release(id: string, epoch: number): void {
    this.db.prepare('UPDATE runs SET pid=0 WHERE id=? AND epoch=? AND pid=?').run(id, epoch, process.pid);
  }
  command(id: string, workspace: string, commandId: string, action: 'approve' | 'deny' | 'cancel' | 'pause' | 'revoke', approvalDigest?: string): void {
    // The fixture controller is the sole principal. Production RPC authorization is NOT certified here.
    this.transaction(() => {
      const row = this.row(id, workspace);
      const requestDigest = digest([workspace, action, approvalDigest ?? null]);
      const prior = this.db.prepare('SELECT digest FROM commands WHERE run_id=? AND command_id=?').get(id, commandId);
      if (prior) { if (prior.digest !== requestDigest) throw new Error('command-conflict'); return; }
      const run = this.decode(row);
      if (run.state === 'succeeded' || run.state === 'cancelled') throw new Error('terminal-run');
      if (action === 'approve' || action === 'deny') {
        if (!run.approval || run.approval.digest !== approvalDigest || run.approval.expires <= Date.now() || run.approval.consumed || (run.approval.decision && run.approval.decision !== action)) throw new Error('invalid-approval');
        run.approval.decision = action;
        // A decision resolves its wait; it cannot reverse an independent Pause.
        // Same decision under a new transport command ID is still idempotent.
        if (action === 'deny') run.state = 'cancelled';
        else if (run.state === 'waiting-approval') run.state = 'running';
      } else if (action === 'revoke') run.allowed = false;
      else run.state = action === 'cancel' ? 'cancelled' : 'paused';
      this.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(id, commandId, requestDigest);
      this.db.prepare('UPDATE runs SET payload=?,version=version+1 WHERE id=?').run(this.seal(run), id);
      this.db.prepare('INSERT INTO events VALUES(?,?,?)').run(id, row.version + 1, 'command:' + action);
      this.db.prepare('INSERT INTO outbox(run_id,event_key) VALUES(?,?)').run(id, 'command:' + commandId);
    });
  }
  backup(destination: string): void {
    if (existsSync(destination)) throw new Error('backup-already-exists');
    const staged = destination + '.staged-' + randomBytes(8).toString('hex');
    try {
      this.db.prepare('VACUUM INTO ?').run(staged);
      chmodSync(staged, 0o600);
      const copy = openDatabase(staged);
      try {
        copy.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; INSERT OR REPLACE INTO meta VALUES('dispatch-disabled','1')");
      } finally { copy.close(); }
      const fd = openSync(staged, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      // Atomic no-clobber publication. A crash can leave an unpublished staged copy,
      // but every published backup is already quarantined before any reader sees it.
      linkSync(staged, destination);
    } finally { if (existsSync(staged)) unlinkSync(staged); }
  }
  close(): void { this.db.close(); }
}

export function newRun(id: string, overrides: Partial<FixtureRun> = {}): FixtureRun {
  return { id, workspace: 'fixture', account: 'synthetic-account', contract: manifest.effect!, state: 'running', allowed: true, deadline: Date.now() + 120_000, budget: 5, operations: {}, ...overrides };
}
