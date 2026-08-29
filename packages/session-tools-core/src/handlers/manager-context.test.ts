import { describe, expect, test } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleGetArtistContext,
  handleGetCampaignContext,
  handleGetCampaignBrief,
  handleGetManagerBrief,
  handleGetWorkspaceContext,
  handleListWorkspaceContext,
  type ManagerContextToolResult,
} from './manager-context.ts';

const context = (overrides: Partial<SessionToolContext> = {}): SessionToolContext => overrides as SessionToolContext;
const text = (result: Awaited<ReturnType<typeof handleGetManagerBrief>>) =>
  (result.content[0] as { text: string }).text;
const callback = async (): Promise<ManagerContextToolResult> => ({ ok: true, marker: 'authorized' });

describe('manager context handlers', () => {
  test('manager-only handlers fail closed without HNIC callbacks', async () => {
    for (const result of await Promise.all([
      handleGetManagerBrief(context(), {}),
      handleGetCampaignBrief(context(), {}),
      handleGetArtistContext(context(), { topic: 'profile' }),
      handleGetCampaignContext(context(), { select: 'focus' }),
    ])) {
      expect(result.isError).toBe(true);
      expect(text(result)).toContain('only available to HNIC');
    }
  });

  test('generic context handlers fail closed when no authorized backend is attached', async () => {
    const list = await handleListWorkspaceContext(context(), {});
    const get = await handleGetWorkspaceContext(context(), { slug: 'private-notes' });
    expect(list.isError).toBe(true);
    expect(get.isError).toBe(true);
  });

  test('returns normalized callback data without changing it', async () => {
    const ctx = context({
      getManagerBrief: callback,
      getCampaignBrief: callback,
      getArtistContext: callback,
      getCampaignContext: callback,
      listWorkspaceContext: callback,
      getWorkspaceContext: callback,
    });
    for (const result of await Promise.all([
      handleGetManagerBrief(ctx, {}),
      handleGetCampaignBrief(ctx, {}),
      handleGetArtistContext(ctx, { topic: 'growth' }),
      handleGetCampaignContext(ctx, { select: 'next-future' }),
      handleListWorkspaceContext(ctx, {}),
      handleGetWorkspaceContext(ctx, { slug: 'artist-profile' }),
    ])) {
      expect(result.isError).toBe(false);
      expect(text(result)).toContain('"marker": "authorized"');
    }
  });

  test('surfaces backend authorization failures as tool errors', async () => {
    const result = await handleGetWorkspaceContext(context({
      getWorkspaceContext: async () => ({ ok: false, error: 'unauthorized' }),
    }), { slug: 'private-notes' });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain('unauthorized');
  });
});
