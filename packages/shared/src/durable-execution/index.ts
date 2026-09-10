import { readProcessIdentity, processIdentityProvesReplacement } from './process-identity.ts';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DurableCheckpoint, DurableCheckpointReply, DurableExecutionBridge, DurableExecutionDescriptor, DurableJson } from '../protocol/durable-execution.ts';
import { DURABLE_RUNTIME_MANIFEST } from '../protocol/durable-execution.ts';
import { privateDurableDirectory } from './key-provider.ts';
import type { DurableOperation, DurableOperationIntent, DurableOperationOutcome, DurableOperationValidator, DurableOperationAttemptToken, DurableOperationStart } from './operation-types.ts';
export type * from './operation-types.ts';
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
  /** Ordered local-read steps share this run's fencing, deadline and request budget. */
  workflowSteps?: Array<{ id: string }>;
  fallbackPlan?: { steps: Array<{ candidates: Array<{ model: string; credentialIdentity: string; connectionSlug: string }> }> };
  publication?: { outputId: string; kind: 'report' | 'document'; title: string; summary?: string; stepId: string };
  parent?: { runId: string; slotId: string; mode: 'required' | 'detached' };
  /** Trusted principal whose tool authorization must be resolved before every dispatch. */
  approvalPrincipalId?: string;
  authority: DurableJson;
  context: DurableJson;
  deadlineAt: number;
  maxModelAttempts: number;
  /** model-requests bounds provider attempts only; it is not a monetary spending guarantee. */
  costPolicy: { maxTotalUnits: number; maxUnitsPerAttempt: number; unit: 'verified-free' | 'trusted-upper-bound' | 'model-requests' };
}
export type DurableProviderFailure = 'rate-limit' | 'credits-exhausted' | 'provider-unavailable';
export interface DurableClaim { runId: string; workspaceId: string; ownerId: string; epoch: number; controlRevision: number; observationOnly?: true }
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
  workflowSteps?: Array<{ id: string; startTurn: number; inputDigest: string; endTurn?: number; output?: string }>;
  publication?: { status: 'pending' | 'published'; content: string; outputId: string; error?: 'authorization' | 'workspace' | 'conflict' | 'storage' };
  approvals?: DurableApproval[];
  steering?: DurableSteeringEntry[];
  continuationRevision?: number;
  boundaries?: Array<{ afterTurn: number; sequences: number[]; continuationRevision: number }>;
  failure?: string;
  providerAttempts?: Array<{ step: number; candidateIndex: number; startTurn: number; startedAt: number; endedAt?: number; endTurn?: number; retries: number; failures?: Array<{ code: DurableProviderFailure; at: number }>; error?: DurableProviderFailure; retryAt?: number }>;
  providerAttention?: DurableProviderFailure;
  operations?: DurableOperation[];
  children?: DurableChildEdge[];
  childReservedModelAttempts?: number;
  pausedByParent?: boolean;
}
export interface DurableChildEdge {
  slotId: string;
  childRunId: string;
  mode: 'required' | 'detached';
  intentDigest: string;
  outputSchema: DurableJson;
  reservedUnits: number;
  reservedModelAttempts: number;
  status: 'admitted' | 'joined';
  childVersion?: number;
  result?: DurableJson;
}
export interface DurableChildAdmission { slotId: string; mode: 'required' | 'detached'; childSpec: DurableRunSpec; outputSchema: DurableJson }
function validateControlInput(command: DurableControlCommand | DurableSteeringCommand): void {
  canonical(command);
  const fields = ['runId', 'workspaceId', 'commandId', 'expectedVersion', 'action', ...(command.action === 'steer' ? ['text'] : [])];
  if (Object.keys(command).some(key => !fields.includes(key)) || ['runId', 'workspaceId', 'commandId'].some(key => typeof (command as any)[key] !== 'string' || !(command as any)[key].trim()) || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1 || !['pause', 'resume', 'cancel', 'steer'].includes(command.action) || command.action === 'steer' && (typeof command.text !== 'string' || !command.text.trim())) throw new Error('invalid-durable-control-command');
}
export interface DurableJournalOptions { configRoot: string; key: Buffer; ownerId?: string; isProcessAlive?: (pid: number) => boolean; processIdentity?: (pid: number) => string | null; maxPayloadBytes?: number }
export class DurableJournal {
  readonly path: string;
  private db: Database;
  private readonly ownerId: string;
  private readonly key: Buffer;
  private readonly alive: (pid: number) => boolean;
  private readonly processIdentity: (pid: number) => string | null;
  private readonly maxBytes: number;
  private poisoned = false;
  private readonly observationEpochs = new Set<string>();
  constructor(options: DurableJournalOptions) {
    if (options.key.length !== 32) throw new Error('durable-key-required');
    this.key = Buffer.from(options.key);
    this.ownerId = options.ownerId ?? randomUUID();
    this.alive = options.isProcessAlive ?? (pid => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== 'ESRCH'; } });
    this.processIdentity = options.processIdentity ?? readProcessIdentity;
    this.maxBytes = options.maxPayloadBytes ?? 16 * 1024 * 1024;
    this.path = join(privateDurableDirectory(options.configRoot), 'journal.sqlite');
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(this.path + suffix) && lstatSync(this.path + suffix).isSymbolicLink()) throw new Error('unsafe-journal-path');
    if (!existsSync(this.path)) { try { closeSync(openSync(this.path, 'wx', 0o600)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
    this.db = database(this.path);
    try {
      this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      if (this.db.prepare('PRAGMA journal_mode').get().journal_mode !== 'wal' || this.db.prepare('PRAGMA synchronous').get().synchronous !== 2 || this.db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('unsafe-sqlite-settings');
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      if (![0, 1, 2, 3, 4].includes(version)) throw new Error('unsupported-durable-schema');
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.exec('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, command TEXT NOT NULL, spec_digest TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 0, owner TEXT, pid INTEGER, payload TEXT NOT NULL, UNIQUE(workspace,command)); CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL, kind TEXT NOT NULL, UNIQUE(run_id,version)); CREATE TABLE IF NOT EXISTS outbox (sequence INTEGER PRIMARY KEY REFERENCES events(sequence), acknowledged INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS control_commands (workspace TEXT NOT NULL, id TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), payload TEXT NOT NULL, PRIMARY KEY(workspace,id)); PRAGMA user_version=4;');
        if (!this.db.prepare('PRAGMA table_info(runs)').all().some((column: any) => column.name === 'process_identity')) this.db.exec('ALTER TABLE runs ADD COLUMN process_identity TEXT');
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
    // Parent controls and owned-child eligibility change in the same transaction.
    if (['paused', 'cancelled', 'failed'].includes(state.status)) for (const edge of state.children ?? []) {
      if (edge.mode !== 'required') continue;
      const child = this.get(edge.childRunId, state.spec.workspaceId);
      if (!['running', 'paused', 'waiting-approval'].includes(child.status)) continue;
      if (state.status === 'paused') {
        if (child.status === 'paused') continue;
        child.status = 'paused'; child.pausedByParent = true;
      } else child.status = 'cancelled';
      child.controlRevision++; this.save(child, 'parent-control');
    }
  }
  admit(spec: DurableRunSpec): DurableRunSnapshot {
    canonical(spec);
    if (spec.parent !== undefined) throw new Error('durable-child-atomic-admission-required');
    const policy = spec.costPolicy;
    if (spec.workflowSteps !== undefined && (!Array.isArray(spec.workflowSteps) || spec.workflowSteps.length < 1 || spec.workflowSteps.length > 8 || spec.workflowSteps.some(step => !step || typeof step.id !== 'string' || !step.id.trim() || Object.keys(step).some(key => key !== 'id')) || new Set(spec.workflowSteps.map(step => step.id)).size !== spec.workflowSteps.length)) throw new Error('invalid-durable-workflow-steps');
    if (spec.fallbackPlan !== undefined) {
      const plan = spec.fallbackPlan;
      if (!plan || !spec.workflowSteps || !Array.isArray(plan.steps) || plan.steps.length !== spec.workflowSteps.length || Object.keys(plan).some(k => k !== 'steps') || plan.steps.some(step => !step || Object.keys(step).some(k => k !== 'candidates') || !Array.isArray(step.candidates) || step.candidates.length < 1 || step.candidates.length > 9 || step.candidates.some(c => !c || Object.keys(c).some(k => !['model', 'credentialIdentity', 'connectionSlug'].includes(k)) || typeof c.model !== 'string' || !c.model.trim() || typeof c.connectionSlug !== 'string' || !c.connectionSlug.trim() || !/^[a-f0-9]{64}$/.test(c.credentialIdentity)))) throw new Error('invalid-durable-fallback-plan');
    }
    if (spec.publication !== undefined) {
      const publication = spec.publication;
      if (!publication || typeof publication !== 'object' || Object.keys(publication).some(key => !['outputId', 'kind', 'title', 'summary', 'stepId'].includes(key)) || typeof publication.outputId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(publication.outputId) || !['report', 'document'].includes(publication.kind) || typeof publication.title !== 'string' || !publication.title.trim() || typeof publication.stepId !== 'string' || !publication.stepId.trim() || publication.summary !== undefined && typeof publication.summary !== 'string' || spec.workflowSteps && publication.stepId !== spec.workflowSteps.at(-1)!.id) throw new Error('invalid-durable-publication');
    }
    if (spec.approvalPrincipalId !== undefined && (typeof spec.approvalPrincipalId !== 'string' || !spec.approvalPrincipalId.trim())) throw new Error('invalid-approval-principal');
    if (!/^[a-f0-9]{64}$/.test(spec.credentialIdentity) || !spec.runtimeManifest || Object.values(spec.runtimeManifest).some(value => typeof value !== 'string') || spec.engine !== 'sqlite-v2-readonly-1' || !spec.runId || !spec.workspaceId || !spec.commandId || !spec.model || !Number.isSafeInteger(spec.maxOutputTokens) || spec.maxOutputTokens < 1 || !Number.isSafeInteger(spec.maxModelAttempts) || spec.maxModelAttempts < 1 || !Number.isFinite(spec.deadlineAt) || !Array.isArray(spec.allowedTools) || spec.allowedTools.some(t => !['read', 'grep', 'find', 'ls'].includes(t)) || !policy || !['verified-free', 'trusted-upper-bound', 'model-requests'].includes(policy.unit) || !Number.isSafeInteger(policy.maxTotalUnits) || !Number.isSafeInteger(policy.maxUnitsPerAttempt) || policy.maxTotalUnits < 0 || policy.maxUnitsPerAttempt < 0 || (policy.unit === 'verified-free' ? policy.maxTotalUnits !== 0 || policy.maxUnitsPerAttempt !== 0 : policy.maxUnitsPerAttempt === 0) || (policy.unit === 'model-requests' && (policy.maxUnitsPerAttempt !== 1 || policy.maxTotalUnits !== spec.maxModelAttempts))) throw new Error('invalid-durable-admission');
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
  recordPublicationFailure(claim: DurableClaim, category: 'authorization' | 'workspace' | 'conflict' | 'storage'): void {
    this.assertExecutionClaim(claim);
    if (!['authorization', 'workspace', 'conflict', 'storage'].includes(category)) throw new Error('durable-publication-error-invalid');
    this.transaction(() => {
      const state = this.fenced(claim);
      if (state.status !== 'running' || state.controlRevision !== claim.controlRevision || state.publication?.status !== 'pending') return;
      state.publication.error = category;
      state.status = 'paused'; state.controlRevision++;
      this.save(state, 'publication-blocked');
    });
  }
  private assertOwnerAvailable(row: { owner?: string; pid: number; process_identity?: string }): void {
    if (!row.owner || !this.alive(row.pid)) return;
    let current: string | null = null;
    try { current = this.processIdentity(row.pid); } catch { /* Fail closed on identity lookup failures. */ }
    if (!processIdentityProvesReplacement(row.process_identity ?? null, current)) throw new Error('durable-run-owned');
  }
  claim(runId: string, workspaceId: string): DurableClaim {
    return this.transaction(() => {
      const row = this.row(runId, workspaceId);
      this.assertOwnerAvailable(row);
      const state = this.get(runId, workspaceId);
      if (state.status === 'waiting-approval') throw new Error('durable-approval-required');
      if (state.status === 'paused') throw new Error('durable-run-paused');
      if (state.status !== 'running') throw new Error('durable-run-terminal');
      this.assertChildParent(state);
      const epoch = row.epoch + 1;
      this.db.prepare('UPDATE runs SET owner=?,pid=?,epoch=?,process_identity=? WHERE id=?').run(this.ownerId, process.pid, epoch, this.processIdentity(process.pid), runId);
      return { runId, workspaceId, ownerId: this.ownerId, epoch, controlRevision: state.controlRevision };
    });
  }
  /** Recover external observations without granting execution authority to a stopped run. */
  claimObservation(runId: string, workspaceId: string): DurableClaim {
    return this.transaction(() => {
      const row = this.row(runId, workspaceId);
      this.assertOwnerAvailable(row);
      const state = this.get(runId, workspaceId);
      if (!['paused', 'cancelled', 'failed'].includes(state.status)) throw new Error('durable-observation-state-invalid');
      const epoch = row.epoch + 1;
      this.db.prepare('UPDATE runs SET owner=?,pid=?,epoch=?,process_identity=? WHERE id=?').run(this.ownerId, process.pid, epoch, this.processIdentity(process.pid), runId);
      this.observationEpochs.add(canonical([runId, workspaceId, epoch]));
      return { runId, workspaceId, ownerId: this.ownerId, epoch, controlRevision: state.controlRevision, observationOnly: true };
    });
  }
  private assertExecutionClaim(claim: DurableClaim): void {
    if (claim.observationOnly || this.observationEpochs.has(canonical([claim.runId, claim.workspaceId, claim.epoch]))) throw new Error('durable-observation-only');
  }
  private fenced(claim: DurableClaim): DurableRunSnapshot {
    const row = this.row(claim.runId, claim.workspaceId);
    if (row.owner !== claim.ownerId || row.epoch !== claim.epoch || claim.ownerId !== this.ownerId) throw new Error('durable-stale-owner');
    return this.get(claim.runId, claim.workspaceId);
  }
  release(claim: DurableClaim): void { this.transaction(() => { this.fenced(claim); this.db.prepare('UPDATE runs SET owner=NULL,pid=NULL,process_identity=NULL WHERE id=?').run(claim.runId); }); }
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
      if (command.action === 'resume') this.assertChildParent(state);
      if (command.action === 'resume' && Date.now() >= state.spec.deadlineAt && state.publication?.status !== 'pending') throw new Error('durable-dispatch-blocked');
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
      if (state.publication) throw new Error('durable-publication-model-finished');
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
  private activeCredential(state: DurableRunSnapshot): string {
    const attempt = state.providerAttempts?.at(-1);
    return attempt && state.spec.fallbackPlan?.steps[attempt.step]?.candidates[attempt.candidateIndex]?.credentialIdentity || state.spec.credentialIdentity;
  }
  private authorize(state: DurableRunSnapshot, request: Extract<DurableCheckpoint, { kind: 'tool-start' }>, call: Call, inputDigest: string, authorization?: DurableToolAuthorization): { blocked: string } | undefined {
    if (!state.spec.approvalPrincipalId) return;
    if (!authorization || authorization.allowed !== true || authorization.principalId !== state.spec.approvalPrincipalId || authorization.credentialIdentity !== this.activeCredential(state) || typeof authorization.policyRevision !== 'string' || !authorization.policyRevision || typeof authorization.requiresApproval !== 'boolean' || !Number.isFinite(authorization.approvalExpiresAt)) {
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
        || command.principalId !== state.spec.approvalPrincipalId || command.credentialIdentity !== this.activeCredential(state)) throw new Error('durable-approval-decision-mismatch');
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

  /** Host-only transition: old bridges cannot settle an abandoned provider attempt. */
  beginStepAttempt(claim: DurableClaim, input: { step: number; candidateIndex: number }): DurableClaim {
    this.assertExecutionClaim(claim);
    return this.transaction(() => {
      const state = this.fenced(claim);
      this.operationDispatch(state, claim);
      const candidates = state.spec.fallbackPlan?.steps[input.step]?.candidates;
      const step = state.workflowSteps?.[input.step];
      if (!Number.isSafeInteger(input.step) || !Number.isSafeInteger(input.candidateIndex) || !candidates?.[input.candidateIndex] || !step || step.endTurn !== undefined || state.workflowSteps?.slice(0, input.step).some(s => s.endTurn === undefined)) throw new Error('durable-invalid-provider-attempt');
      const attempts = state.providerAttempts ??= [];
      const previous = attempts.at(-1);
      if (previous?.step === input.step && previous.candidateIndex === input.candidateIndex) return { ...claim };
      if (previous?.step === input.step && (previous.endTurn !== undefined || !previous.error || input.candidateIndex <= previous.candidateIndex)) throw new Error('durable-provider-attempt-order');
      if (previous?.step === input.step) {
        previous.endTurn = state.turns.length; previous.endedAt = Date.now();
        for (const approval of state.approvals ?? []) if (approval.turn >= previous.startTurn && approval.turn < previous.endTurn && ['pending', 'approved'].includes(approval.status)) approval.status = 'superseded';
        // Reapply steering consumed only by the abandoned context to the new context.
        for (const entry of state.steering ?? []) if (entry.appliedAfterTurn !== undefined && entry.appliedAfterTurn >= previous.startTurn - 1) delete entry.appliedAfterTurn;
      }
      step.startTurn = state.turns.length;
      attempts.push({ step: input.step, candidateIndex: input.candidateIndex, startTurn: step.startTurn, startedAt: Date.now(), retries: 0 });
      delete state.providerAttention;
      state.controlRevision++; this.save(state, 'provider-attempt-start');
      return { ...claim, controlRevision: state.controlRevision };
    });
  }
  recordProviderFailure(claim: DurableClaim, input: { step: number; candidateIndex: number; code: DurableProviderFailure; retryAt?: number; exhausted?: boolean }): DurableClaim {
    this.assertExecutionClaim(claim);
    return this.transaction(() => {
      const state = this.fenced(claim);
      this.operationDispatch(state, claim);
      const attempt = state.providerAttempts?.at(-1);
      if (!attempt || attempt.step !== input.step || attempt.candidateIndex !== input.candidateIndex || attempt.endTurn !== undefined || state.workflowSteps?.[input.step]?.endTurn !== undefined || !['rate-limit', 'credits-exhausted', 'provider-unavailable'].includes(input.code)) throw new Error('durable-invalid-provider-failure');
      if (input.retryAt !== undefined && (input.code !== 'rate-limit' || input.exhausted || attempt.retries >= 1 || !Number.isSafeInteger(input.retryAt) || input.retryAt <= Date.now() || input.retryAt > Math.min(state.spec.deadlineAt, Date.now() + 60000))) throw new Error('durable-invalid-provider-retry');
      attempt.failures = [...(attempt.failures ?? []).slice(-15), { code: input.code, at: Date.now() }];
      attempt.error = input.code;
      if (input.retryAt !== undefined) { attempt.retryAt = input.retryAt; attempt.retries++; } else delete attempt.retryAt;
      if (input.exhausted) { state.status = 'paused'; state.providerAttention = input.code; }
      state.controlRevision++; this.save(state, 'provider-failure');
      return { ...claim, controlRevision: state.controlRevision };
    });
  }

  bridge(claim: DurableClaim, options: { authorizeTool?: (request: Extract<DurableCheckpoint, { kind: 'tool-start' }>) => Promise<DurableToolAuthorization> } = {}): DurableExecutionBridge {
    this.assertExecutionClaim(claim);
    const snapshot = this.fenced(claim), spec = snapshot.spec;
    const active = snapshot.providerAttempts?.at(-1);
    const candidate = active && spec.fallbackPlan?.steps[active.step]?.candidates[active.candidateIndex];
    const descriptor: DurableExecutionDescriptor = { credentialIdentity: candidate?.credentialIdentity ?? spec.credentialIdentity, runtimeManifest: Object.freeze({...spec.runtimeManifest}), engine: spec.engine, runId: spec.runId, workspaceId: spec.workspaceId, createdAt: spec.createdAt, allowedTools: [...spec.allowedTools], model: candidate?.model ?? spec.model, maxOutputTokens: spec.maxOutputTokens };
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
        if (state.status === 'running' && state.controlRevision === claim.controlRevision) {
          // Model teardown cannot strand a completed result awaiting local publication.
          state.status = state.publication?.status === 'pending' ? 'paused' : 'failed';
          if (state.status === 'paused') state.controlRevision++;
          this.save(state, state.status);
        }
      }),
    });
  }
  private checkpoint(claim: DurableClaim, request: DurableCheckpoint, authorization?: DurableToolAuthorization): DurableCheckpointReply & { blocked?: string } {
    return this.transaction(() => {
      const state = this.fenced(claim);
      if (digest(state.spec.runtimeManifest) !== digest(DURABLE_RUNTIME_MANIFEST)) throw new Error('durable-runtime-manifest-changed');
      const isResult = request.kind === 'model-result' || request.kind === 'tool-result';
      if (state.spec.fallbackPlan && state.controlRevision !== claim.controlRevision) throw new Error('durable-control-changed');
      const abandoned = (index: number) => state.providerAttempts?.some(a => a.endTurn !== undefined && index >= a.startTurn && index < a.endTurn) ?? false;
      const finalStepReplay = request.kind === 'workflow-step-complete' && state.status === 'succeeded' && state.spec.workflowSteps !== undefined && request.step === state.spec.workflowSteps.length - 1 && state.workflowSteps?.[request.step]?.endTurn !== undefined;
      const publicationReplay = request.kind === 'output-published' && state.status === 'succeeded' && state.publication?.status === 'published';
      const localPublication = request.kind === 'output-published' || state.publication?.status === 'pending' && (request.kind === 'complete' || request.kind === 'workflow-step-complete');
      if (!isResult) {
        this.assertChildParent(state);
        if (state.status === 'paused') throw new Error('durable-run-paused');
        if (state.status !== 'running' && !finalStepReplay && !publicationReplay || !localPublication && Date.now() >= state.spec.deadlineAt) throw new Error('durable-dispatch-blocked');
        if (state.controlRevision !== claim.controlRevision) throw new Error('durable-control-changed');
      } else if (!['running', 'paused', 'waiting-approval', 'cancelled'].includes(state.status)) throw new Error('durable-dispatch-blocked');
      if (request.kind === 'output-published') {
        if (!state.spec.publication || !state.publication || request.outputId !== state.spec.publication.outputId || request.outputId !== state.publication.outputId) throw new Error('durable-publication-mismatch');
        if (state.publication.status === 'published') return {};
        state.publication.status = 'published'; delete state.publication.error; state.status = 'succeeded';
        this.save(state, 'output-published'); return {};
      }
      if (state.publication && !isResult && !['complete', 'workflow-step-complete'].includes(request.kind)) throw new Error('durable-publication-model-finished');
      const priorDone = (turn: Turn) => turn.message !== undefined && turn.calls.every(call => call.result !== undefined || call.skipped);
      const pending = () => state.steering!.some(entry => entry.appliedAfterTurn === undefined);
      const steeringBlocked = () => { state.controlRevision++; this.save(state, 'steering-replay-required'); return { blocked: 'durable-steering-pending' }; };
      if (request.kind === 'turn-boundary') {
        if (!Number.isSafeInteger(request.turn) || request.turn < -1 || request.turn >= state.turns.length) throw new Error('durable-invalid-turn');
        if (state.turns.slice(0, request.turn + 1).some((turn, index) => !abandoned(index) && !priorDone(turn))) throw new Error('durable-predecessor-incomplete');
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
      if (request.kind === 'workflow-step-start' || request.kind === 'workflow-step-complete') {
        const definitions = state.spec.workflowSteps;
        if (!definitions || !Number.isSafeInteger(request.step) || request.step < 0 || request.step >= definitions.length) throw new Error('durable-invalid-workflow-step');
        const steps = state.workflowSteps ??= [];
        const step = steps[request.step];
        if (steps.slice(0, request.step).some(prior => prior.endTurn === undefined) || request.step > steps.length) throw new Error('durable-workflow-step-order');
        if (request.kind === 'workflow-step-start') {
          const inputDigest = digest(request.input);
          if (step) {
            if (step.inputDigest !== inputDigest) throw new Error('durable-workflow-step-input-changed');
            return step.output === undefined ? {} : { cached: step.output };
          }
          if (steps.some(prior => prior.endTurn === undefined) || !state.turns.every((turn, index) => abandoned(index) || priorDone(turn))) throw new Error('durable-workflow-step-order');
          steps.push({ id: definitions[request.step]!.id, startTurn: state.turns.length, inputDigest });
          this.save(state, 'workflow-step-start'); return {};
        }
        if (!step) throw new Error('durable-workflow-step-not-started');
        if (step.endTurn !== undefined) return { cached: step.output! };
        if (pending() || state.steering!.some(entry => !state.turns[entry.appliedAfterTurn! + 1])) return steeringBlocked();
        if (state.children?.some(child => child.mode === 'required' && child.status !== 'joined')) throw new Error('durable-child-join-required');
        if (state.operations?.some(operation => operation.status !== 'succeeded')) throw new Error('durable-operation-incomplete');
        const turns = state.turns.slice(step.startTurn);
        if (!turns.length || !turns.every(priorDone) || turns[turns.length - 1]!.calls.length) throw new Error('durable-incomplete');
        const message = turns[turns.length - 1]!.message as { content?: Array<{ type?: string; text?: string }> };
        // The host enforces the pinned requireNonEmptyOutput policy before this checkpoint.
        const text = message.content?.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('') ?? '';
        step.output = text; step.endTurn = state.turns.length;
        const activeAttempt = state.providerAttempts?.at(-1);
        if (activeAttempt?.step === request.step) activeAttempt.endedAt = Date.now();
        if (request.step === definitions.length - 1) {
          if (state.spec.publication) state.publication = { status: 'pending', content: text, outputId: state.spec.publication.outputId };
          else state.status = 'succeeded';
        }
        this.save(state, 'workflow-step-complete'); return { cached: text };
      }
      if (request.kind === 'complete') {
        if (state.spec.workflowSteps) throw new Error('durable-workflow-step-completion-required');
        if (state.publication) return {};
        if (state.children?.some(child => child.mode === 'required' && child.status !== 'joined')) throw new Error('durable-child-join-required');
        if (state.operations?.some(operation => operation.status !== 'succeeded')) throw new Error('durable-operation-incomplete');
        if (pending() || state.steering!.some(entry => !state.turns[entry.appliedAfterTurn! + 1])) return steeringBlocked();
        if (!state.turns.length || !state.turns.every((turn, index) => abandoned(index) || priorDone(turn)) || state.turns[state.turns.length - 1]!.calls.length) throw new Error('durable-incomplete');
        if (state.spec.publication) {
          const message = state.turns.at(-1)!.message as { content?: Array<{ type?: string; text?: string }> };
          const content = message.content?.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('') ?? '';
          state.publication = { status: 'pending', content, outputId: state.spec.publication.outputId };
          this.save(state, 'publication-pending');
        } else { state.status = 'succeeded'; this.save(state, 'succeeded'); }
        return {};
      }
      if (!Number.isSafeInteger(request.turn) || request.turn < 0 || request.turn > state.turns.length) throw new Error('durable-invalid-turn');
      if (abandoned(request.turn)) throw new Error('durable-provider-attempt-abandoned');
      let turn = state.turns[request.turn];
      if (request.kind === 'model-start') {
        if (state.spec.fallbackPlan) {
          const active = state.providerAttempts?.at(-1);
          if (!active || active.endTurn !== undefined || active.step !== state.workflowSteps?.findIndex(s => s.endTurn === undefined) || active.retryAt !== undefined && Date.now() < active.retryAt) throw new Error('durable-provider-attempt-blocked');
          delete active.retryAt; delete state.providerAttention;
        }
        if (state.spec.workflowSteps) {
          const step = state.workflowSteps?.find(step => step.endTurn === undefined);
          if (!step || request.turn < step.startTurn) throw new Error('durable-workflow-step-not-started');
        }
        if (!turn && state.children?.some(child => child.mode === 'required' && child.status !== 'joined')) throw new Error('durable-child-join-required');
        if (!turn && pending()) return steeringBlocked();
        const contextDigest = digest(canonicalContext(request.context));
        if (turn && turn.contextDigest !== contextDigest) throw new Error('durable-context-changed');
        if (turn?.message !== undefined) return { cached: turn.message };
        if (state.turns.slice(0, request.turn).some((t, index) => !abandoned(index) && !priorDone(t)) || request.turn < state.turns.length - 1) throw new Error('durable-predecessor-incomplete');
        if (state.modelAttempts + (state.childReservedModelAttempts ?? 0) >= state.spec.maxModelAttempts || state.reservedUnits + state.spec.costPolicy.maxUnitsPerAttempt > state.spec.costPolicy.maxTotalUnits) throw new Error('durable-budget-exhausted');
        if (!turn) { turn = { contextDigest, calls: [], continuationRevision: state.boundaries!.find(boundary => boundary.afterTurn === request.turn - 1)?.continuationRevision ?? 0 }; state.turns.push(turn); }
        if (state.spec.fallbackPlan) delete state.providerAttempts!.at(-1)!.error;
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
  /** Identity, child row, parent edge and conservative root reservations are one commit. */
  admitChild(claim: DurableClaim, input: DurableChildAdmission): DurableChildEdge {
    const request = JSON.parse(canonical(input)) as DurableChildAdmission;
    return this.transaction(() => {
      const parent = this.fenced(claim);
      if (parent.spec.costPolicy.unit === 'model-requests') throw new Error('durable-request-budget-children-unsupported');
      if (parent.spec.parent) throw new Error('durable-child-depth-exceeded');
      if (!parent.spec.approvalPrincipalId) throw new Error('durable-child-principal-required');
      const child = request.childSpec, policy = child.costPolicy;
      const old = parent.children?.find(edge => edge.slotId === request.slotId);
      if (old) {
        if (old.intentDigest !== digest(request)) throw new Error('durable-child-intent-conflict');
        if (old.status === 'joined') return old;
        this.operationDispatch(parent, claim);
        const existing = this.get(old.childRunId, parent.spec.workspaceId);
        if (existing.pausedByParent && existing.status === 'paused') {
          delete existing.pausedByParent;
          existing.status = existing.approvals?.some(approval => approval.status === 'pending' && approval.expiresAt > Date.now()) ? 'waiting-approval' : 'running';
          existing.controlRevision++; this.save(existing, 'parent-resumed');
        }
        return old;
      }
      this.operationDispatch(parent, claim);
      const hash = digest(['durable-child-v1', parent.spec.workspaceId, parent.spec.runId, request.slotId]);
      const childRunId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const context = child.context as Record<string, DurableJson>;
      const expected = { ...parent.spec, runId: childRunId, commandId: `child:${parent.spec.runId}:${request.slotId}`,
        parent: { runId: parent.spec.runId, slotId: request.slotId, mode: request.mode },
        context: { ...(parent.spec.context as Record<string, DurableJson>), prompt: context?.prompt, systemPrompt: context?.systemPrompt },
        allowedTools: child.allowedTools, maxOutputTokens: child.maxOutputTokens, maxModelAttempts: child.maxModelAttempts, deadlineAt: child.deadlineAt, costPolicy: policy };
      if (typeof request.slotId !== 'string' || !request.slotId.trim() || !['required', 'detached'].includes(request.mode) || !context || typeof context.prompt !== 'string' || !context.prompt.trim() || typeof context.systemPrompt !== 'string' || !context.systemPrompt.trim()
        || digest(child) !== digest(expected) || !Array.isArray(child.allowedTools) || new Set(child.allowedTools).size !== child.allowedTools.length || child.allowedTools.some(tool => !parent.spec.allowedTools.includes(tool))
        || !Number.isSafeInteger(child.maxOutputTokens) || child.maxOutputTokens < 1 || child.maxOutputTokens > parent.spec.maxOutputTokens
        || !Number.isSafeInteger(child.maxModelAttempts) || child.maxModelAttempts < 1 || !Number.isFinite(child.deadlineAt) || child.deadlineAt > parent.spec.deadlineAt || child.deadlineAt <= Date.now()
        || !policy || policy.unit !== parent.spec.costPolicy.unit || !Number.isSafeInteger(policy.maxTotalUnits) || policy.maxTotalUnits < 0 || !Number.isSafeInteger(policy.maxUnitsPerAttempt) || policy.maxUnitsPerAttempt < 0 || policy.maxUnitsPerAttempt > parent.spec.costPolicy.maxUnitsPerAttempt
        || (policy.unit === 'verified-free' && (policy.maxTotalUnits !== 0 || policy.maxUnitsPerAttempt !== 0)) || (policy.unit === 'trusted-upper-bound' && policy.maxUnitsPerAttempt === 0)) throw new Error('durable-child-constraints-invalid');
      if (parent.modelAttempts + (parent.childReservedModelAttempts ?? 0) + child.maxModelAttempts > parent.spec.maxModelAttempts || parent.reservedUnits + policy.maxTotalUnits > parent.spec.costPolicy.maxTotalUnits) throw new Error('durable-child-budget-exhausted');
      if (this.db.prepare('SELECT id FROM runs WHERE id=? OR (workspace=? AND command=?)').get(childRunId, child.workspaceId, child.commandId)) throw new Error('durable-child-identity-conflict');
      const childState: DurableRunSnapshot = { spec: child, status: 'running', controlRevision: 0, version: 0, modelAttempts: 0, reservedUnits: 0, turns: [], approvals: [], steering: [], boundaries: [], continuationRevision: 0 };
      this.db.prepare('INSERT INTO runs(id,workspace,command,spec_digest,payload) VALUES (?,?,?,?,?)').run(childRunId, child.workspaceId, child.commandId, digest(child), this.encrypt(childState, childRunId));
      this.save(childState, 'child-admitted');
      const edge: DurableChildEdge = { slotId: request.slotId, childRunId, mode: request.mode, intentDigest: digest(request), outputSchema: request.outputSchema, reservedUnits: policy.maxTotalUnits, reservedModelAttempts: child.maxModelAttempts, status: 'admitted' };
      (parent.children ??= []).push(edge); parent.reservedUnits += policy.maxTotalUnits; parent.childReservedModelAttempts = (parent.childReservedModelAttempts ?? 0) + child.maxModelAttempts;
      this.save(parent, 'child-admitted'); return edge;
    });
  }

  joinChild(claim: DurableClaim, slotId: string, validate: (text: string, schema: DurableJson) => DurableJson): DurableChildEdge {
    return this.transaction(() => {
      const parent = this.fenced(claim);
      const edge = parent.children?.find(edge => edge.slotId === slotId);
      if (!edge || edge.mode !== 'required') throw new Error('durable-child-join-invalid');
      if (edge.status === 'joined') return edge;
      this.operationDispatch(parent, claim);
      if (parent.children!.slice(0, parent.children!.indexOf(edge)).some(prior => prior.mode === 'required' && prior.status !== 'joined')) throw new Error('durable-child-join-order');
      const child = this.get(edge.childRunId, parent.spec.workspaceId);
      if (child.status !== 'succeeded') throw new Error('durable-child-incomplete');
      const message = child.turns.at(-1)?.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
      const text = message?.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error('durable-child-empty-output');
      const result = JSON.parse(canonical(validate(text, freezeJson(JSON.parse(canonical(edge.outputSchema)))))) as DurableJson;
      edge.result = result; edge.status = 'joined'; edge.childVersion = child.version;
      this.save(parent, 'child-joined'); return edge;
    });
  }

  private assertChildParent(state: DurableRunSnapshot): void {
    const lineage = state.spec.parent;
    if (!lineage || lineage.mode === 'detached') return;
    const parent = this.get(lineage.runId, state.spec.workspaceId);
    const edge = parent.children?.find(edge => edge.slotId === lineage.slotId && edge.childRunId === state.spec.runId && edge.mode === 'required');
    if (!edge || parent.status !== 'running') throw new Error('durable-child-parent-blocked');
  }
  private operationDispatch(state: DurableRunSnapshot, claim: DurableClaim): void {
    this.assertExecutionClaim(claim);
    if (state.publication) throw new Error('durable-publication-model-finished');
    this.assertChildParent(state);
    if (state.status !== 'running' || state.controlRevision !== claim.controlRevision || Date.now() >= state.spec.deadlineAt) throw new Error('durable-operation-dispatch-blocked');
    if (digest(state.spec.runtimeManifest) !== digest(DURABLE_RUNTIME_MANIFEST)) throw new Error('durable-runtime-manifest-changed');
  }
  private operation(state: DurableRunSnapshot, slotId: string): DurableOperation {
    const operation = state.operations?.find(item => item.intent.slotId === slotId);
    if (!operation) throw new Error('durable-operation-not-found');
    return operation;
  }
  getOperation(runId: string, workspaceId: string, slotId: string): DurableOperation | undefined {
    return this.get(runId, workspaceId).operations?.find(item => item.intent.slotId === slotId);
  }
  /** Commit immutable intent before an adapter receives permission to invoke anything. */
  reserveOperation(claim: DurableClaim, input: DurableOperationIntent): DurableOperation {
    const intent = JSON.parse(canonical(input)) as DurableOperationIntent;
    const fields = ['slotId','adapterId','adapterVersion','credentialIdentity','effectClass','idempotencyKey','input','outputSchema','maxAttempts','maxUnitsPerAttempt'];
    if (!intent || Array.isArray(intent) || Object.keys(intent).some(key => !fields.includes(key)) ||
      ['slotId','adapterId','adapterVersion','idempotencyKey'].some(key => typeof (intent as any)[key] !== 'string' || !(intent as any)[key].trim()) ||
      !/^[a-f0-9]{64}$/.test(intent.credentialIdentity) || !['read','idempotent-write','reconcilable-write'].includes(intent.effectClass) ||
      !intent.outputSchema || Object.keys(intent.outputSchema).some(key => !['id','version'].includes(key)) ||
      ![intent.outputSchema.id,intent.outputSchema.version].every(value => typeof value === 'string' && value.trim()) ||
      !Number.isSafeInteger(intent.maxAttempts) || intent.maxAttempts < 1 || !Number.isFinite(intent.maxUnitsPerAttempt) || intent.maxUnitsPerAttempt < 0 || !Object.hasOwn(intent,'input')) throw new Error('invalid-durable-operation-intent');
    return this.transaction(() => {
      const state = this.fenced(claim);
      if (state.spec.costPolicy.unit === 'model-requests') throw new Error('durable-request-budget-operations-unsupported');
      const existing = state.operations?.find(item => item.intent.slotId === intent.slotId);
      if (existing) { if (digest(existing.intent) !== digest(intent)) throw new Error('durable-operation-intent-conflict'); return existing; }
      this.operationDispatch(state, claim);
      if (state.operations?.some(item => item.intent.idempotencyKey === intent.idempotencyKey)) throw new Error('durable-operation-key-conflict');
      const operation: DurableOperation = { operationId: digest([claim.workspaceId,claim.runId,intent.slotId]), intent,
        inputDigest: digest(intent.input), status: 'intent', attempts: [] };
      (state.operations ??= []).push(operation);
      this.save(state, 'operation-intent');
      return operation;
    });
  }
  /** Each command can authorize only its first invocation; even a lost start reply requires reconciliation. */
  startOperation(claim: DurableClaim, slotId: string, commandId: string): DurableOperationStart {
    if (typeof commandId !== 'string' || !commandId.trim()) throw new Error('invalid-durable-operation-command');
    return this.transaction(() => {
      const state = this.fenced(claim), operation = this.operation(state, slotId);
      const duplicate = state.operations?.flatMap(item => item.attempts).find(attempt => attempt.commandId === commandId);
      if (duplicate) {
        if (duplicate.operationId !== operation.operationId) throw new Error('durable-operation-command-conflict');
        return { operation, dispatch: false };
      }
      this.operationDispatch(state, claim);
      if (operation.status !== 'intent') throw new Error('durable-operation-reconciliation-required');
      if (state.operations!.slice(0, state.operations!.indexOf(operation)).some(item => item.status !== 'succeeded')) throw new Error('durable-operation-predecessor-incomplete');
      if (operation.attempts.length >= operation.intent.maxAttempts || state.reservedUnits + operation.intent.maxUnitsPerAttempt > state.spec.costPolicy.maxTotalUnits) throw new Error('durable-operation-budget-exhausted');
      const attempt: DurableOperationAttemptToken = { operationId: operation.operationId, slotId, commandId,
        attempt: operation.attempts.length + 1, ownerId: claim.ownerId, epoch: claim.epoch };
      operation.attempts.push({ ...attempt, reservedUnits: operation.intent.maxUnitsPerAttempt });
      operation.status = 'inflight';
      state.reservedUnits += operation.intent.maxUnitsPerAttempt;
      this.save(state, 'operation-started');
      return { operation, dispatch: true, attempt };
    });
  }
  private operationOutcome(operation: DurableOperation, input: DurableOperationOutcome, validator?: DurableOperationValidator): DurableOperationOutcome {
    const outcome = JSON.parse(canonical(input)) as DurableOperationOutcome;
    if (!outcome || Array.isArray(outcome) || !['succeeded','not-applied','unknown','failed'].includes(outcome.kind) ||
      Object.keys(outcome).some(key => !['kind', outcome.kind === 'succeeded' ? 'output' : 'reason'].includes(key))) throw new Error('invalid-durable-operation-outcome');
    if (outcome.kind === 'succeeded') {
      if (!Object.hasOwn(outcome,'output') || !validator || validator.id !== operation.intent.outputSchema.id || validator.version !== operation.intent.outputSchema.version ||
        validator.validate(freezeJson(JSON.parse(canonical(outcome.output)))) !== true) throw new Error('durable-operation-output-invalid');
    } else if (typeof outcome.reason !== 'string' || !outcome.reason.trim()) throw new Error('invalid-durable-operation-outcome');
    return outcome;
  }
  private applyOperationOutcome(operation: DurableOperation, outcome: DurableOperationOutcome): void {
    operation.status = outcome.kind === 'not-applied' ? 'intent' : outcome.kind;
  }
  /** Only the issued owner may settle; control changes do not discard already issued observations. */
  settleOperation(claim: DurableClaim, input: DurableOperationAttemptToken, result: DurableOperationOutcome, validator?: DurableOperationValidator): DurableOperation {
    const token = JSON.parse(canonical(input)) as DurableOperationAttemptToken;
    const pinned = this.operation(this.fenced(claim), token.slotId);
    const outcome = this.operationOutcome(pinned, result, validator);
    return this.transaction(() => {
      const state = this.fenced(claim), operation = this.operation(state, token.slotId);
      const attempt = operation.attempts[token.attempt - 1];
      if (!attempt || digest({ operationId: attempt.operationId,slotId: attempt.slotId,commandId: attempt.commandId,attempt: attempt.attempt,ownerId: attempt.ownerId,epoch: attempt.epoch }) !== digest(token) || token.ownerId !== claim.ownerId || token.epoch !== claim.epoch) throw new Error('durable-operation-attempt-mismatch');
      if (attempt.outcome) { if (digest(attempt.outcome) !== digest(outcome)) throw new Error('durable-operation-outcome-conflict'); return operation; }
      if (attempt !== operation.attempts.at(-1) || operation.status !== 'inflight') throw new Error('durable-operation-outcome-conflict');
      attempt.outcome = outcome; this.applyOperationOutcome(operation, outcome);
      this.save(state, 'operation-settled'); return operation;
    });
  }
  /** A trusted adapter supplies an authoritative observation. Never retry an unclassified outcome. */
  reconcileOperation(claim: DurableClaim, input: DurableOperationAttemptToken, result: DurableOperationOutcome, validator?: DurableOperationValidator): DurableOperation {
    const token = JSON.parse(canonical(input)) as DurableOperationAttemptToken;
    const pinned = this.operation(this.fenced(claim), token.slotId);
    const outcome = this.operationOutcome(pinned, result, validator);
    return this.transaction(() => {
      const state = this.fenced(claim), operation = this.operation(state, token.slotId), attempt = operation.attempts[token.attempt - 1];
      if (!attempt) throw new Error('durable-operation-not-started');
      if (digest({ operationId: attempt.operationId,slotId: attempt.slotId,commandId: attempt.commandId,attempt: attempt.attempt,ownerId: attempt.ownerId,epoch: attempt.epoch }) !== digest(token)) throw new Error('durable-operation-attempt-mismatch');
      if (attempt.reconciliation && attempt.reconciliation.kind !== 'unknown') {
        if (digest(attempt.reconciliation) !== digest(outcome)) throw new Error('durable-operation-outcome-conflict');
        return operation;
      }
      if (!['inflight','unknown'].includes(operation.status)) throw new Error('durable-operation-not-uncertain');
      if (attempt !== operation.attempts.at(-1)) throw new Error('durable-operation-attempt-mismatch');
      if (operation.status === 'inflight' && attempt.ownerId === claim.ownerId && attempt.epoch === claim.epoch) throw new Error('durable-operation-still-inflight');
      if (attempt.reconciliation && digest(attempt.reconciliation) === digest(outcome)) return operation;
      attempt.reconciliation = outcome; this.applyOperationOutcome(operation, outcome);
      this.save(state, 'operation-reconciled'); return operation;
    });
  }
  events(runId: string, workspaceId: string, afterSequence = 0): Array<{ sequence: number; version: number; kind: string }> { this.row(runId, workspaceId); return this.db.prepare('SELECT sequence,version,kind FROM events WHERE run_id=? AND sequence>? ORDER BY sequence').all(runId, afterSequence); }
  backup(destination: string): void {
    if (resolve(destination) === resolve(this.path) || existsSync(destination)) throw new Error('durable-backup-destination-exists');
    const staged = `${destination}.staged-${randomUUID()}`;
    try {
      this.db.prepare('VACUUM INTO ?').run(staged); chmodSync(staged, 0o600);
      const copy = database(staged);
      try { copy.exec("PRAGMA synchronous=FULL; BEGIN IMMEDIATE; INSERT OR REPLACE INTO metadata VALUES ('dispatch-disabled','1'); UPDATE runs SET owner=NULL,pid=NULL,process_identity=NULL; COMMIT;"); } finally { copy.close(); }
      const fd = openSync(staged, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
      linkSync(staged, destination);
      const directoryFd = openSync(dirname(destination), 'r'); try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
    } finally { if (existsSync(staged)) unlinkSync(staged); }
  }
  close(): void { this.db.close(); this.key.fill(0); }
}
