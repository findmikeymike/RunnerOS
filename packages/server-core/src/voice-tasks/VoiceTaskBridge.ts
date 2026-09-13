import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentMessageReceipt, MessageAgentResult, VoiceTaskCorrelation } from '@craft-agent/shared/agent-messaging';

const id = z.string().min(1).max(180).regex(/^[a-zA-Z0-9_.:-]+$/);
const uuid = z.string().uuid();
const contextRef = z.object({ kind: z.enum(['hq', 'campaign', 'release-kit', 'essentials']), id, revision: z.string().max(128).optional() }).strict();
export const voiceTaskRequestSchema = z.object({
  agentSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  taskModeId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100).optional(),
  title: z.string().trim().min(1).max(120), task: z.string().trim().min(1).max(8000),
  expectedOutput: z.string().trim().max(4000).optional(), contextRefs: z.array(contextRef).max(16),
}).strict();
export type VoiceTaskRequest = z.infer<typeof voiceTaskRequestSchema>;
export type VoiceTaskAuthority = { ownerId: string; workspaceId: string };
const states = z.enum(['admitting', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const outputSchema = z.object({ outputId: id, title: z.string().max(120) }).strict();
export type VoiceTaskOutputReference = z.infer<typeof outputSchema>;
const taskSchema = z.object({
  schemaVersion: z.literal(1), taskId: uuid, workspaceId: id, managerParentSessionId: id,
  attemptId: uuid, intentId: uuid, admissionKey: uuid, requestDigest: z.string().length(64),
  targetAgentSlug: id, title: z.string().max(120), contextRefs: z.array(contextRef).max(16),
  state: states, revision: z.number().int().positive(), receiptId: uuid.optional(), childSessionId: id.optional(),
  executionGeneration: z.number().int().nonnegative().optional(), outputs: z.array(outputSchema).max(100),
  cancelRequestIds: z.array(id).max(100), createdAt: z.string(), updatedAt: z.string(),
}).strict();
export type VoiceTask = z.infer<typeof taskSchema>;
const intentSchema = z.object({
  intentId: uuid, clientRequestId: id, managerParentSessionId: id, requestDigest: z.string().length(64),
  request: voiceTaskRequestSchema, turnId: id, invocationId: id,
  state: z.enum(['pending', 'admitted', 'unknown']), taskId: uuid.optional(), createdAt: z.string(),
}).strict();
type StoredIntent = z.infer<typeof intentSchema>;
export type VoiceTaskIntent = Omit<StoredIntent, 'request'> & { title: string };
const eventSchema = z.object({
  version: z.literal(1), eventId: uuid, workspaceId: id, taskId: uuid, attemptId: uuid,
  revision: z.number().int().positive(), streamSequence: z.number().int().positive(), occurredAt: z.string(),
  kind: z.enum(['admitted', 'completed', 'failed', 'cancel_requested', 'cancelled', 'interrupted']),
  payload: taskSchema,
}).strict();
export type VoiceTaskEvent = z.infer<typeof eventSchema>;
const deliveryIdentitySchema = z.object({
  deliveryId: uuid, leaseId: uuid, bindingGeneration: z.number().int().positive(),
  taskId: uuid, attemptId: uuid, revision: z.number().int().positive(),
});
export type VoiceTaskDeliveryIdentity = z.infer<typeof deliveryIdentitySchema>;
export type VoiceTaskDeliveryHandle = VoiceTaskDeliveryIdentity & { text: string; expiresAt: string };
const deliveryOutcomeSchema = z.enum(['delivered', 'interrupted', 'failed']);
export type VoiceTaskDeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;
const deliverySchema = deliveryIdentitySchema.extend({
  bindingId: uuid, ownerId: id, callId: id, voiceSessionId: id, hostEpoch: uuid,
  text: z.string().max(400), startedAt: z.number().finite(), expiresAt: z.number().finite(),
  outcome: deliveryOutcomeSchema.optional(), completedAt: z.number().finite().optional(),
}).strict();
type StoredDelivery = z.infer<typeof deliverySchema>;
export const VOICE_TASK_DELIVERY_LEASE_MS = 15_000;
export const VOICE_TASK_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const journalSchema = z.object({
  schemaVersion: z.literal(1), hostEpoch: uuid, workspaceId: id, managerParentSessionId: id.optional(),
  sequence: z.number().int().nonnegative(), intents: z.array(intentSchema), tasks: z.array(taskSchema), events: z.array(eventSchema).max(256), deliveries: z.array(deliverySchema).default([]),
}).strict();
type Journal = z.infer<typeof journalSchema>;
export interface VoiceTaskBridgeHost {
  getWorkspaceRoot(workspaceId: string): string;
  createManager(workspaceId: string): Promise<string>;
  assertParent(workspaceId: string, parentId: string): Promise<void>;
  validateRequest(workspaceId: string, request: VoiceTaskRequest): Promise<void>;
  dispatch(workspaceId: string, parentId: string, request: VoiceTaskRequest, correlation: VoiceTaskCorrelation): Promise<MessageAgentResult>;
  findReceipt(workspaceId: string, correlation: VoiceTaskCorrelation): AgentMessageReceipt | null;
  recoverChild(workspaceId: string, parentId: string, correlation: VoiceTaskCorrelation): string | undefined;
  cancelChild(workspaceId: string, parentId: string, childId: string, correlation: VoiceTaskCorrelation): Promise<void>;
  outputs(workspaceId: string, childId: string): VoiceTaskOutputReference[];
  onReceiptChanged(listener: (receipt: AgentMessageReceipt) => void): () => void;
}
export class VoiceTaskBridgeError extends Error {
  constructor(public readonly code: 'invalid_request' | 'forbidden' | 'stale_binding' | 'duplicate_conflict' | 'capacity' | 'persistence_failed' | 'unsupported_capability' | 'not_found' | 'unknown_outcome', message: string) { super(message); }
}
const epoch = randomUUID();
const locks = new Map<string, Promise<void>>();
function serial<T>(key: string, operation: () => Promise<T> | T): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  const drain = next.then(() => {}, () => {});
  locks.set(key, drain);
  void drain.then(() => { if (locks.get(key) === drain) locks.delete(key); });
  return next;
}
const terminal = (state: VoiceTask['state']) => !['admitting', 'running', 'cancelling'].includes(state);
const safe = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
function publicIntent(intent: StoredIntent): VoiceTaskIntent { const { request, ...rest } = intent; return { ...structuredClone(rest), title: safe(request.title) }; }
function digest(request: VoiceTaskRequest): string { return createHash('sha256').update(JSON.stringify(request)).digest('hex'); }
function correlation(task: VoiceTask): VoiceTaskCorrelation { return { schemaVersion: 1, workspaceId: task.workspaceId, taskId: task.taskId, attemptId: task.attemptId, intentId: task.intentId, admissionKey: task.admissionKey, requestDigest: task.requestDigest }; }
function sameCorrelation(a: VoiceTaskCorrelation | undefined, b: VoiceTaskCorrelation): boolean { return !!a && Object.keys(b).every(key => a[key as keyof VoiceTaskCorrelation] === b[key as keyof VoiceTaskCorrelation]); }

type Binding = { bindingId: string; generation: number; ownerId: string; workspaceId: string; managerParentSessionId: string; voiceSessionId: string; callId: string };
export class VoiceTaskBridge {
  private bindings = new Map<string, Binding>();
  private listeners = new Map<string, Set<(event: VoiceTaskEvent) => void>>();
  private generation = 0;
  private removeReceiptListener: () => void;
  constructor(private host: VoiceTaskBridgeHost, private options: { enabled?: () => boolean; now?: () => number; validateAuthority?: (authority: VoiceTaskAuthority, attachment: { voiceSessionId: string; callId: string }) => void; writeJournal?: (file: string, value: string) => void } = {}) {
    this.removeReceiptListener = host.onReceiptChanged(receipt => {
      if (!receipt.voiceTask) return;
      // Service notifications are projections; storage is re-read under workspace admission lock.
      void this.withWorkspace(receipt.workspaceId, async (journal, file) => {
        const before = journal.sequence;
        const task = journal.tasks.find(item => item.taskId === receipt.voiceTask!.taskId);
        if (task) this.reconcileTask(journal, task);
        this.save(file, journal);
        this.emitAfterSave(journal, before);
      }).catch(() => { /* snapshot surfaces persistence failure/reconciliation; never relaunch */ });
    });
  }
  dispose(): void { this.removeReceiptListener(); this.bindings.clear(); this.listeners.clear(); }
  private requireEnabled(): void { if (!this.options.enabled?.()) throw new VoiceTaskBridgeError('unsupported_capability', 'Background voice work is unavailable. Use Command.'); }
  private auth(authority: VoiceTaskAuthority, bindingId: string, validateLive = true): Binding {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new VoiceTaskBridgeError('stale_binding', 'Reconnect the call.');
    if (binding.ownerId !== authority.ownerId || binding.workspaceId !== authority.workspaceId) throw new VoiceTaskBridgeError('forbidden', 'This call does not own that task workspace.');
    if (validateLive) this.options.validateAuthority?.(authority, binding);
    return binding;
  }
  private save(file: string, journal: Journal): void {
    try {
      const value = JSON.stringify(journalSchema.parse(journal));
      if (this.options.writeJournal) { this.options.writeJournal(file, value); return; }
      const temp = `${file}.${randomUUID()}.tmp`;
      const fd = openSync(temp, 'wx', 0o600);
      try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file);
    } catch { throw new VoiceTaskBridgeError('persistence_failed', 'Could not save the task record. Reconcile before retrying.'); }
  }
  private async withWorkspace<T>(workspaceId: string, operation: (journal: Journal, file: string) => Promise<T> | T): Promise<T> {
    const root = realpathSync(this.host.getWorkspaceRoot(workspaceId));
    return serial(root, async () => {
      const dir = join(root, 'voice-tasks');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      // Refuse symlinked journals/directories: the host root is the only writable authority.
      if (realpathSync(dir) !== dir) throw new VoiceTaskBridgeError('forbidden', 'Task storage is outside this workspace.');
      const file = join(dir, 'bridge-v1.json');
      let journal: Journal;
      if (existsSync(file)) {
        if (realpathSync(file) !== file) throw new VoiceTaskBridgeError('forbidden', 'Task storage is outside this workspace.');
        const parsed = journalSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
        if (!parsed.success) throw new VoiceTaskBridgeError('unsupported_capability', 'Task storage version is unsupported. Use Command.');
        journal = parsed.data;
        if (journal.workspaceId !== workspaceId) throw new VoiceTaskBridgeError('forbidden', 'Task workspace mismatch.');
      } else journal = { schemaVersion: 1, hostEpoch: epoch, workspaceId, sequence: 0, intents: [], tasks: [], events: [], deliveries: [] };
      if (journal.hostEpoch !== epoch) {
        for (const delivery of journal.deliveries) if (!delivery.outcome) {
          delivery.outcome = 'interrupted'; delivery.completedAt = this.now();
        }
        for (const task of journal.tasks) if (!terminal(task.state)) {
          const receipt = this.host.findReceipt(workspaceId, correlation(task));
          if (receipt) {
            if (!sameCorrelation(receipt.voiceTask, correlation(task)) || receipt.workspaceId !== workspaceId || receipt.parentSessionId !== task.managerParentSessionId) throw new VoiceTaskBridgeError('forbidden', 'Recovered task receipt ownership mismatch.');
            task.receiptId = receipt.id;
            task.childSessionId = receipt.childSessionId ?? this.host.recoverChild(workspaceId, task.managerParentSessionId, correlation(task));
            this.reconcileTask(journal, task);
            if (terminal(task.state) && task.state !== 'interrupted') {
              const intent = journal.intents.find(item => item.intentId === task.intentId);
              if (intent) intent.state = 'admitted';
              continue;
            }
          } else task.childSessionId = this.host.recoverChild(workspaceId, task.managerParentSessionId, correlation(task));
          task.state = 'interrupted';
          this.event(journal, task, 'interrupted');
          const intent = journal.intents.find(item => item.intentId === task.intentId);
          if (intent) intent.state = 'unknown';
        }
        journal.hostEpoch = epoch;
        this.save(file, journal);
      }
      let changed = false;
      for (const delivery of journal.deliveries) if (!delivery.outcome && (delivery.hostEpoch !== epoch || delivery.expiresAt <= this.now())) {
        delivery.outcome = 'interrupted'; delivery.completedAt = this.now(); changed = true;
      }
      const retained = journal.deliveries.filter(delivery => this.now() - (delivery.completedAt ?? delivery.startedAt) <= VOICE_TASK_DELIVERY_RETENTION_MS);
      if (retained.length !== journal.deliveries.length) { journal.deliveries = retained; changed = true; }
      if (changed) this.save(file, journal);
      return operation(journal, file);
    });
  }
  private now(): number { return this.options.now?.() ?? Date.now(); }
  private event(journal: Journal, task: VoiceTask, kind: VoiceTaskEvent['kind']): void {
    task.revision++;
    task.updatedAt = new Date().toISOString();
    journal.events.push({ version: 1, eventId: randomUUID(), workspaceId: task.workspaceId, taskId: task.taskId, attemptId: task.attemptId, revision: task.revision, streamSequence: ++journal.sequence, occurredAt: task.updatedAt, kind, payload: structuredClone(task) });
    journal.events = journal.events.slice(-256);
  }
  private emitAfterSave(journal: Journal, after: number): void {
    if (!this.options.enabled?.()) return;
    for (const [bindingId, listeners] of this.listeners) {
      const binding = this.bindings.get(bindingId);
      if (!binding || binding.workspaceId !== journal.workspaceId || binding.managerParentSessionId !== journal.managerParentSessionId) continue;
      for (const event of journal.events.filter(event => event.streamSequence > after)) for (const listener of listeners) {
        try { listener(structuredClone(event)); } catch { /* consumers cannot corrupt a committed task */ }
      }
    }
  }
  private reconcileTask(journal: Journal, task: VoiceTask): void {
    if (terminal(task.state)) return;
    const receipt = this.host.findReceipt(task.workspaceId, correlation(task));
    if (!receipt) return;
    if (!sameCorrelation(receipt.voiceTask, correlation(task)) || receipt.parentSessionId !== task.managerParentSessionId || receipt.workspaceId !== task.workspaceId) throw new VoiceTaskBridgeError('forbidden', 'Task receipt ownership mismatch.');
    task.receiptId = receipt.id;
    task.childSessionId = receipt.childSessionId ?? task.childSessionId;
    task.executionGeneration = receipt.executionOutcome?.generation;
    if (receipt.status === 'running') return;
    task.outputs = receipt.childSessionId ? this.host.outputs(task.workspaceId, receipt.childSessionId).filter(output => receipt.executionOutcome?.outputIds?.includes(output.outputId)).map(output => ({ outputId: output.outputId, title: safe(output.title) })).slice(0,100) : [];
    // A provider turn ending is not proof of saved work. Require durable output provenance.
    task.state = receipt.status === 'succeeded' && receipt.executionOutcome?.reason === 'complete' && task.outputs.length > 0 ? 'succeeded'
      : receipt.error?.code === 'unknown-outcome' ? 'interrupted' : receipt.status === 'cancelled' ? 'cancelled'
      : receipt.status === 'timed-out' ? 'timed_out' : 'failed';
    this.event(journal, task, task.state === 'succeeded' ? 'completed' : task.state === 'cancelled' ? 'cancelled' : task.state === 'interrupted' ? 'interrupted' : 'failed');
    // Emission is performed by caller only after its atomic save.
  }
  async bind(authority: VoiceTaskAuthority, input: { voiceSessionId: string; callId: string }) {
    this.requireEnabled();
    id.parse(authority.ownerId); id.parse(authority.workspaceId); id.parse(input.voiceSessionId); id.parse(input.callId);
    return this.withWorkspace(authority.workspaceId, async (journal, file) => {
      if (!journal.managerParentSessionId) {
        journal.managerParentSessionId = await this.host.createManager(authority.workspaceId);
        this.save(file, journal);
      }
      await this.host.assertParent(authority.workspaceId, journal.managerParentSessionId);
      this.requireEnabled();
      this.options.validateAuthority?.(authority, input);
      const existing = Array.from(this.bindings.values()).find(binding => binding.ownerId === authority.ownerId && binding.workspaceId === authority.workspaceId && binding.voiceSessionId === input.voiceSessionId && binding.callId === input.callId);
      if (existing) return { bindingId: existing.bindingId, generation: existing.generation, managerParentSessionId: existing.managerParentSessionId, capabilities: { nativeTasks: true } };
      const binding: Binding = { ...authority, ...input, bindingId: randomUUID(), generation: ++this.generation, managerParentSessionId: journal.managerParentSessionId };
      this.bindings.set(binding.bindingId, binding);
      return { bindingId: binding.bindingId, generation: binding.generation, managerParentSessionId: binding.managerParentSessionId, capabilities: { nativeTasks: true } };
    });
  }
  private async authorized<T>(authority: VoiceTaskAuthority, bindingId: string, operation: (journal: Journal, file: string, binding: Binding) => Promise<T> | T): Promise<T> {
    const binding = this.auth(authority, bindingId);
    return this.withWorkspace(authority.workspaceId, async (journal, file) => {
      this.auth(authority, bindingId);
      if (journal.managerParentSessionId !== binding.managerParentSessionId) throw new VoiceTaskBridgeError('forbidden', 'Task parent mismatch.');
      await this.host.assertParent(authority.workspaceId, binding.managerParentSessionId);
      this.auth(authority, bindingId);
      return operation(journal, file, binding);
    });
  }
  async reserveIntent(authority: VoiceTaskAuthority, bindingId: string, input: { clientRequestId: string; turnId: string; invocationId: string; request: VoiceTaskRequest }): Promise<VoiceTaskIntent> {
    this.requireEnabled();
    const request = voiceTaskRequestSchema.parse(input.request);
    id.parse(input.clientRequestId); id.parse(input.turnId); id.parse(input.invocationId);
    // Sort explicit context references to give semantically identical scope a stable digest.
    request.contextRefs.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return this.authorized(authority, bindingId, async (journal, file, binding) => {
      const hash = digest(request);
      const existing = journal.intents.find(intent => intent.clientRequestId === input.clientRequestId);
      if (existing) {
        if (existing.requestDigest !== hash) throw new VoiceTaskBridgeError('duplicate_conflict', 'This request identity already has a different task scope.');
        return publicIntent(existing);
      }
      await this.host.validateRequest(authority.workspaceId, request);
      this.auth(authority, bindingId); this.requireEnabled();
      const intent: StoredIntent = { intentId: randomUUID(), clientRequestId: input.clientRequestId, managerParentSessionId: binding.managerParentSessionId, requestDigest: hash, request, turnId: input.turnId, invocationId: input.invocationId, state: 'pending', createdAt: new Date().toISOString() };
      journal.intents.push(intent);
      this.save(file, journal);
      return publicIntent(intent);
    });
  }
  async lookupIntent(authority: VoiceTaskAuthority, bindingId: string, clientRequestId: string): Promise<VoiceTaskIntent | null> {
    id.parse(clientRequestId);
    return this.authorized(authority, bindingId, journal => { const intent = journal.intents.find(item => item.clientRequestId === clientRequestId); return intent ? publicIntent(intent) : null; });
  }
  async launch(authority: VoiceTaskAuthority, bindingId: string, intentId: string): Promise<VoiceTask> {
    this.requireEnabled(); uuid.parse(intentId);
    return this.authorized(authority, bindingId, async (journal, file, binding) => {
      const intent = journal.intents.find(item => item.intentId === intentId);
      if (!intent) throw new VoiceTaskBridgeError('not_found', 'Task reservation was not found.');
      const existing = journal.tasks.find(task => task.intentId === intentId);
      if (existing) return structuredClone(existing);
      if (intent.state !== 'pending') throw new VoiceTaskBridgeError('unknown_outcome', 'Reconcile this reservation in Command.');
      await this.host.validateRequest(authority.workspaceId, intent.request);
      this.auth(authority, bindingId); this.requireEnabled();
      if (journal.tasks.filter(task => !terminal(task.state) || task.state === 'interrupted').length >= 2) throw new VoiceTaskBridgeError('capacity', 'Two tasks are active. Finish or cancel one first.');
      const now = new Date().toISOString();
      const task: VoiceTask = { schemaVersion: 1, taskId: randomUUID(), attemptId: randomUUID(), intentId, admissionKey: randomUUID(), requestDigest: intent.requestDigest, workspaceId: authority.workspaceId, managerParentSessionId: binding.managerParentSessionId, targetAgentSlug: intent.request.agentSlug, title: safe(intent.request.title), contextRefs: intent.request.contextRefs, state: 'admitting', revision: 1, outputs: [], cancelRequestIds: [], createdAt: now, updatedAt: now };
      journal.tasks.push(task); intent.taskId = task.taskId; intent.state = 'unknown';
      this.save(file, journal); // Durable launch cut: never retry execution from this point.
      const before = journal.sequence;
      try {
        const result = await this.host.dispatch(authority.workspaceId, binding.managerParentSessionId, intent.request, correlation(task));
        if (result.receiptId) task.receiptId = result.receiptId;
        if (result.childSessionId) task.childSessionId = result.childSessionId;
        task.state = result.ok && result.status === 'running' && !!result.receiptId && !!result.childSessionId ? 'running' : 'failed';
        intent.state = 'admitted';
        this.event(journal, task, task.state === 'running' ? 'admitted' : 'failed');
        this.reconcileTask(journal, task);
        this.save(file, journal);
      } catch {
        task.state = 'interrupted'; intent.state = 'unknown'; this.event(journal, task, 'interrupted'); this.save(file, journal);
      }
      this.emitAfterSave(journal, before);
      return structuredClone(task);
    });
  }
  async snapshot(authority: VoiceTaskAuthority, bindingId: string, cursor = 0) {
    return this.authorized(authority, bindingId, (journal, file, binding) => {
      const before = journal.sequence;
      for (const task of journal.tasks) {
        this.reconcileTask(journal, task);
        if (terminal(task.state) && task.childSessionId) {
          const available = new Set(this.host.outputs(task.workspaceId, task.childSessionId).map(output => output.outputId));
          task.outputs = task.outputs.filter(output => available.has(output.outputId));
        }
      }
      this.save(file, journal); this.emitAfterSave(journal, before);
      return { pendingDeliveries: this.pendingDeliveries(journal, binding), tasks: structuredClone(journal.tasks.slice(-100)), intents: journal.intents.filter(intent => intent.state !== 'admitted').slice(-100).map(publicIntent), cursor: journal.sequence, resyncRequired: cursor > journal.sequence || (cursor > 0 && cursor < (journal.events[0]?.streamSequence ?? 1) - 1) };
    });
  }
  async subscribe(authority: VoiceTaskAuthority, bindingId: string, cursor: number, listener: (event: VoiceTaskEvent) => void): Promise<() => void> {
    this.requireEnabled();
    return this.authorized(authority, bindingId, journal => {
      this.requireEnabled();
      if (!Number.isInteger(cursor) || cursor < 0 || cursor > journal.sequence || cursor < (journal.events[0]?.streamSequence ?? 1) - 1) throw new VoiceTaskBridgeError('stale_binding', 'Event replay exhausted. Refresh the task snapshot.');
      const listeners = this.listeners.get(bindingId) ?? new Set(); listeners.add(listener); this.listeners.set(bindingId, listeners);
      for (const event of journal.events.filter(event => event.streamSequence > cursor)) listener(structuredClone(event));
      return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(bindingId); };
    });
  }
  async cancel(authority: VoiceTaskAuthority, bindingId: string, input: { taskId: string; attemptId: string; requestId: string }): Promise<VoiceTask> {
    uuid.parse(input.taskId); uuid.parse(input.attemptId); id.parse(input.requestId);
    return this.authorized(authority, bindingId, async (journal, file, binding) => {
      const task = journal.tasks.find(item => item.taskId === input.taskId && item.attemptId === input.attemptId);
      if (!task) throw new VoiceTaskBridgeError('not_found', 'Task attempt was not found.');
      this.reconcileTask(journal, task);
      if (terminal(task.state) || task.cancelRequestIds.includes(input.requestId)) { this.save(file, journal); return structuredClone(task); }
      const before = journal.sequence;
      task.cancelRequestIds.push(input.requestId); task.state = 'cancelling'; this.event(journal, task, 'cancel_requested'); this.save(file, journal);
      if (task.childSessionId) await this.host.cancelChild(authority.workspaceId, binding.managerParentSessionId, task.childSessionId, correlation(task));
      this.reconcileTask(journal, task); this.save(file, journal); this.emitAfterSave(journal, before);
      return structuredClone(task);
    });
  }
  async validateOutputReference(authority: VoiceTaskAuthority, bindingId: string, taskId: string, outputId: string): Promise<VoiceTaskOutputReference> {
    uuid.parse(taskId); id.parse(outputId);
    return this.authorized(authority, bindingId, journal => {
      const task = journal.tasks.find(item => item.taskId === taskId);
      if (!task?.childSessionId) throw new VoiceTaskBridgeError('not_found', 'Task output is unavailable.');
      const output = this.host.outputs(authority.workspaceId, task.childSessionId).find(output => output.outputId === outputId);
      if (!output) throw new VoiceTaskBridgeError('not_found', 'Task output is unavailable.');
      return { outputId: output.outputId, title: safe(output.title) };
    });
  }
  private pendingDeliveries(journal: Journal, binding: Binding): { taskId: string; attemptId: string; revision: number }[] {
    return journal.tasks.filter(task => {
      const age = this.now() - Date.parse(task.updatedAt);
      if (!terminal(task.state) || age < 0 || age > VOICE_TASK_DELIVERY_RETENTION_MS) return false;
      const matching = journal.deliveries.filter(delivery => delivery.taskId === task.taskId && delivery.attemptId === task.attemptId && delivery.revision === task.revision);
      if (matching.some(delivery => delivery.outcome === 'delivered')) return false;
      const attempts = matching.filter(delivery => delivery.callId === binding.callId && delivery.voiceSessionId === binding.voiceSessionId && delivery.ownerId === binding.ownerId);
      // Filter before truncation: exhausted or missing-artifact records must not starve later deliverable results.
      // An active owned second attempt remains visible so duplicate claims return its existing handle.
      if (attempts.length >= 2 && !attempts.some(delivery => !delivery.outcome && delivery.bindingId === binding.bindingId && delivery.bindingGeneration === binding.generation)) return false;
      try { return this.deliveryText(task) !== null; } catch { return false; }
    }).sort((a,b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0,100)
      .map(task => ({ taskId: task.taskId, attemptId: task.attemptId, revision: task.revision }));
  }
  private deliveryHandle(delivery: StoredDelivery): VoiceTaskDeliveryHandle {
    return { deliveryId: delivery.deliveryId, leaseId: delivery.leaseId, bindingGeneration: delivery.bindingGeneration,
      taskId: delivery.taskId, attemptId: delivery.attemptId, revision: delivery.revision, text: delivery.text, expiresAt: new Date(delivery.expiresAt).toISOString() };
  }
  private deliveryText(task: VoiceTask): string | null {
    if (task.state === 'succeeded') {
      const receipt = this.host.findReceipt(task.workspaceId, correlation(task));
      if (!receipt || !sameCorrelation(receipt.voiceTask, correlation(task)) || receipt.parentSessionId !== task.managerParentSessionId || receipt.workspaceId !== task.workspaceId
        || receipt.status !== 'succeeded' || receipt.executionOutcome?.reason !== 'complete' || receipt.childSessionId !== task.childSessionId || !task.childSessionId) return null;
      const valid = this.host.outputs(task.workspaceId, task.childSessionId).some(output => receipt.executionOutcome?.outputIds?.includes(output.outputId) && task.outputs.some(saved => saved.outputId === output.outputId));
      return valid ? 'Your draft is saved in Outputs. You can open it from the task.' : null;
    }
    if (task.state === 'cancelled') return 'That background task has been cancelled.';
    if (task.state === 'timed_out') return 'That background task timed out. Check Command for its details.';
    if (task.state === 'interrupted') return 'That background task was interrupted. Its result is uncertain; check Command before retrying.';
    if (task.state === 'failed') return 'The background task could not finish. Its details are available in Command.';
    return null;
  }
  async claimDelivery(authority: VoiceTaskAuthority, bindingId: string, input: { taskId: string; attemptId: string; revision: number }): Promise<VoiceTaskDeliveryHandle | null> {
    this.requireEnabled();
    uuid.parse(input.taskId); uuid.parse(input.attemptId); z.number().int().positive().parse(input.revision);
    return this.authorized(authority, bindingId, (journal, file, binding) => {
      this.requireEnabled();
      const task = journal.tasks.find(task => task.taskId === input.taskId && task.attemptId === input.attemptId && task.revision === input.revision);
      if (!task || !this.pendingDeliveries(journal, binding).some(pending => pending.taskId === input.taskId && pending.attemptId === input.attemptId && pending.revision === input.revision)) return null;
      const text = this.deliveryText(task);
      if (!text) return null;
      const active = journal.deliveries.find(delivery => !delivery.outcome);
      if (active) {
        if (active.hostEpoch === epoch && active.bindingId === bindingId && active.bindingGeneration === binding.generation
          && active.taskId === input.taskId && active.attemptId === input.attemptId && active.revision === input.revision) return this.deliveryHandle(active);
        return null;
      }
      // At most the initial announcement plus one retry in this call. Failed attempts remain pending for another call.
      const attempts = journal.deliveries.filter(delivery => delivery.taskId === input.taskId && delivery.attemptId === input.attemptId && delivery.revision === input.revision
        && delivery.callId === binding.callId && delivery.voiceSessionId === binding.voiceSessionId && delivery.ownerId === authority.ownerId);
      if (attempts.length >= 2) return null;
      const delivery: StoredDelivery = { ...input, deliveryId: randomUUID(), leaseId: randomUUID(), bindingGeneration: binding.generation,
        bindingId, ownerId: authority.ownerId, callId: binding.callId, voiceSessionId: binding.voiceSessionId, hostEpoch: epoch,
        text, startedAt: this.now(), expiresAt: this.now() + VOICE_TASK_DELIVERY_LEASE_MS };
      journal.deliveries.push(delivery);
      this.save(file, journal);
      return this.deliveryHandle(delivery);
    });
  }
  private ownedDelivery(journal: Journal, binding: Binding, input: VoiceTaskDeliveryIdentity): StoredDelivery {
    const delivery = journal.deliveries.find(delivery => delivery.deliveryId === input.deliveryId);
    if (!delivery || delivery.leaseId !== input.leaseId || delivery.bindingGeneration !== input.bindingGeneration || delivery.bindingId !== binding.bindingId
      || delivery.ownerId !== binding.ownerId || delivery.hostEpoch !== epoch || binding.generation !== input.bindingGeneration
      || delivery.taskId !== input.taskId || delivery.attemptId !== input.attemptId || delivery.revision !== input.revision) throw new VoiceTaskBridgeError('stale_binding', 'This playback acknowledgement no longer owns the delivery.');
    const task = journal.tasks.find(task => task.taskId === input.taskId && task.attemptId === input.attemptId && task.revision === input.revision);
    if (!task) throw new VoiceTaskBridgeError('stale_binding', 'The task result changed during playback.');
    return delivery;
  }
  async renewDelivery(authority: VoiceTaskAuthority, bindingId: string, input: VoiceTaskDeliveryIdentity): Promise<VoiceTaskDeliveryHandle | null> {
    this.requireEnabled();
    const identity = deliveryIdentitySchema.parse(input);
    return this.authorized(authority, bindingId, (journal, file, binding) => {
      this.requireEnabled();
      const delivery = this.ownedDelivery(journal, binding, identity);
      if (delivery.outcome || delivery.expiresAt <= this.now()) return null;
      delivery.expiresAt = this.now() + VOICE_TASK_DELIVERY_LEASE_MS;
      this.save(file, journal);
      return this.deliveryHandle(delivery);
    });
  }
  async acknowledgeDelivery(authority: VoiceTaskAuthority, bindingId: string, input: VoiceTaskDeliveryIdentity & { outcome: VoiceTaskDeliveryOutcome }): Promise<{ acknowledged: true; outcome: VoiceTaskDeliveryOutcome; text?: string }> {
    const identity = deliveryIdentitySchema.parse(input);
    const outcome = deliveryOutcomeSchema.parse(input.outcome);
    if (outcome === 'delivered') this.requireEnabled();
    return this.authorized(authority, bindingId, (journal, file, binding) => {
      if (outcome === 'delivered') this.requireEnabled();
      const delivery = this.ownedDelivery(journal, binding, identity);
      if (delivery.outcome) {
        if (delivery.outcome !== outcome) throw new VoiceTaskBridgeError('duplicate_conflict', 'Playback outcome conflicts with the recorded acknowledgement.');
        return { acknowledged: true, outcome, ...(outcome === 'delivered' ? { text: delivery.text } : {}) };
      }
      if (delivery.expiresAt <= this.now()) throw new VoiceTaskBridgeError('stale_binding', 'This playback lease expired.');
      delivery.outcome = outcome; delivery.completedAt = this.now();
      this.save(file, journal);
      return { acknowledged: true, outcome, ...(outcome === 'delivered' ? { text: delivery.text } : {}) };
    });
  }
  async detach(authority: VoiceTaskAuthority, bindingId: string): Promise<void> {
    const binding = this.auth(authority, bindingId, false);
    // Invalidate synchronously before waiting for storage; queued operations cannot use this attachment.
    this.bindings.delete(bindingId); this.listeners.delete(bindingId);
    void this.withWorkspace(authority.workspaceId, (journal, file) => {
      let changed = false;
      for (const delivery of journal.deliveries) if (!delivery.outcome && delivery.bindingId === bindingId && delivery.ownerId === authority.ownerId && delivery.bindingGeneration === binding.generation) {
        delivery.outcome = 'interrupted'; delivery.completedAt = this.now(); changed = true;
      }
      if (changed) this.save(file, journal);
    }).catch(() => { /* binding is already invalid; expiry/restart returns unfinished delivery to pending */ });
  }
}
