import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleCampaignCalendarWrite,
  type CampaignCalendarWriteResult,
  type CampaignCalendarWriteToolInput,
} from './campaign-calendar.ts';

function makeCtx(opts?: {
  campaignCalendarWrite?: (input: CampaignCalendarWriteToolInput) => Promise<CampaignCalendarWriteResult>;
}): SessionToolContext {
  const ctx: Partial<SessionToolContext> = {
    sessionId: 'session-1',
    workspacePath: '/tmp',
    plansFolderPath: '/tmp/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {
      exists: () => false,
      readFile: () => '',
      readFileBuffer: () => Buffer.from(''),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    get sourcesPath() { return '/tmp/sources'; },
    get skillsPath() { return '/tmp/skills'; },
  };
  if (opts?.campaignCalendarWrite) ctx.campaignCalendarWrite = opts.campaignCalendarWrite;
  return ctx as SessionToolContext;
}

describe('handleCampaignCalendarWrite', () => {
  it('errors when context capability is missing', async () => {
    const result = await handleCampaignCalendarWrite(makeCtx(), {
      operation: 'create',
      explanation: 'User asked to schedule it.',
      item: { date: '2026-07-10', title: 'Review final' },
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('not available');
  });

  it('validates create date and title before calling backend', async () => {
    let called = false;
    const result = await handleCampaignCalendarWrite(makeCtx({
      campaignCalendarWrite: async () => {
        called = true;
        return { ok: true };
      },
    }), {
      operation: 'create',
      explanation: 'User asked to schedule it.',
      item: { date: 'tomorrow' },
    } as CampaignCalendarWriteToolInput);

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
  });

  it('passes exact Release Kit references on non-running calendar work', async () => {
    let captured: CampaignCalendarWriteToolInput | undefined;
    const result = await handleCampaignCalendarWrite(makeCtx({
      campaignCalendarWrite: async (input) => {
        captured = input;
        return {
          ok: true,
          operation: input.operation,
          itemId: 'campaign-item-1',
          title: input.item.title,
          status: 'scheduled',
        };
      },
    }), {
      operation: 'create',
      explanation: 'User asked to schedule the teaser post.',
      item: {
        date: '2026-07-10',
        title: 'Review teaser',
        releaseKitRefs: [{ itemId: 'kit-1', sha256: 'a'.repeat(64), label: 'Teaser' }],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(captured?.item.releaseKitRefs?.[0]?.itemId).toBe('kit-1');
    expect((result.content[0] as any).text).toContain('scheduled');
  });

  it('rejects legacy social publishing and directs HNIC to schedule_work', async () => {
    let called = false;
    const result = await handleCampaignCalendarWrite(makeCtx({
      campaignCalendarWrite: async () => {
        called = true;
        return { ok: true };
      },
    }), {
      operation: 'create',
      explanation: 'Publish the teaser.',
      item: {
        date: '2026-07-10',
        title: 'Post teaser',
        job: { runAt: '2026-07-10T14:00:00.000Z', actionType: 'post-asset' },
      },
    });
    expect(result.isError).toBe(true);
    expect(called).toBe(false);
    expect((result.content[0] as any).text).toContain('schedule_work');
  });

  it('rejects every legacy runnable job before calling backend', async () => {
    let called = false;
    const result = await handleCampaignCalendarWrite(makeCtx({
      campaignCalendarWrite: async () => {
        called = true;
        return { ok: true };
      },
    }), {
      operation: 'create',
      explanation: 'User asked to schedule the teaser post.',
      item: {
        date: '2026-07-10',
        title: 'Post teaser',
        job: {
          runAt: '2026-07-10T14:00:00.000Z',
          actionType: 'custom-prompt',
          payload: { platform: 'instagram', accessToken: 'abc123' },
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(called).toBe(false);
    expect((result.content[0] as any).text).toContain('Artist Manager schedule_work');
  });
});
