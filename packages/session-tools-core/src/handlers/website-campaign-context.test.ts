import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { getSessionToolRegistry, getSessionSafeAllowedToolNames, BuildWebsiteSchema, PreviewWebsiteSchema } from '../tool-defs.ts';

const registry = getSessionToolRegistry({ includeWebsiteCampaignContext: true });
const context = (overrides: Partial<SessionToolContext> = {}) => overrides as SessionToolContext;

describe('Website Campaign source tools', () => {
  test('read is opt-in, read-only, and fails closed without authorized callback', async () => {
    expect(getSessionToolRegistry().has('get_website_campaign_context')).toBe(false);
    const tool = registry.get('get_website_campaign_context')!;
    expect(tool.readOnly).toBe(true);
    expect(getSessionSafeAllowedToolNames({ includeWebsiteCampaignContext: true })).toContain(tool.name);
    expect((await tool.handler!(context(), {})).isError).toBe(true);
    expect(tool.inputSchema.safeParse({ campaignWorkspaceId: '' }).success).toBe(false);
    expect(tool.inputSchema.safeParse({ workspaceRootPath: '/private' }).success).toBe(false);
  });

  test('dispatch forwards only the requested selection and preserves backend denials', async () => {
    const inputs: unknown[] = [];
    const tool = registry.get('get_website_campaign_context')!;
    const ctx = context({ getWebsiteCampaignContext: async input => {
      inputs.push(input);
      return input.campaignWorkspaceId === 'denied' ? { ok: false, error: 'Not authorized' } : { ok: true, campaigns: [] };
    } });
    expect((await tool.handler!(ctx, {})).isError).toBe(false);
    expect((await tool.handler!(ctx, { campaignWorkspaceId: 'release-a' })).isError).toBe(false);
    expect((await tool.handler!(ctx, { campaignWorkspaceId: 'denied' })).isError).toBe(true);
    expect(inputs).toEqual([{}, { campaignWorkspaceId: 'release-a' }, { campaignWorkspaceId: 'denied' }]);
  });

  test('build and preview preserve selected asset source through dispatch', async () => {
    const input = { campaignWorkspaceId: 'release-a' };
    const calls: unknown[] = [];
    const ctx = context({
      buildWebsite: async args => { calls.push(args); return { ok: true }; },
      previewWebsite: async args => { calls.push(args); return { ok: true }; },
    });
    await registry.get('website_build')!.handler!(ctx, BuildWebsiteSchema.parse(input));
    await registry.get('website_preview')!.handler!(ctx, PreviewWebsiteSchema.parse(input));
    expect(calls).toEqual([input, input]);
  });
});
