import { afterEach, describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { SESSION_TOOL_DEFS } from '../tool-defs.ts';
import { handleSearchSkillMarketplace } from './search-skill-marketplace.ts';

const originalFetch = globalThis.fetch;
const ctx = {} as SessionToolContext;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('handleSearchSkillMarketplace', () => {
  it('is registered as a read-only safe-mode tool', () => {
    const tool = SESSION_TOOL_DEFS.find((candidate) => candidate.name === 'search_skill_marketplace');
    expect(tool).toMatchObject({ readOnly: true, safeMode: 'allow', executionMode: 'registry' });
  });

  it('rejects unfocused queries without making a request', async () => {
    expect((await handleSearchSkillMarketplace(ctx, { query: '   ' })).isError).toBe(true);
    expect((await handleSearchSkillMarketplace(ctx, { query: '*' })).content[0]?.text).toContain('Wildcard');
  });

  it('returns normalized read-only candidates with bounded search inputs', async () => {
    let requestedUrl = '';
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        success: true,
        data: {
          skills: [{
            id: 'skill-1',
            name: 'artist-audience-research',
            author: 'maker',
            description: 'Research artist audiences.',
            githubUrl: 'https://github.com/maker/skills/tree/main/artist-audience-research',
            skillUrl: 'https://skillsmp.com/skills/artist-audience-research',
            stars: 42,
            updatedAt: '2026-06-01',
          }],
          pagination: { total: 100, hasNext: true, totalIsExact: false },
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Daily-Remaining': '49',
        },
      });
    }) as unknown as typeof fetch;

    const result = await handleSearchSkillMarketplace(ctx, {
      query: 'artist audience',
      limit: 50,
      sortBy: 'recent',
      language: 'en',
    });

    expect(result.isError).toBe(false);
    expect(requestedUrl).toContain('q=artist+audience');
    expect(requestedUrl).toContain('limit=20');
    expect(requestedUrl).toContain('sortBy=recent');
    expect(requestedUrl).toContain('language=en');
    const parsed = JSON.parse(result.content[0]?.text ?? '');
    expect(parsed.skills[0]).toMatchObject({ untrustedCandidate: true, name: 'artist-audience-research', stars: 42 });
    expect(parsed.rateLimit.dailyRemaining).toBe('49');
    expect(parsed.safetyNote).toContain('untrusted candidates');
  });

  it('surfaces marketplace errors instead of returning an empty success', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: false,
      error: { code: 'DAILY_QUOTA_EXCEEDED', message: 'Daily API quota exceeded' },
    }), { status: 429 })) as unknown as typeof fetch;

    const result = await handleSearchSkillMarketplace(ctx, { query: 'songwriting' });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('DAILY_QUOTA_EXCEEDED');
  });

  it('bounds candidates locally even if the marketplace ignores the limit', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: true,
      data: {
        skills: Array.from({ length: 30 }, (_, index) => ({ name: `skill-${index}` })),
      },
    }), { status: 200 })) as unknown as typeof fetch;

    const result = await handleSearchSkillMarketplace(ctx, { query: 'artist research', limit: 3 });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0]?.text ?? '').skills).toHaveLength(3);
  });
});
