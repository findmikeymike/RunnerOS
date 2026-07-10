import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceEventBus } from '../event-bus.ts';
import { WebhookHandler } from './webhook-handler.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('WebhookHandler Team Mode external effects', () => {
  it('returns a blocked result without network access when receiver idempotency is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'webhook-handler-team-'));
    roots.push(root);
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response('', { status: 200 });
    }) as typeof fetch;
    let delivered: Array<{ success: boolean; error?: string }> = [];
    const handler = new WebhookHandler({
      workspaceId: 'workspace-1',
      workspaceRootPath: root,
      canRunBackgroundWork: () => true,
      canExecuteExternalEffects: () => false,
      onWebhookResults: (results) => { delivered = results; },
    }, {
      getConfig: () => null,
      getMatchersForEvent: () => [{ id: 'matcher-1', actions: [{ type: 'webhook', url: 'https://example.com/hook' }] }],
    });
    const bus = new WorkspaceEventBus('workspace-1');
    handler.subscribe(bus);
    try {
      await bus.emit('LabelAdd', {
        workspaceId: 'workspace-1', timestamp: Date.now(), label: 'ready',
      });
      expect(fetchCount).toBe(0);
      expect(delivered[0]?.success).toBe(false);
      expect(delivered[0]?.error).toContain('idempotency');
    } finally {
      handler.dispose();
      bus.dispose();
      globalThis.fetch = originalFetch;
    }
  });
});
