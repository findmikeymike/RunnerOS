import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import { RetryScheduler } from './retry-scheduler.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('RetryScheduler team runner gate', () => {
  it('does not execute a due webhook when this machine cannot run background work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'retry-runner-gate-'));
    roots.push(root);
    writeFileSync(join(root, AUTOMATIONS_RETRY_QUEUE_FILE), JSON.stringify({
      id: 'retry-1',
      matcherId: 'matcher-1',
      action: { type: 'webhook', url: 'https://example.com/hook' },
      expandedUrl: 'https://example.com/hook',
      deferredAttempt: 0,
      nextRetryAt: 0,
      createdAt: 0,
    }) + '\n');
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    try {
      const scheduler = new RetryScheduler({ workspaceRootPath: root, canRunBackgroundWork: () => false });
      await (scheduler as unknown as { tick(): Promise<void> }).tick();
      expect(fetchCount).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves an entry enqueued while a due retry is being processed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'retry-queue-lock-'));
    roots.push(root);
    const queuePath = join(root, AUTOMATIONS_RETRY_QUEUE_FILE);
    writeFileSync(queuePath, JSON.stringify({
      id: 'retry-due',
      matcherId: 'matcher-due',
      action: { type: 'webhook', url: 'https://example.com/hook' },
      expandedUrl: 'https://example.com/hook',
      deferredAttempt: 0,
      nextRetryAt: 0,
      createdAt: 0,
    }) + '\n');

    let releaseFetch: (() => void) | undefined;
    let fetchStarted = false;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchStarted = true;
      await fetchGate;
      return new Response('', { status: 200 });
    }) as typeof fetch;

    try {
      const scheduler = new RetryScheduler({ workspaceRootPath: root, canRunBackgroundWork: () => true });
      const tick = (scheduler as unknown as { tick(): Promise<void> }).tick();
      while (!fetchStarted) await new Promise((resolve) => setTimeout(resolve, 1));

      const enqueue = scheduler.enqueue(
        'matcher-new',
        { type: 'webhook', url: 'https://example.com/new' },
        'https://example.com/new',
      );
      releaseFetch!();
      await Promise.all([tick, enqueue]);

      const entries = readFileSync(queuePath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
      expect(entries.map((entry) => entry.matcherId)).toEqual(['matcher-new']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
