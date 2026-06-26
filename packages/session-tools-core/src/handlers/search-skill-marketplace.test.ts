import { afterEach, describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleSearchSkillMarketplace } from './search-skill-marketplace.ts';

const originalFetch = globalThis.fetch;
const ctx = {} as SessionToolContext;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('handleSearchSkillMarketplace', () => {
  it('rejects empty queries', async () => {
    const result = await handleSearchSkillMarketplace(ctx, { query: '   ' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('query is required');
  });

  it('rejects wildcard searches', async () => {
    const result = await handleSearchSkillMarketplace(ctx, { query: '*' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Wildcard');
  });

  it('searches SkillsMP and returns normalized candidates', async () => {
    let requestedUrl = '';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        success: true,
        data: {
          skills: [{
            id: 'skill-1',
            name: 'seo-fundamentals',
            author: 'maker',
            description: 'SEO fundamentals.',
            githubUrl: 'https://github.com/maker/repo/tree/main/skills/seo',
            skillUrl: 'https://skillsmp.com/skills/seo-fundamentals',
            stars: 42,
            updatedAt: '2026-06-01',
          }],
          pagination: {
            total: 1000,
            hasNext: true,
            totalIsExact: false,
          },
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Daily-Limit': '50',
          'X-RateLimit-Daily-Remaining': '49',
        },
      });
    }) as unknown as typeof fetch;

    const result = await handleSearchSkillMarketplace(ctx, { query: 'seo', limit: 50, sortBy: 'stars' });

    expect(result.isError).toBeFalsy();
    expect(requestedUrl).toContain('q=seo');
    expect(requestedUrl).toContain('limit=20');
    expect(requestedUrl).toContain('sortBy=stars');
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.skills[0]).toMatchObject({
      name: 'seo-fundamentals',
      author: 'maker',
      stars: 42,
    });
    expect(parsed.rateLimit.dailyRemaining).toBe('49');
    expect(parsed.safetyNote).toContain('External marketplace');
  });

  it('surfaces API errors', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: false,
      error: { code: 'DAILY_QUOTA_EXCEEDED', message: 'Daily API quota exceeded' },
    }), { status: 429 })) as unknown as typeof fetch;

    const result = await handleSearchSkillMarketplace(ctx, { query: 'seo' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('DAILY_QUOTA_EXCEEDED');
  });
});
