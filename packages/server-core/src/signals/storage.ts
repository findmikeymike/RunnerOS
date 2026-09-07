import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { SignalLedgerEntry, SignalRunIdentity, SignalRunSummary, SignalSourceCoverage, SignalTrack, SignalTrackConfig, SignalVideoMetadata } from '@craft-agent/shared/shared-intel';
import type { SignalTranscript } from './SignalProvider';
import type { SignalWebsitePacket as CollectedWebsitePacket } from './website-collector';

export interface SignalPacket { id: string; metadata: SignalVideoMetadata; transcript?: SignalTranscript; contentHash: string; excludedFromSynthesis?: boolean }
export interface SignalWebsitePacket { id: string; url: string; content?: CollectedWebsitePacket; contentHash: string; checkedAt: string; excludedFromSynthesis?: boolean }
export interface SignalRequest extends SignalRunSummary {
  idempotencyKey: string; requestHash: string; config: SignalTrackConfig; identity: SignalRunIdentity;
  coverage: SignalSourceCoverage[]; selected: SignalVideoMetadata[]; packets: SignalPacket[];
  websites: SignalWebsitePacket[];
  collectionComplete?: boolean; workflowDigest: string; outputHash?: string; reportMetadataHash?: string; examinedVideoIds?: string[];
  attempts?: Array<{ fromRunId: string; runId: string }>;
  refusedAttempts?: Array<{ fromRunId: string; runId: string }>;
  queueEvent?: { matcherId: string; eventTimestamp: number; eventKey: string };
}
export interface SignalStore { version: 1; hqWorkspaceId: string; tracks: Record<SignalTrack, SignalTrackConfig>; requests: SignalRequest[]; ledger: SignalLedgerEntry[]; latestScan: Partial<Record<SignalTrack, string>> }
export function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function readSignals(root: string, hqWorkspaceId: string): SignalStore {
  const path = join(root, 'signals', 'state.json');
  if (existsSync(path)) {
    const raw = readFileSync(path);
    if (raw.length > 64 * 1024 * 1024) throw new Error('Signals state exceeds supported size.');
    const value = JSON.parse(raw.toString('utf8')) as SignalStore;
    if (value.version !== 1 || value.hqWorkspaceId !== hqWorkspaceId || !Array.isArray(value.requests) || !Array.isArray(value.ledger)) throw new Error('Signals state is invalid.');
    return value;
  }
  const config = (track: SignalTrack): SignalTrackConfig => ({ version: 1, track, enabled: false, cadence: 'manual', sinceDays: 7, maxPerChannel: 1, sources: [], revision: 'initial', updatedAt: new Date().toISOString() });
  return { version: 1, hqWorkspaceId, tracks: { industry: config('industry'), 'your-world': config('your-world') }, requests: [], ledger: [], latestScan: {} };
}
export function writeSignals(root: string, state: SignalStore): void {
  const dir = join(root, 'signals');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'state.json');
  const temp = `${path}.${randomUUID()}.tmp`;
  const journal = structuredClone(state);
  for (const request of journal.requests) {
    for (const packet of request.packets) {
      if (packet.transcript) saveEvidence(root, packet.contentHash, packet.transcript);
      delete packet.transcript;
    }
    for (const packet of request.websites) {
      if (packet.content !== undefined) saveEvidence(root, packet.contentHash, packet.content);
      delete packet.content;
    }
  }
  try { writeFileSync(temp, JSON.stringify(journal), { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
export function saveEvidence(root: string, contentHash: string, value: unknown): void {
  if (!/^[a-f0-9]{64}$/.test(contentHash) || hash(value) !== contentHash) throw new Error('Invalid Signals evidence hash.');
  const dir = join(root, 'signals', 'packets');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${contentHash}.json`);
  if (existsSync(path)) { readEvidence(root, contentHash); return; }
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { rmSync(temp, { force: true }); }
}
export function readEvidence<T>(root: string, contentHash: string): T {
  if (!/^[a-f0-9]{64}$/.test(contentHash)) throw new Error('Invalid Signals evidence hash.');
  const raw = readFileSync(join(root, 'signals', 'packets', `${contentHash}.json`));
  if (raw.length > 3 * 1024 * 1024) throw new Error('Signals evidence exceeds supported size.');
  const value = JSON.parse(raw.toString('utf8'));
  if (hash(value) !== contentHash) throw new Error('Signals evidence is corrupt.');
  return value as T;
}
const locks = new Map<string, Promise<unknown>>();
export async function withSignalsLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  locks.set(root, task);
  try { return await task; } finally { if (locks.get(root) === task) locks.delete(root); }
}
