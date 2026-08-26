import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});
