import { afterEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableJournal, type DurableRunSpec } from './index';
import { DURABLE_RUNTIME_MANIFEST, isDurableWebReadUrls, type DurableJson } from '../protocol/durable-execution';
const cleanup: Array<() => void> = [];
afterEach(() => { for (const f of cleanup.splice(0).reverse()) f(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'durable-web-read-')), key = randomBytes(32);
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let journal = new DurableJournal({ configRoot: root, key }); cleanup.push(() => journal.close());
  const spec: DurableRunSpec = { engine: 'sqlite-v2-readonly-1', credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, runId: 'r', commandId: 'a', workspaceId: 'w', model: 'm', createdAt: Date.now(), allowedTools: ['web_fetch'], webReadUrls: ['https://example.com/article'], approvalPrincipalId: 'alice', maxOutputTokens: 100, maxModelAttempts: 3, costPolicy: { unit: 'model-requests', maxUnitsPerAttempt: 1, maxTotalUnits: 3 }, context: {}, authority: {}, deadlineAt: Date.now() + 60000 };
  return { spec, get journal() { return journal; }, reopen() { journal.close(); journal = new DurableJournal({ configRoot: root, key }); } };
}
const request = { kind: 'tool-start' as const, turn: 0, callId: 'fetch', tool: 'web_fetch', input: { url: 'https://example.com/article' } };
const message = { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'fetch', name: 'web_fetch', arguments: request.input }] };
const auth = { principalId: 'alice', policyRevision: 'p', credentialIdentity: 'a'.repeat(64), allowed: true, requiresApproval: false, approvalExpiresAt: Date.now() + 50000 };

test('exact URL lists reject authority widening and noncanonical targets', () => {
  for (const value of [[], ['http://example.com/'], ['https://example.com'], ['https://example.com:443/'], ['https://x:y@example.com/'], ['https://example.com/#x'], ['https://example.com/', 'https://example.com/'], Array(9).fill('https://example.com/')]) expect(isDurableWebReadUrls(value)).toBe(false);
  expect(isDurableWebReadUrls(['https://example.com/article?q=a'])).toBe(true);
});
test('remote admission requires exact URLs, web tool, and a principal', () => {
  const f = fixture();
  for (const patch of [{ webReadUrls: undefined }, { webReadUrls: [] }, { allowedTools: ['read'] }, { approvalPrincipalId: undefined }]) expect(() => f.journal.admit(JSON.parse(JSON.stringify({ ...f.spec, ...patch })) as DurableRunSpec)).toThrow('invalid-durable-admission');
});
test('host denies unlisted URL and extra request parameters before dispatch', async () => {
  const f = fixture(); f.journal.admit(f.spec); const claim = f.journal.claim('r', 'w'), bridge = f.journal.bridge(claim, { authorizeTool: async () => auth });
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); await bridge.checkpoint({ kind: 'model-result', turn: 0, message });
  for (const input of [{ url: 'https://example.com/other' }, { url: request.input.url, method: 'POST' }] as DurableJson[]) await expect(bridge.checkpoint({ ...request, input })).rejects.toThrow('durable-web-read-not-authorized');
  expect(f.journal.get('r', 'w').turns[0]!.calls[0]!.attempts).toBe(0); f.journal.release(claim);
});
test('saved remote read replays after reopen without another dispatch and keeps immutable URLs', async () => {
  const f = fixture(); f.journal.admit(f.spec); let claim = f.journal.claim('r', 'w'); let bridge = f.journal.bridge(claim, { authorizeTool: async () => auth });
  expect(Object.isFrozen(bridge.descriptor.webReadUrls)).toBe(true);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); await bridge.checkpoint({ kind: 'model-result', turn: 0, message });
  await bridge.checkpoint(request); const result = { content: [{ type: 'text', text: 'saved article' }] };
  await bridge.checkpoint({ kind: 'tool-result', turn: 0, callId: 'fetch', result }); f.journal.release(claim); f.reopen();
  claim = f.journal.claim('r', 'w'); bridge = f.journal.bridge(claim, { authorizeTool: async () => auth });
  expect((await bridge.checkpoint(request)).cached).toEqual(result); expect(f.journal.get('r', 'w').turns[0]!.calls[0]!.attempts).toBe(1); f.journal.release(claim);
});
test('unavailable host authorization pauses remote read without dispatch', async () => {
  const f = fixture(); f.journal.admit(f.spec); const claim = f.journal.claim('r', 'w'), bridge = f.journal.bridge(claim);
  await bridge.checkpoint({ kind: 'model-start', turn: 0, context: {} }); await bridge.checkpoint({ kind: 'model-result', turn: 0, message });
  await expect(bridge.checkpoint(request)).rejects.toThrow('authorization-blocked'); expect(f.journal.get('r', 'w').status).toBe('paused'); expect(f.journal.get('r', 'w').turns[0]!.calls[0]!.attempts).toBe(0); f.journal.release(claim);
});
test('schema four upgrades while preserving old local run contents', () => {
  const f = fixture(); const local = { ...f.spec, allowedTools: ['read'] as const, webReadUrls: undefined };
  f.journal.admit(JSON.parse(JSON.stringify({ ...local, allowedTools: [...local.allowedTools] }))); (f.journal as any).db.exec('PRAGMA user_version=4'); f.reopen();
  expect((f.journal as any).db.prepare('PRAGMA user_version').get().user_version).toBe(6); expect(f.journal.get('r', 'w').spec.allowedTools).toEqual(['read']);
});

test('redirect grants are frozen, opt-in, and require an existing URL scope', () => {
  for (const flag of [undefined, false, true]) {
    const f = fixture(); if (flag !== undefined) f.spec.webReadRedirects = flag;
    f.journal.admit(f.spec); const claim = f.journal.claim('r', 'w');
    expect(f.journal.bridge(claim).descriptor.webReadRedirects).toBe(flag);
    f.journal.release(claim); f.reopen(); expect(f.journal.get('r', 'w').spec.webReadRedirects).toBe(flag);
  }
  for (const flag of ['true', 1, null]) { const f = fixture(); expect(() => f.journal.admit({ ...f.spec, webReadRedirects: flag } as unknown as DurableRunSpec)).toThrow('invalid-durable-admission'); }
  const f = fixture(), { webReadUrls: _urls, ...local } = f.spec;
  expect(() => f.journal.admit({ ...local, allowedTools: ['read'], webReadRedirects: false })).toThrow('invalid-durable-admission');
});
test('schema five web reads migrate with redirects still disabled by default', () => {
  const f = fixture(); f.journal.admit(f.spec); (f.journal as any).db.exec('PRAGMA user_version=5'); f.reopen();
  expect((f.journal as any).db.prepare('PRAGMA user_version').get().user_version).toBe(6);
  expect(f.journal.get('r', 'w').spec.webReadRedirects).toBeUndefined(); expect(f.journal.get('r', 'w').spec.webReadUrls).toEqual(f.spec.webReadUrls);
});
