/** P1 prototype only. No production imports/dispatch. Storage is the real receipt store. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listAgentMessageReceipts, writeAgentMessageReceipt } from '../../../shared/src/agent-messaging/storage.ts';
import type { AgentMessageReceipt } from '../../../shared/src/agent-messaging/types.ts';

export type Scope = { workspaceId: string; parentSessionId: string };
export type Request = { agentSlug: string; task: string };
export type Cut = 'reservation' | 'launch-intent' | 'receipt' | 'child' | 'execution' | 'bridge';
export type Record = Scope & { id: string; key: string; digest: string; request: Request; attemptId: string;
  state: 'reserved' | 'admitting' | 'running' | 'waiting_for_user' | 'cancelling' | 'cancelled' | 'succeeded' | 'interrupted';
  receiptId?: string; childSessionId?: string; executionId?: string; revision: number; questionId?: string; replyId?: string; replyDigest?: string };
export type CorrelatedReceipt = AgentMessageReceipt & { voiceTask: { intentId: string; admissionKey: string; requestDigest: string; attemptId: string } };
export type Deps = {
  root: string; scope: Scope;
  authorize: (scope: Scope) => void;
  capSupported: boolean;
  createChild: (receipt: CorrelatedReceipt) => Promise<string>;
  execute: (childId: string, attemptId: string) => Promise<void>;
  findChild: (intentId: string, attemptId: string) => string | undefined;
  cut?: (cut: Cut) => void;
};
const mutex = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = mutex.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  mutex.set(key, next);
  try { return await next; } finally { if (mutex.get(key) === next) mutex.delete(key); }
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

/** Proposed voice cap runs BEFORE standing permission/trusted-tool shortcuts. */
export function voiceActionAllowed(action: { taskId: string; attemptId: string; digest: string; kind: 'read' | 'draft' | 'external' | 'credentials' | 'destructive' }, grant?: { taskId: string; attemptId: string; digest: string; via: 'ui' | 'voice'; alwaysAllow: boolean }, _standingMode = 'allow-all') {
  if (action.kind === 'read' || action.kind === 'draft') return true; // host-classified bounded local operation only
  return !!grant && grant.via === 'ui' && !grant.alwaysAllow && grant.taskId === action.taskId
    && grant.attemptId === action.attemptId && grant.digest === action.digest;
}

