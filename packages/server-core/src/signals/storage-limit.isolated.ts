import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash, MAX_SIGNALS_STATE_BYTES, readEvidence, readSignals, saveEvidence, SignalStorageLimitError, writeSignals, type SignalRequest } from './storage';

test('oversized UTF-8 journal cannot replace readable history or publish new sidecars', () => {
  const root = mkdtempSync(join(tmpdir(), 'signals-storage-limit-'));
  try {
    const state = readSignals(root, 'hq');
    const receipt = { paidAttempt: 'keep-existing-receipt' };
    const receiptHash = hash(receipt);
    saveEvidence(root, receiptHash, receipt);
    writeSignals(root, state);
    const before = readFileSync(join(root, 'signals/state.json'), 'utf8');
    const transcript = { videoId: 'abcdefghijk', provider: 'fixture', segments: [{ start: 0, end: 1, text: 'new evidence' }] };
    const contentHash = hash(transcript);
    state.requests.push({ runId: 'new-request', packets: [{ id: 'video:abcdefghijk', contentHash, transcript }], websites: [] } as unknown as SignalRequest);
    // Less than 64 MiB of JS characters, but over 64 MiB when serialized as UTF-8.
    state.tracks.industry.revision = '\u00e9'.repeat(MAX_SIGNALS_STATE_BYTES / 2);
    expect(state.tracks.industry.revision.length).toBeLessThan(MAX_SIGNALS_STATE_BYTES);
    expect(() => writeSignals(root, state)).toThrow(SignalStorageLimitError);
    expect(() => writeSignals(root, state)).toThrow('Back up this workspace');
    expect(readFileSync(join(root, 'signals/state.json'), 'utf8')).toBe(before);
    expect(readSignals(root, 'hq').requests).toEqual([]);
    expect(readEvidence<typeof receipt>(root, receiptHash)).toEqual(receipt);
    expect(existsSync(join(root, 'signals/packets', `${contentHash}.json`))).toBe(false);
    expect(readdirSync(join(root, 'signals')).some(name => name.endsWith('.tmp'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15_000);
