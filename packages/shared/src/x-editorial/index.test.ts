import { describe, expect, test } from 'bun:test';
import {
  X_EDITORIAL_SLATE_STALE_AFTER_MS,
  X_STANDARD_POST_MAX_CHARACTERS,
  isXEditorialSlateOutput,
  isXEditorialSlateStale,
  parseXEditorialSlate,
  stableXEditorialStringify,
  xEditorialCandidateAuthorizationPayload,
  xPostCharacterCount,
  xStandardPostLengthError,
} from './index.ts';

function validSlate(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    slateId: 'xslate_20260831',
    title: 'Daily X Slate — Aug 31',
    createdAt: '2026-08-31T17:00:00.000Z',
    timezone: 'America/Chicago',
    profile: { platform: 'x', profileId: 'artist-main' },
    context: {
      scope: 'hq',
      campaignId: 'campaign-1',
      campaignName: 'Homebody',
      campaignWeight: 'light',
    },
    research: {
      summary: 'Mixed signals and false intimacy are active conversation territory.',
      researchedAt: '2026-08-31T16:45:00.000Z',
      sources: [{
        id: 'src_1',
        title: 'A useful source',
        url: 'https://example.com/source',
        publishedAt: '2026-08-31',
        claim: 'A specific supported claim.',
      }],
    },
    candidates: [{
      id: 'post_1',
      revision: 1,
      lane: 'campaign-adjacent',
      format: 'post',
      text: 'Intensity can look a lot like intimacy from far away.',
      thread: null,
      rationale: 'This is an established artist tension and the song occupies the same territory.',
      researchBasis: 'mixed',
      sourceIds: ['src_1'],
      campaignId: 'campaign-1',
      scheduledFor: '2026-09-01T01:00:00.000Z',
      timingBasis: 'editorial-default',
      asset: null,
      status: 'proposed',
    }],
  };
}

describe('Daily X Slate contract', () => {
  test('parses a campaign-aware text slate and builds the exact approval payload', () => {
    const parsed = parseXEditorialSlate(JSON.stringify(validSlate()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.slate.candidates[0]?.lane).toBe('campaign-adjacent');
    expect(xEditorialCandidateAuthorizationPayload(parsed.slate, parsed.slate.candidates[0]!)).toEqual({
      slateId: 'xslate_20260831',
      candidateId: 'post_1',
      revision: 1,
      platform: 'x',
      profileId: 'artist-main',
      text: 'Intensity can look a lot like intimacy from far away.',
      scheduledFor: '2026-09-01T01:00:00.000Z',
      timezone: 'America/Chicago',
      campaignId: 'campaign-1',
      asset: null,
    });
  });

  test('allows a draft slate to name missing account and time without inventing either', () => {
    const value = validSlate();
    value.profile = { platform: 'x', profileId: '' };
    value.context = { scope: 'hq', campaignId: null, campaignName: null, campaignWeight: 'none' };
    value.candidates = [{
      ...(value.candidates as Record<string, unknown>[])[0],
      lane: 'worldview',
      campaignId: null,
      scheduledFor: null,
      researchBasis: 'artist-truth',
      sourceIds: [],
    }];
    expect(parseXEditorialSlate(value).ok).toBe(true);
  });

  test('rejects a campaign lane without explicit campaign ownership', () => {
    const value = validSlate();
    (value.candidates as Record<string, unknown>[])[0]!.campaignId = null;
    const parsed = parseXEditorialSlate(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('requires a campaignId');
  });

  test('rejects research references that do not exist', () => {
    const value = validSlate();
    (value.candidates as Record<string, unknown>[])[0]!.sourceIds = ['src_missing'];
    const parsed = parseXEditorialSlate(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('missing research source');
  });

  test('infers research basis for older V1 slates and requires sources for cited work', () => {
    const legacy = validSlate();
    delete (legacy.candidates as Record<string, unknown>[])[0]!.researchBasis;
    const parsedLegacy = parseXEditorialSlate(legacy);
    expect(parsedLegacy.ok).toBe(true);
    if (parsedLegacy.ok) expect(parsedLegacy.slate.candidates[0]?.researchBasis).toBe('cited-research');

    const invalid = validSlate();
    Object.assign((invalid.candidates as Record<string, unknown>[])[0]!, {
      researchBasis: 'mixed',
      sourceIds: [],
    });
    const parsedInvalid = parseXEditorialSlate(invalid);
    expect(parsedInvalid.ok).toBe(false);
    if (!parsedInvalid.ok) expect(parsedInvalid.error).toContain('requires at least one sourceId');
  });

  test('counts Unicode posts and marks old research as stale without invalidating the slate', () => {
    expect(xPostCharacterCount(`One ${'🔥'.repeat(3)}`)).toBe(7);
    expect(X_STANDARD_POST_MAX_CHARACTERS).toBe(280);
    expect(xStandardPostLengthError('x'.repeat(280))).toBeNull();
    expect(xStandardPostLengthError('x'.repeat(282))).toBe('Shorten by 2 characters');
    const parsed = parseXEditorialSlate(validSlate());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const freshAt = Date.parse(parsed.slate.research.researchedAt!);
    expect(isXEditorialSlateStale(parsed.slate, freshAt + X_EDITORIAL_SLATE_STALE_AFTER_MS)).toBe(false);
    expect(isXEditorialSlateStale(parsed.slate, freshAt + X_EDITORIAL_SLATE_STALE_AFTER_MS + 1)).toBe(true);
  });

  test('requires an ordered thread to start with the exact opening post', () => {
    const value = validSlate();
    Object.assign((value.candidates as Record<string, unknown>[])[0]!, {
      format: 'thread',
      thread: ['Different opening', 'Second post'],
    });
    const parsed = parseXEditorialSlate(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('begin with text');
  });

  test('requires both schedule links and a scheduled lifecycle status', () => {
    const value = validSlate();
    Object.assign((value.candidates as Record<string, unknown>[])[0]!, {
      scheduledWorkId: 'scheduled-work-1',
      status: 'proposed',
    });
    const parsed = parseXEditorialSlate(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('both Scheduled Work and Calendar');
  });

  test('validates exact Release Kit campaign and sha256 ownership', () => {
    const value = validSlate();
    (value.candidates as Record<string, unknown>[])[0]!.asset = {
      kind: 'release-kit',
      campaignId: 'different-campaign',
      itemId: 'cover-1',
      sha256: 'a'.repeat(64),
      label: 'Single Art',
    };
    const parsed = parseXEditorialSlate(value);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('asset does not belong');
  });

  test('recognizes only tagged collection Outputs', () => {
    expect(isXEditorialSlateOutput({ kind: 'collection', tags: ['artist-x-slate'] })).toBe(true);
    expect(isXEditorialSlateOutput({ kind: 'document', tags: ['artist-x-slate'] })).toBe(false);
    expect(isXEditorialSlateOutput({ kind: 'collection', tags: ['other'] })).toBe(false);
  });

  test('stable stringify ignores object insertion order and undefined fields', () => {
    expect(stableXEditorialStringify({ b: 2, a: 1, ignored: undefined })).toBe(
      stableXEditorialStringify({ a: 1, b: 2 }),
    );
  });
});