export class AdmissionProof {
  constructor(private deps: Deps) {}
  private path(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('invalid_request');
    return join(this.deps.root, 'voice-tasks', `${id}.json`);
  }
  private assert(scope: Scope) {
    this.deps.authorize(scope);
    if (scope.workspaceId !== this.deps.scope.workspaceId || scope.parentSessionId !== this.deps.scope.parentSessionId) throw new Error('forbidden');
  }
  private save(record: Record) {
    const file = this.path(record.id);
    mkdirSync(join(this.deps.root, 'voice-tasks'), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(record)); renameSync(temp, file);
  }
  lookup(scope: Scope, id: string): Record {
    this.assert(scope);
    const record = JSON.parse(readFileSync(this.path(id), 'utf8')) as Record;
    this.assert(record);
    return record;
  }
  async reserve(scope: Scope, clientRequestId: string, request: Request) {
    this.assert(scope);
    if (!clientRequestId || clientRequestId.length > 200 || !/^[a-z0-9-]+$/.test(request.agentSlug) || !request.task.trim() || request.task.length > 8000) throw new Error('invalid_request');
    const id = hash([scope.workspaceId, scope.parentSessionId, clientRequestId]);
    const normalized = { agentSlug: request.agentSlug, task: request.task.trim() };
    const digest = hash(normalized);
    return locked(this.deps.root, async () => {
      if (existsSync(this.path(id))) {
        const record = this.lookup(scope, id);
        if (record.digest !== digest) throw new Error('duplicate_conflict');
        return record;
      }
      const record: Record = { ...scope, id, key: id, digest, request: normalized, attemptId: randomUUID(), state: 'reserved', revision: 1 };
      this.save(record); this.deps.cut?.('reservation'); return record;
    });
  }
  async launch(scope: Scope, id: string) {
    this.assert(scope);
    return locked(this.deps.root, async () => {
      const record = this.lookup(scope, id);
      if (record.state !== 'reserved') return record; // uncertain/restarted attempts never auto-launch
      if (!this.deps.capSupported) throw new Error('unsupported_capability');
      const active = readdirSync(join(this.deps.root, 'voice-tasks')).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(this.deps.root, 'voice-tasks', f), 'utf8')) as Record).filter(r => ['admitting', 'running', 'waiting_for_user', 'cancelling'].includes(r.state));
      if (active.length >= 2) throw new Error('capacity');
      record.state = 'admitting'; record.revision++; this.save(record); this.deps.cut?.('launch-intent');
      const receipt: CorrelatedReceipt = {
        schemaVersion: 1, id: randomUUID(), workspaceId: scope.workspaceId, parentSessionId: scope.parentSessionId,
        targetAgentSlug: record.request.agentSlug, task: record.request.task, status: 'running',
        policy: { permissionMode: 'ask', timeoutSeconds: 300, maxTurns: 1, maxDepth: 2, depth: 0, background: true },
        constraints: { sourceSlugs: [], skillSlugs: [] }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        voiceTask: { schemaVersion: 1, workspaceId: record.workspaceId, taskId: record.id, intentId: id, admissionKey: record.key, requestDigest: record.digest, attemptId: record.attemptId },
      };
      writeAgentMessageReceipt(this.deps.root, receipt); this.deps.cut?.('receipt');
      receipt.childSessionId = await this.deps.createChild(receipt); this.deps.cut?.('child');
      writeAgentMessageReceipt(this.deps.root, receipt);
      await this.deps.execute(receipt.childSessionId, record.attemptId); this.deps.cut?.('execution');
      Object.assign(record, { receiptId: receipt.id, childSessionId: receipt.childSessionId, state: 'running', executionId: record.attemptId, revision: record.revision + 1 });
      this.save(record); this.deps.cut?.('bridge'); return record;
    });
  }
  async recover(scope: Scope, id: string) {
    this.assert(scope);
    return locked(this.deps.root, async () => {
      const record = this.lookup(scope, id);
      if (record.state === 'reserved' || ['succeeded', 'cancelled', 'interrupted'].includes(record.state)) return record;
      const receipts = listAgentMessageReceipts(this.deps.root) as CorrelatedReceipt[];
      const receipt = receipts.find(r => r.workspaceId === scope.workspaceId && r.parentSessionId === scope.parentSessionId
        && r.voiceTask?.intentId === id && r.voiceTask.requestDigest === record.digest && r.voiceTask.attemptId === record.attemptId);
      // Receipt correlation recovers identity, never proves a lost in-process Promise is running.
      record.receiptId = receipt?.id; record.childSessionId = receipt?.childSessionId ?? this.deps.findChild(id, record.attemptId);
      record.state = 'interrupted'; record.questionId = undefined; record.revision++; this.save(record); return record;
    });
  }
  async outcome(scope: Scope, id: string, attemptId: string, outcome: 'question' | 'cancel-requested' | 'aborted' | 'committed' | 'promise-resolved') {
    return locked(this.deps.root, async () => {
      const record = this.lookup(scope, id);
      if (attemptId !== (outcome === 'cancel-requested' ? record.attemptId : record.executionId) || ['cancelled', 'succeeded', 'interrupted'].includes(record.state)) return record;
      if (record.state === 'cancelling' && outcome === 'question') return record;
      if (outcome === 'promise-resolved') return record;
      if (outcome === 'question') { record.state = 'waiting_for_user'; record.questionId = randomUUID(); }
      if (outcome === 'cancel-requested') record.state = 'cancelling';
      if (outcome === 'aborted') record.state = 'cancelled';
      if (outcome === 'committed' && record.state !== 'waiting_for_user') record.state = 'succeeded';
      record.revision++; this.save(record); return record;
    });
  }
  async reply(scope: Scope, id: string, attemptId: string, questionId: string, revision: number, replyId: string, text: string) {
    return locked(this.deps.root, async () => {
      const record = this.lookup(scope, id);
      if (!text.trim() || text.length > 8000) throw new Error('invalid_request');
      const digest = hash(text.trim());
      if (record.replyId === replyId && record.questionId === questionId && record.attemptId === attemptId) {
        if (record.replyDigest !== digest) throw new Error('duplicate_conflict');
        return record;
      }
      if (record.state !== 'waiting_for_user' || record.attemptId !== attemptId || record.questionId !== questionId || record.revision !== revision) throw new Error('stale_revision');
      // Reserve continuation before dispatch. Its receipt/execution generation is a NEW boundary in same child.
      record.replyId = replyId; record.replyDigest = digest; record.state = 'running'; record.executionId = `${attemptId}:reply:${replyId}`; record.revision++; this.save(record);
      await this.deps.execute(record.childSessionId!, `${attemptId}:reply:${replyId}`); return record;
    });
  }
}
