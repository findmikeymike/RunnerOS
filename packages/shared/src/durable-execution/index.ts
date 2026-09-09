import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DurableCheckpoint, DurableCheckpointReply, DurableExecutionBridge, DurableExecutionDescriptor, DurableJson } from '../protocol/durable-execution.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
import { privateDurableDirectory } from './key-provider.ts';
import type { DurableSteeringCommand, DurableSteeringReceipt, DurableSteeringEntry, DurableApproval, DurableToolAuthorization, DurableDecisionCommand, DurableDecisionReceipt, DurableControlCommand, DurableControlReceipt, DurableRunStatus } from '../protocol/durable-execution.ts';
export type { DurableSteeringCommand, DurableSteeringReceipt, DurableSteeringEntry, DurableApproval, DurableToolAuthorization, DurableDecisionCommand, DurableDecisionReceipt, DurableControlCommand, DurableControlReceipt } from '../protocol/durable-execution.ts';
export { loadDurableKey, type DurableSafeStorage } from './key-provider.ts';

interface Statement { run(...args: any[]): unknown; get(...args: any[]): any; all(...args: any[]): any[] }
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
function database(path: string): Database {
  const moduleId = [process.versions.bun ? 'bun' : 'node', 'sqlite'].join(':');
  const binding = require(moduleId);
  return new (binding.Database ?? binding.DatabaseSync)(path);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value) && Object.keys(value).length === value.length) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new Error('invalid-durable-json');
}
/** Resolver input must be the exact immutable payload that the journal evaluates. */
function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeJson(child); Object.freeze(value); }
  return value;
}
export const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
/** Ignore only SDK-generated message timestamps, never fields inside user/tool data. */
export function canonicalContext(context: DurableJson): DurableJson {
  const copy = JSON.parse(canonical(context));
  if (copy && !Array.isArray(copy) && Array.isArray(copy.messages)) {
    for (const message of copy.messages) if (message && typeof message === 'object' && ['user', 'assistant', 'toolResult'].includes(message.role)) delete message.timestamp;
  }
  return copy;
}
export interface DurableRunSpec extends DurableExecutionDescriptor {
  commandId: string;
  /** Trusted principal whose tool authorization must be resolved before every dispatch. */
  approvalPrincipalId?: string;
  authority: DurableJson;
  context: DurableJson;
  deadlineAt: number;
  maxModelAttempts: number;
  costPolicy: { maxTotalUnits: number; maxUnitsPerAttempt: number; unit: 'verified-free' | 'trusted-upper-bound' };
}
export interface DurableClaim { runId: string; workspaceId: string; ownerId: string; epoch: number; controlRevision: number }
interface Call { id: string; tool: string; inputDigest?: string; attempts: number; skipped?: true; result?: DurableJson }
interface Turn { continuationRevision?: number; contextDigest: string; message?: DurableJson; calls: Call[] }
export interface DurableRunSnapshot {
  spec: DurableRunSpec;
  status: DurableRunStatus;
  controlRevision: number;
  version: number;
  modelAttempts: number;
  reservedUnits: number;
  turns: Turn[];
  approvals?: DurableApproval[];
  steering?: DurableSteeringEntry[];
  continuationRevision?: number;
  boundaries?: Array<{ afterTurn: number; sequences: number[]; continuationRevision: number }>;
  failure?: string;
}
function validateControlInput(command: DurableControlCommand | DurableSteeringCommand): void {
  canonical(command);
  const fields = ['runId', 'workspaceId', 'commandId', 'expectedVersion', 'action', ...(command.action === 'steer' ? ['text'] : [])];
  if (Object.keys(command).some(key => !fields.includes(key)) || ['runId', 'workspaceId', 'commandId'].some(key => typeof (command as any)[key] !== 'string' || !(command as any)[key].trim()) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || !['pause', 'resume', 'cancel', 'steer'].includes(command.action) || command.action === 'steer' && (typeof command.text !== 'string' || !command.text.trim())) throw new Error('invalid-durable-control-command');
}
export interface DurableJournalOptions { configRoot: string; key: Buffer; ownerId?: string; isProcessAlive?: (pid: number) => boolean; maxPayloadBytes?: number }
export class DurableJournal {
  readonly path: string;
  private db: Database;
  private readonly ownerId: string;
  private readonly key: Buffer;
  private readonly alive: (pid: number) => boolean;
  private readonly maxBytes: number;
  private poisoned = false;
  constructor(options: DurableJournalOptions) {
    if (options.key.length !== 32) throw new Error('durable-key-required');
    this.key = Buffer.from(options.key);
    this.ownerId = options.ownerId ?? randomUUID();
    this.alive = options.isProcessAlive ?? (pid => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; } });
    this.maxBytes = options.maxPayloadBytes ?? 16 * 1024 * 1024;
    this.path = join(privateDurableDirectory(options.configRoot), 'journal.sqlite');
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(this.path + suffix) && lstatSync(this.path + suffix).isSymbolicLink()) throw new Error('unsafe-journal-path');
    if (!existsSync(this.path)) { try { closeSync(openSync(this.path, 'wx', 0o600)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
    this.db = database(this.path);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      if (this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal' || this.db.prepare('PRAGMA synchronous').get().synchronous !== 2 || this.db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('unsafe-sqlite-settings');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (![0, 1, 2].includes(version)) throw new Error('unsupported-durable-schema');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, command TEXT NOT NULL, spec_digest TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0, owner TEXT, pid INTEGER, payload TEXT NOT NULL, UNIQUE(workspace,command)); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL, kind TEXT NOT NULL, UNIQUE(run_id,version)); CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY REFERENCES events(sequence), acknowledged INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS control_commands (workspace TEXT NOT NULL, id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), payload TEXT NOT NULL, PRIMARY KEY(workspace,id)); PRAGMA user_version=2;');
        const keyCheck = this.db.prepare("SELECT value FROM metadata WHERE key='key-check'").get();
        if (keyCheck) { if (this.decrypt(keyCheck.value, 'key-check') !== 'artist-os-durable-v1') throw new Error('invalid-key-check'); }
        else this.db.prepare('INSERT INTO metadata VALUES (?,?)').run('key-check', this.encrypt('artist-os-durable-v1', 'key-check'));
        if (this.db.prepare("SELECT value FROM metadata WHERE key='dispatch-disabled'").get()) throw new Error('backup-dispatch-disabled');
        this.db.exec('COMMIT');
      } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
      this.permissions();
    } catch (error) { this.db.close(); throw error; }
  }
  private permissions(): void { for (const suffix of ['', '-wal', '-shm']) if (existsSync(this.path + suffix)) chmodSync(this.path + suffix, 0o600); }
  private encrypt(value: unknown, identity: string): string {
    const plain = canonical(value);
    if (Buffer.byteLength(plain) > this.maxBytes) throw new Error('durable-payload-limit');
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(identity));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  private decrypt(payload: string, identity: string): any {
    const bytes = Buffer.from(payload, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(identity)); decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
  }
  private transaction<T>(fn: () => T): T {
    if (this.poisoned) throw new Error('durable-storage-unavailable');
    try { this.db.exec('BEGIN IMMEDIATE'); } catch (error) { this.poisoned = true; throw error; }
    try { const result = fn(); this.permissions(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      if (String((error as { code?: string }).code ?? '').startsWith('SQLITE_')) this.poisoned = true;
      try { this.db.exec('ROLLBACK'); } catch { this.poisoned = true; }
      throw error;
    }
  }
  private row(runId: string, workspaceId: string): any {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=? AND workspace=?').get(runId, workspaceId);
    if (!row) throw new Error('durable-run-not-found');
    return row;
  }
  private save(state: DurableRunSnapshot, kind: string): void {
    state.version++;
    this.db.prepare('UPDATE runs SET payload=? WHERE id=?').run(this.encrypt(state, state.spec.runId), state.spec.runId);
    this.db.prepare('INSERT INTO events(run_id,version,kind) VALUES (?,?,?)').run(state.spec.runId, state.version, kind);
    this.db.prepare('INSERT INTO outbox(sequence) SELECT sequence FROM events WHERE run_id=? AND version=?').run(state.spec.runId, state.version);
  }
  admit(spec: DurableRunSpec): DurableRunSnapshot {
    canonical(spec);
    const policy = spec.costPolicy;
    if (spec.approvalPrincipalId !== undefined && (typeof spec.approvalPrincipalId !== 'string' || !spec.approvalPrincipalId.trim())) throw new Error('invalid-approval-principal');
    if (!/^[a-f0-9]{64}$/.test(spec.credentialIdentity) || !spec.runtimeManifest || Object.values(spec.runtimeManifest).some(value => typeof value !== 'string') || spec.engine !== 'sqlite-v2-readonly-1' || !spec.runId || !spec.workspaceId || !spec.commandId || !spec.model || !Number.isSafeInteger(spec.maxOutputTokens) || spec.maxOutputTokens < 1 || !Number.isSafeInteger(spec.maxModelAttempts) || spec.maxModelAttempts < 1 || !Number.isFinite(spec.deadlineAt) || !Array.isArray(spec.allowedTools) || spec.allowedTools.some(t => !['read', 'grep', 'find', 'ls'].includes(t)) || !policy || !['verified-free', 'trusted-upper-bound'].includes(policy.unit) || !Number.isSafeInteger(policy.maxTotalUnits) || !Number.isSafeInteger(policy.maxUnitsPerAttempt) || policy.maxTotalUnits < 0 || policy.maxUnitsPerAttempt < 0 || (policy.unit === 'verified-free' ? policy.maxTotalUnits !== 0 || policy.maxUnitsPerAttempt !== 0 : policy.maxUnitsPerAttempt === 0)) throw new Error('invalid-durable-admission');
    return this.transaction(() => {
      const old = this.db.prepare('SELECT * FROM runs WHERE id=? OR (workspace=? AND command=?)').all(spec.runId, spec.workspaceId, spec.commandId);
      if (old.length) { if (old.length !== 1 || old[0].id !== spec.runId || old[0].workspace !== spec.workspaceId || old[0].spec_digest !== digest(spec)) throw new Error('durable-command-conflict'); return this.decrypt(old[0].payload, spec.runId); }
      if (spec.deadlineAt <= Date.now()) throw new Error('invalid-durable-admission');
      if (digest(spec.runtimeManifest) !== digest(DURABLE_RUNTIME_MANIFEST)) throw new Error('durable-runtime-manifest-changed');
      const state: DurableRunSnapshot = { spec: JSON.parse(canonical(spec)), status: 'running', controlRevision: 0, version: 0, modelAttempts: 0, reservedUnits: 0, turns: [], approvals: [], steering: [], continuationRevision: 0, boundaries: [] };
      this.db.prepare('INSERT INTO runs(id,workspace,command,spec_digest,payload) VALUES (?,?,?,?,?)').run(spec.runId, spec.workspaceId, spec.commandId, digest(spec), this.encrypt(state, spec.runId));
      this.save(state, 'admitted'); return state;
    });
  }
  get(runId: string, workspaceId: string): DurableRunSnapshot { const state = this.decrypt(this.row(runId, workspaceId).payload, runId); state.controlRevision ??= 0; state.approvals ??= []; state.steering ??= []; state.continuationRevision ??= 0; state.boundaries ??= []; return state; }
  listInternal(workspaceId: string): DurableRunSnapshot[] { return this.db.prepare('SELECT id,payload FROM runs WHERE workspace=? ORDER BY rowid').all(workspaceId).map(row => { const state = this.decrypt(row.payload, row.id); state.controlRevision ??= 0; state.approvals ??= []; state.steering ??= []; state.continuationRevision ??= 0; state.boundaries ??= []; return state; }); }
  list(workspaceId: string): Array<{ runId: string; status: DurableRunSnapshot['status']; version: number; modelAttempts: number; reservedUnits: number }> { return this.listInternal(workspaceId).map(state => ({runId: state.spec.runId, status: state.status, version: state.version, modelAttempts: state.modelAttempts, reservedUnits: state.reservedUnits})); }
  claim(runId: string, workspaceId: string): DurableClaim {
    return this.transaction(() => {
      const row = this.row(runId, workspaceId);
      if (row.owner && this.alive(row.pid)) throw new Error('durable-run-owned');
      const state = this.get(runId, workspaceId);
      if (state.status === 'waiting-approval') throw new Error('durable-approval-required');
      if (state.status === 'paused') throw new Error('durable-run-paused');
      if (state.status !== 'running') throw new Error('durable-run-terminal');
      const epoch = row.epoch + 1;
      this.db.prepare('UPDATE runs SET owner=?,pid=?,epoch=? WHERE id=?').run(this.ownerId, process.pid, epoch, runId);
      return { runId, workspaceId, ownerId: this.ownerId, epoch, controlRevision: state.controlRevision };
    });
  }
  private fenced(claim: DurableClaim): DurableRunSnapshot {
    const row = this.row(claim.runId, claim.workspaceId);
    if (row.owner !== claim.ownerId || row.epoch !== claim.epoch || claim.ownerId !== this.ownerId) throw new Error('durable-stale-owner');
    return this.get(claim.runId, claim.workspaceId);
  }
  release(claim: DurableClaim): void { this.transaction(() => { this.fenced(claim); this.db.prepare('UPDATE runs SET owner=NULL,pid=NULL WHERE id=?').run(claim.runId); }); }
  cancel(runId: string, workspaceId: string): void { this.control(runId, workspaceId, 'cancelled'); }
  fail(runId: string, workspaceId: string, _reason: string): void { this.control(runId, workspaceId, 'failed'); }
  private control(runId: string, workspaceId: string, status: 'cancelled' | 'failed'): void { this.transaction(() => { const state = this.get(runId, workspaceId); if (state.status === 'running' || status === 'cancelled' && ['paused', 'waiting-approval'].includes(state.status)) { state.status = status; state.controlRevision++; this.save(state, status); } }); }

  controlReceipt(command: DurableControlCommand | DurableSteeringCommand): DurableControlReceipt | DurableSteeringReceipt | undefined {
    validateControlInput(command);
    this.row(command.runId, command.workspaceId);
    const prior = this.db.prepare('SELECT payload FROM control_commands WHERE workspace=? AND id=?').get(command.workspaceId, command.commandId);
    if (!prior) return undefined;
    const saved = this.decrypt(prior.payload, canonical([command.workspaceId, command.commandId]));
    if (digest(saved.command) !== digest(command)) throw new Error('durable-command-conflict');
    return saved.receipt;
  }

  command(command: DurableControlCommand): DurableControlReceipt {
    validateControlInput(command);
    if (!command.commandId || !command.runId || !command.workspaceId || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || !['pause', 'resume', 'cancel'].includes(command.action)) throw new Error('invalid-durable-control-command');
    return this.transaction(() => {
      // Resolve workspace/run authority before disclosing any old command receipt.
      const state = this.get(command.runId, command.workspaceId);
      const identity = canonical([command.workspaceId, command.commandId]);
      const prior = this.db.prepare('SELECT payload FROM control_commands WHERE workspace=? AND id=?').get(command.workspaceId, command.commandId);
      if (prior) {
        const saved = this.decrypt(prior.payload, identity);
        if (digest(saved.command) !== digest(command)) throw new Error('durable-command-conflict');
        return saved.receipt;
      }
      if (state.version !== command.expectedVersion) throw new Error('durable-control-version-conflict');
      const terminal = !['running', 'paused', 'waiting-approval'].includes(state.status);
      if (terminal && command.action !== 'cancel') throw new Error('durable-run-terminal');
      if (command.action === 'resume' && Date.now() >= state.spec.deadlineAt) throw new Error('durable-dispatch-blocked');
      if (command.action === 'resume' && digest(state.spec.runtimeManifest) !== digest(DURABLE_RUNTIME_MANIFEST)) throw new Error('durable-runtime-manifest-changed');
      // Resume never grants a pending approval. Expired waits may reopen solely to reauthorize.
      const pendingApproval = state.approvals?.some(approval => approval.status === 'pending' && approval.expiresAt > Date.now());
      const next: DurableRunStatus = command.action === 'pause' ? 'paused' : command.action === 'resume' ? (pendingApproval ? 'waiting-approval' : 'running') : 'cancelled';
      if (!terminal && state.status !== next) {
        state.status = next;
        state.controlRevision++;
        this.save(state, command.action);
      }
      const receipt: DurableControlReceipt = { runId: command.runId, workspaceId: command.workspaceId, commandId: command.commandId, action: command.action, version: state.version, status: state.status, controlRevision: state.controlRevision };
      this.db.prepare('INSERT INTO control_commands(workspace,id,run_id,payload) VALUES (?,?,?,?)').run(command.workspaceId, command.commandId, command.runId, this.encrypt({ command, receipt }, identity));
      return receipt;
    });
  }
  steer(command: DurableSteeringCommand): DurableSteeringReceipt {
    validateControlInput(command);
    if (!command.commandId || !command.runId || !command.workspaceId || command.action !== 'steer' || typeof command.text !== 'string' || !command.text.trim() || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1) throw new Error('invalid-durable-steering-command');
    return this.transaction(() => {
      const state = this.get(command.runId, command.workspaceId);
      const identity = canonical([command.workspaceId, command.commandId]);
      const prior = this.db.prepare('SELECT payload FROM control_commands WHERE workspace=? AND id=?').get(command.workspaceId, command.commandId);
      if (prior) {
        const saved = this.decrypt(prior.payload, identity);
        if (digest(saved.command) !== digest(command)) throw new Error('durable-command-conflict');
        return saved.receipt;
      }
      if (state.version !== command.expectedVersion) throw new Error('durable-control-version-conflict');
      if (!['running', 'paused', 'waiting-approval'].includes(state.status)) throw new Error('durable-run-terminal');
      const sequence = (state.continuationRevision ?? 0) + 1;
      state.continuationRevision = sequence;
      (state.steering ??= []).push({ commandId: command.commandId, sequence, text: command.text });
      for (const approval of state.approvals ?? []) {
        const call = state.turns[approval.turn]?.calls.find(call => call.id === approval.callId);
        if (call && call.attempts === 0 && ['pending', 'approved'].includes(approval.status)) approval.status = 'superseded';
      }
      if (state.status === 'waiting-approval') { state.status = 'running'; state.controlRevision++; }
      this.save(state, 'steering-queued');
      const receipt: DurableSteeringReceipt = { runId: command.runId, workspaceId: command.workspaceId, commandId: command.commandId, action: 'steer', sequence, version: state.version, status: state.status, controlRevision: state.controlRevision };
      this.db.prepare('INSERT INTO control_commands(workspace,id,run_id,payload) VALUES (?,?,?,?)').run(command.workspaceId, command.commandId, command.runId, this.encrypt({ command, receipt }, identity));
      return receipt;
    });
  }
  private authorize(state: DurableRunSnapshot, request: Extract<DurableCheckpoint, { kind: 'tool-start' }>, call: Call, inputDigest: string, authorization?: DurableToolAuthorization): { blocked: string } | undefined {
    if (!state.spec.approvalPrincipalId) return;
    if (!authorization || authorization.allowed !== true || authorization.principalId !== state.spec.approvalPrincipalId || authorization.credentialIdentity !== state.spec.credentialIdentity || typeof authorization.policyRevision !== 'string' || !authorization.policyRevision || typeof authorization.requiresApproval !== 'boolean' || !Number.isFinite(authorization.approvalExpiresAt)) {
      state.status = 'paused'; state.controlRevision++; this.save(state, 'authorization-blocked');
      return { blocked: 'durable-authorization-blocked' };
    }
    // Reuse is not dispatch, but current access must still authorize reading the cached data.
    if (call.result !== undefined || !authorization.requiresApproval) return;
    const operationId = digest([state.spec.runId, state.spec.workspaceId, request.turn, request.callId]);
    const approvals = state.approvals ??= [];
    const forOperation = approvals.filter(approval => approval.operationId === operationId);
    let approval = forOperation.at(-1);
    const sameBinding = approval && approval.inputDigest === inputDigest && approval.principalId === authorization.principalId && approval.policyRevision === authorization.policyRevision && approval.credentialIdentity === authorization.credentialIdentity;
    if (approval && sameBinding && (approval.expiresAt <= Date.now() || authorization.approvalExpiresAt <= Date.now())) approval.status = 'expired';
    if (!approval || !sameBinding || approval.status === 'expired') {
      if (approval && !sameBinding && approval.status === 'pending') approval.status = 'expired';
      approval = { id: digest([operationId, inputDigest, authorization.principalId, authorization.policyRevision, authorization.credentialIdentity, forOperation.length]), operationId,
        turn: request.turn, callId: request.callId, tool: request.tool, inputDigest, input: request.input,
        principalId: authorization.principalId, policyRevision: authorization.policyRevision, credentialIdentity: authorization.credentialIdentity,
        expiresAt: authorization.approvalExpiresAt, status: authorization.approvalExpiresAt > Date.now() ? 'pending' : 'expired' };
      approvals.push(approval);
    }
    if (approval.status === 'approved' || approval.status === 'consumed') {
      approval.status = 'consumed'; // Saved atomically with call.attempts in tool-start below.
      return;
    }
    call.inputDigest = inputDigest;
    state.status = 'waiting-approval'; state.controlRevision++; this.save(state, approval.status === 'expired' ? 'approval-expired' : 'approval-pending');
    return { blocked: approval.status === 'expired' ? 'durable-approval-expired' : 'durable-approval-required' };
  }

  /** Read an immutable acknowledgement without dispatching or reviving execution. */
  decisionReceipt(command: DurableDecisionCommand): DurableDecisionReceipt | undefined {
    canonical(command);
    if (!command.commandId || !command.runId || !command.workspaceId || !command.approvalId || !command.inputDigest || !command.principalId || !command.policyRevision || !command.credentialIdentity || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || !['approve', 'deny'].includes(command.action)) throw new Error('invalid-durable-decision-command');
    this.row(command.runId, command.workspaceId);
    const prior = this.db.prepare('SELECT payload FROM control_commands WHERE workspace=? AND id=?').get(command.workspaceId, command.commandId);
    if (!prior) return undefined;
    const saved = this.decrypt(prior.payload, canonical([command.workspaceId, command.commandId]));
    if (digest(saved.command) !== digest(command)) throw new Error('durable-command-conflict');
    return saved.receipt;
  }

  decide(command: DurableDecisionCommand): DurableDecisionReceipt {
    canonical(command);
    if (!command.commandId || !command.runId || !command.workspaceId || !command.approvalId || !command.inputDigest || !command.principalId || !command.policyRevision || !command.credentialIdentity || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || !['approve', 'deny'].includes(command.action)) throw new Error('invalid-durable-decision-command');
    const result = this.transaction((): { receipt?: DurableDecisionReceipt; blocked?: string } => {
      const state = this.get(command.runId, command.workspaceId);
      const identity = canonical([command.workspaceId, command.commandId]);
      const prior = this.db.prepare('SELECT payload FROM control_commands WHERE workspace=? AND id=?').get(command.workspaceId, command.commandId);
      if (prior) {
        const saved = this.decrypt(prior.payload, identity);
        if (digest(saved.command) !== digest(command)) throw new Error('durable-command-conflict');
        return { receipt: saved.receipt };
      }
      if (state.version !== command.expectedVersion) throw new Error('durable-control-version-conflict');
      if (!['running', 'paused', 'waiting-approval'].includes(state.status)) throw new Error('durable-run-terminal');
      const approval = state.approvals?.find(candidate => candidate.id === command.approvalId);
      if (!approval || state.approvals!.filter(candidate => candidate.operationId === approval.operationId).at(-1)?.id !== approval.id || (approval.status !== 'pending' && !(command.action === 'deny' && approval.status === 'expired'))
        || approval.inputDigest !== command.inputDigest || approval.principalId !== command.principalId || approval.policyRevision !== command.policyRevision || approval.credentialIdentity !== command.credentialIdentity
        || command.principalId !== state.spec.approvalPrincipalId || command.credentialIdentity !== state.spec.credentialIdentity) throw new Error('durable-approval-decision-mismatch');
      if (command.action === 'approve' && (approval.expiresAt <= Date.now() || state.spec.deadlineAt <= Date.now())) {
        approval.status = 'expired'; if (state.status !== 'paused') state.status = 'waiting-approval'; state.controlRevision++; this.save(state, 'approval-expired');
        return { blocked: 'durable-approval-expired' };
      }
      approval.status = command.action === 'approve' ? 'approved' : 'denied'; approval.decisionPrincipalId = command.principalId;
      if (command.action === 'deny') state.status = 'cancelled';
      else if (state.status === 'waiting-approval') state.status = 'running';
      state.controlRevision++; this.save(state, command.action === 'approve' ? 'approval-approved' : 'approval-denied');
      const receipt: DurableDecisionReceipt = { runId: command.runId, workspaceId: command.workspaceId, commandId: command.commandId, action: command.action, approvalId: approval.id, version: state.version, status: state.status, controlRevision: state.controlRevision };
      this.db.prepare('INSERT INTO control_commands(workspace,id,run_id,payload) VALUES (?,?,?,?)').run(command.workspaceId, command.commandId, command.runId, this.encrypt({ command, receipt }, identity));
      return { receipt };
    });
    if (result.blocked) throw new Error(result.blocked);
    return result.receipt!;
  }

  bridge(claim: DurableClaim, options: { authorizeTool?: (request: Extract<DurableCheckpoint, { kind: 'tool-start' }>) => Promise<DurableToolAuthorization> } = {}): DurableExecutionBridge {
    const spec = this.fenced(claim).spec;
    const descriptor: DurableExecutionDescriptor = { credentialIdentity: spec.credentialIdentity, runtimeManifest: Object.freeze({...spec.runtimeManifest}), engine: spec.engine, runId: spec.runId, workspaceId: spec.workspaceId, createdAt: spec.createdAt, allowedTools: [...spec.allowedTools], model: spec.model, maxOutputTokens: spec.maxOutputTokens };
    Object.freeze(descriptor.allowedTools); Object.freeze(descriptor);
    return Object.freeze({ descriptor, checkpoint: async (request: DurableCheckpoint) => {
      const pinned = JSON.parse(canonical(request)) as DurableCheckpoint;
      let authorization: DurableToolAuthorization | undefined;
      let authorizationFailure: unknown;
      if (pinned.kind === 'tool-start') {
        const disposition = this.checkpoint(claim, { kind: 'tool-disposition', turn: pinned.turn, callId: pinned.callId, tool: pinned.tool });
        if (disposition.skipped) return disposition;
      }
      if (pinned.kind === 'tool-start' && spec.approvalPrincipalId) {
        try { authorization = options.authorizeTool ? JSON.parse(canonical(await options.authorizeTool(freezeJson(JSON.parse(canonical(pinned)))))) : undefined; } catch (error) { authorizationFailure = error; /* Preserve cause after committing the blocked state. */ }
      }
      const reply = this.checkpoint(claim, pinned, authorization);
      if (reply.blocked) { if (authorizationFailure !== undefined) throw authorizationFailure; throw new Error(reply.blocked); }
      return reply;
    },
      cancel: async () => this.transaction(() => {
        const state = this.fenced(claim);
        if (state.status === 'cancelled') return;
        if (state.controlRevision !== claim.controlRevision) throw new Error('durable-control-changed');
        if (['running', 'waiting-approval'].includes(state.status)) { state.status = 'cancelled'; state.controlRevision++; this.save(state, 'cancelled'); }
      }),
      fail: async (_reason: string) => this.transaction(() => {
        const state = this.fenced(claim);
        // An old execution cannot turn a later Pause/Resume/Cancel into a failure.
        if (state.status === 'running' && state.controlRevision === claim.controlRevision) { state.status = 'failed'; this.save(state, 'failed'); }
      }),
    });
  }
  private checkpoint(claim: DurableClaim, request: DurableCheckpoint, authorization?: DurableToolAuthorization): DurableCheckpointReply & { blocked?: string } {
    return this.transaction(() => {
      const state = this.fenced(claim);
      if (digest(state.spec.runtimeManifest) !== digest(DURABLE_RUNTIME_MANIFEST)) throw new Error('durable-runtime-manifest-changed');
      const isResult = request.kind === 'model-result' || request.kind === 'tool-result';
      if (!isResult) {
        if (state.status === 'paused') throw new Error('durable-run-paused');
        if (state.status !== 'running' || Date.now() >= state.spec.deadlineAt) throw new Error('durable-dispatch-blocked');
        if (state.controlRevision !== claim.controlRevision) throw new Error('durable-control-changed');
      } else if (!['running', 'paused', 'waiting-approval', 'cancelled'].includes(state.status)) throw new Error('durable-dispatch-blocked');
      const priorDone = (turn: Turn) => turn.message !== undefined && turn.calls.every(call => call.result !== undefined || call.skipped);
      const pending = () => state.steering!.some(entry => entry.appliedAfterTurn === undefined);
      const steeringBlocked = () => { state.controlRevision++; this.save(state, 'steering-replay-required'); return { blocked: 'durable-steering-pending' }; };
      if (request.kind === 'turn-boundary') {
        if (!Number.isSafeInteger(request.turn) || request.turn < -1 || request.turn >= state.turns.length) throw new Error('durable-invalid-turn');
        if (state.turns.slice(0, request.turn + 1).some(turn => !priorDone(turn))) throw new Error('durable-predecessor-incomplete');
        let boundary = state.boundaries!.find(boundary => boundary.afterTurn === request.turn);
        let changed = false;
        if (!boundary) { boundary = { afterTurn: request.turn, sequences: [], continuationRevision: 0 }; state.boundaries!.push(boundary); changed = true; }
        if (!state.turns[request.turn + 1]) {
          for (const entry of state.steering!) if (entry.appliedAfterTurn === undefined) { entry.appliedAfterTurn = request.turn; boundary.sequences.push(entry.sequence); changed = true; }
          boundary.continuationRevision = state.continuationRevision!;
        }
        if (changed) this.save(state, 'turn-boundary');
        return { steering: state.steering!.filter(entry => boundary!.sequences.includes(entry.sequence)) };
      }
      if (request.kind === 'complete') {
        if (pending() || state.steering!.some(entry => !state.turns[entry.appliedAfterTurn! + 1])) return steeringBlocked();
        if (!state.turns.length || !state.turns.every(priorDone) || state.turns[state.turns.length - 1]!.calls.length) throw new Error('durable-incomplete');
        state.status = 'succeeded'; this.save(state, 'succeeded'); return {};
      }
      if (!Number.isSafeInteger(request.turn) || request.turn < 0 || request.turn > state.turns.length) throw new Error('durable-invalid-turn');
      let turn = state.turns[request.turn];
      if (request.kind === 'model-start') {
        if (!turn && pending()) return steeringBlocked();
        const contextDigest = digest(canonicalContext(request.context));
        if (turn && turn.contextDigest !== contextDigest) throw new Error('durable-context-changed');
        if (turn?.message !== undefined) return { cached: turn.message };
        if (state.turns.slice(0, request.turn).some(t => !priorDone(t)) || request.turn < state.turns.length - 1) throw new Error('durable-predecessor-incomplete');
        if (state.modelAttempts >= state.spec.maxModelAttempts || state.reservedUnits + state.spec.costPolicy.maxUnitsPerAttempt > state.spec.costPolicy.maxTotalUnits) throw new Error('durable-budget-exhausted');
        if (!turn) { turn = { contextDigest, calls: [], continuationRevision: state.boundaries!.find(boundary => boundary.afterTurn === request.turn - 1)?.continuationRevision ?? 0 }; state.turns.push(turn); }
        state.modelAttempts++; state.reservedUnits += state.spec.costPolicy.maxUnitsPerAttempt;
      } else {
        if (!turn) throw new Error('durable-model-not-started');
        if (request.kind === 'model-result') {
          if (turn.message !== undefined) { if (digest(turn.message) !== digest(request.message)) throw new Error('durable-model-result-conflict'); return { cached: turn.message }; }
          const message = request.message as any;
          if (!message || message.role !== 'assistant' || !Array.isArray(message.content) || !['stop', 'toolUse'].includes(message.stopReason)) throw new Error('durable-invalid-model-result');
          const calls: Call[] = [];
          for (const item of message.content) if (item.type === 'toolCall') {
            if (typeof item.id !== 'string' || !item.id || !state.spec.allowedTools.includes(item.name) || calls.some(c => c.id === item.id) || !item.arguments || typeof item.arguments !== 'object' || Array.isArray(item.arguments)) throw new Error('durable-uncertified-tool-call');
            calls.push({ id: item.id, tool: item.name, attempts: 0 });
          }
          if ((message.stopReason === 'toolUse') !== (calls.length > 0)) throw new Error('durable-invalid-stop-reason');
          turn.message = request.message; turn.calls = calls;
        } else {
          if (turn.message === undefined) throw new Error('durable-model-not-committed');
          const call = turn.calls.find(c => c.id === request.callId);
          if (!call || turn.calls.slice(0, turn.calls.indexOf(call)).some(c => c.result === undefined && !c.skipped)) throw new Error('durable-call-order');
          if (request.kind === 'tool-start' || request.kind === 'tool-disposition') {
            if (call.tool !== request.tool || !state.spec.allowedTools.includes(request.tool as any)) throw new Error('durable-uncertified-tool');
            if (call.skipped) return { skipped: true };
            if (call.attempts === 0 && call.result === undefined && pending()) {
              call.skipped = true;
              if (request.kind === 'tool-start') call.inputDigest = digest(request.input);
              this.save(state, 'tool-skipped'); return { skipped: true };
            }
            if (request.kind === 'tool-disposition') return {};
            const inputDigest = digest(request.input);
            if (call.inputDigest && call.inputDigest !== inputDigest) throw new Error('durable-tool-input-changed');
            const approval = this.authorize(state, request, call, inputDigest, authorization);
            if (approval?.blocked) return approval;
            if (call.result !== undefined) return { cached: call.result };
            if (call.attempts >= state.spec.maxModelAttempts) throw new Error('durable-tool-attempts-exhausted');
            call.inputDigest = inputDigest; call.attempts++;
          } else {
            if (call.skipped || !call.inputDigest || call.attempts < 1) throw new Error('durable-tool-not-started');
            if (call.result !== undefined) { if (digest(call.result) !== digest(request.result)) throw new Error('durable-tool-result-conflict'); return { cached: call.result }; }
            call.result = request.result;
          }
        }
      }
      this.save(state, request.kind); return {};
    });
  }
  events(runId: string, workspaceId: string, afterSequence = 0): Array<{ sequence: number; version: number; kind: string }> { this.row(runId, workspaceId); return this.db.prepare('SELECT sequence,version,kind FROM events WHERE run_id=? AND sequence>? ORDER BY sequence').all(runId, afterSequence); }
  backup(destination: string): void {
    if (resolve(destination) === resolve(this.path) || existsSync(destination)) throw new Error('durable-backup-destination-exists');
    const staged = `${destination}.staged-${randomUUID()}`;
    try {
      this.db.prepare('VACUUM INTO ?').run(staged); chmodSync(staged, 0o600);
      const copy = database(staged);
      try { copy.exec("PRAGMA synchronous=FULL; BEGIN IMMEDIATE; INSERT OR REPLACE INTO metadata VALUES ('dispatch-disabled','1'); UPDATE runs SET owner=NULL,pid=NULL; COMMIT;"); } finally { copy.close(); }
      const fd = openSync(staged, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      linkSync(staged, destination);
      const directoryFd = openSync(dirname(destination), 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } finally { if (existsSync(staged)) unlinkSync(staged); }
  }
  close(): void { this.db.close(); this.key.fill(0); }
}
