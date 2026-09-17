import { expect, test } from 'bun:test';
import type { SessionToolContext } from '@craft-agent/session-tools-core';
import { attachSessionSelfManagementBindings } from './session-self-management-bindings.ts';
import { mergeSessionScopedToolCallbacks, unregisterSessionScopedToolCallbacks } from './session-scoped-tool-callback-registry.ts';

test('Website Campaign context binding follows authorized callback changes and removal', async () => {
  const id = 'website-campaign-binding-test';
  const context = {} as SessionToolContext;
  attachSessionSelfManagementBindings(context, id);
  expect(context.getWebsiteCampaignContext).toBeUndefined();
  try {
    mergeSessionScopedToolCallbacks(id, { getWebsiteCampaignContextFn: async input => ({ ok: true, selected: input.campaignWorkspaceId }) });
    expect(await context.getWebsiteCampaignContext!({ campaignWorkspaceId: 'release-a' })).toEqual({ ok: true, selected: 'release-a' });
    mergeSessionScopedToolCallbacks(id, { getWebsiteCampaignContextFn: async () => ({ ok: false, error: 'Denied' }) });
    expect((await context.getWebsiteCampaignContext!({})).ok).toBe(false);
  } finally {
    unregisterSessionScopedToolCallbacks(id);
  }
  expect(context.getWebsiteCampaignContext).toBeUndefined();
});
