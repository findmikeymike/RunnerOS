import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SOCIAL_VARIANT_MAX_TOTAL,
  advanceSocialVariantSetRevision,
  assertSocialVariantSetRevision,
  createOutputBundle,
  isOutputManifest,
  isSocialVariantSetManifest,
  readOutputManifest,
  toSocialVariantSetSummary,
  type SocialVariantSetManifest,
} from './index.ts';

const OUTPUT_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_SHA = 'a'.repeat(64);
const VARIANT_SHA = 'b'.repeat(64);
let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'social-variant-output-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function variantSet(overrides: Partial<SocialVariantSetManifest> = {}): SocialVariantSetManifest {
  const base: SocialVariantSetManifest = {
    schemaVersion: 1,
    revision: 1,
    id: OUTPUT_ID,
    workspaceId: 'workspace-1',
    scope: 'campaign',
    campaignId: 'campaign-1',
    status: 'review',
    editorSessionId: 'session-1',
    sources: [{
      id: 'source-1',
      origin: 'release-kit',
      sourceId: 'release-kit-item-1',
      title: 'Official performance video',
      sha256: SOURCE_SHA,
      rightsBasis: 'owned',
    }],
    request: {
      variantsPerSource: 2,
      totalRequested: 2,
      destinationIntents: [{
        platform: 'instagram',
        accountRole: 'secondary',
        profileId: 'profile-1',
        mode: 'standard',
      }],
      direction: 'Favor two distinct openings.',
      requestedAt: '2026-09-02T12:00:00.000Z',
      requestedBy: { type: 'user', clientId: 'client-1' },
    },
    variants: [{
      id: 'variant-1',
      sourceId: 'source-1',
      title: 'Chorus first',
      hook: 'Open on the chorus payoff.',
      editorialMode: 'alternate-hook',
      editorialIntent: 'Lead with the strongest emotional turn.',
      destination: {
        platform: 'instagram',
        accountRole: 'secondary',
        profileId: 'profile-1',
        mode: 'standard',
      },
      assetId: 'variant-asset-1',
      sha256: VARIANT_SHA,
      durationSeconds: 18,
      aspectRatio: '9:16',
      state: 'ready',
      scheduledWorkOrderIds: [],
    }],
    createdAt: '2026-09-02T12:00:00.000Z',
    updatedAt: '2026-09-02T12:01:00.000Z',
  };
  return { ...base, ...overrides };
}

describe('social variant set validation', () => {
  test('accepts a bounded campaign set and produces a compact summary', () => {
    const set = variantSet();
    expect(isSocialVariantSetManifest(set, new Set(['variant-asset-1']))).toBe(true);
    expect(toSocialVariantSetSummary(set)).toEqual({
      id: OUTPUT_ID,
      status: 'review',
      scope: 'campaign',
      campaignId: 'campaign-1',
      sourceCount: 1,
      requestedCount: 2,
      variantCount: 1,
      readyCount: 1,
      failedCount: 0,
      attention: undefined,
      updatedAt: '2026-09-02T12:01:00.000Z',
    });
  });

  test('rejects forged request identity and over-limit batches', () => {
    expect(isSocialVariantSetManifest(variantSet({
      request: { ...variantSet().request, requestedBy: { type: 'agent' as 'user', clientId: 'raw-video-editor' } },
    }))).toBe(false);

    expect(isSocialVariantSetManifest(variantSet({
      sources: Array.from({ length: 3 }, (_, index) => ({
        ...variantSet().sources[0]!,
        id: `source-${index + 1}`,
        sourceId: `release-kit-item-${index + 1}`,
      })),
      request: {
        ...variantSet().request,
        variantsPerSource: 5,
        totalRequested: 15,
      },
      variants: [],
    }))).toBe(false);
    expect(SOCIAL_VARIANT_MAX_TOTAL).toBe(12);
  });

  test('rejects sets that exceed the requested per-source ceiling', () => {
    const firstSource = variantSet().sources[0]!;
    const secondSource = {
      ...firstSource,
      id: 'source-2',
      sourceId: 'release-kit-item-2',
      title: 'Behind the scenes cut',
    };
    expect(isSocialVariantSetManifest(variantSet({
      sources: [firstSource, secondSource],
      request: {
        ...variantSet().request,
        variantsPerSource: 2,
        totalRequested: 4,
      },
      variants: [
        variantSet().variants[0]!,
        {
          ...variantSet().variants[0]!,
          id: 'variant-2',
          assetId: 'variant-asset-2',
          sha256: 'c'.repeat(64),
        },
        {
          ...variantSet().variants[0]!,
          id: 'variant-3',
          assetId: 'variant-asset-3',
          sha256: 'd'.repeat(64),
        },
      ],
    }), new Set(['variant-asset-1', 'variant-asset-2', 'variant-asset-3']))).toBe(false);
  });

  test('rejects duplicate source lineage hidden behind different wrapper ids', () => {
    const source = variantSet().sources[0]!;
    expect(isSocialVariantSetManifest(variantSet({
      sources: [source, { ...source, id: 'source-2' }],
      request: {
        ...variantSet().request,
        totalRequested: 4,
      },
    }))).toBe(false);
  });

  test('keeps set status coherent with render state', () => {
    const ready = variantSet({
      status: 'ready',
      request: { ...variantSet().request, variantsPerSource: 1, totalRequested: 1 },
    });
    expect(isSocialVariantSetManifest(ready)).toBe(true);
    expect(isSocialVariantSetManifest({ ...ready, variants: [] })).toBe(false);
    expect(isSocialVariantSetManifest({ ...ready, status: 'partially-ready' })).toBe(false);
    expect(isSocialVariantSetManifest({
      ...variantSet(),
      status: 'partially-ready',
    })).toBe(true);
    expect(isSocialVariantSetManifest({
      ...variantSet(),
      status: 'review',
      variants: [{ ...variantSet().variants[0]!, state: 'failed', assetId: undefined, sha256: undefined, failureReason: 'Render failed.' }],
    })).toBe(false);
    expect(isSocialVariantSetManifest({
      ...variantSet(),
      status: 'needs-attention',
    })).toBe(false);
    expect(isSocialVariantSetManifest({
      ...variantSet(),
      status: 'needs-attention',
      attention: {
        code: 'source-unavailable',
        message: 'The source changed.',
        sourceId: 'source-1',
        updatedAt: '2026-09-02T12:02:00.000Z',
      },
    })).toBe(true);
    expect(isSocialVariantSetManifest({
      ...variantSet(),
      status: 'needs-attention',
      attention: {
        code: 'source-unavailable',
        message: 'The source changed.',
        sourceId: 'missing-source',
        updatedAt: '2026-09-02T12:02:00.000Z',
      },
    })).toBe(false);
  });

  test('requires exact assets for ready variants and explicit Instagram Trial intent', () => {
    expect(isSocialVariantSetManifest(variantSet(), new Set())).toBe(false);
    expect(isSocialVariantSetManifest(variantSet({
      variants: [{
        ...variantSet().variants[0]!,
        destination: {
          platform: 'instagram',
          accountRole: 'secondary',
          mode: 'trial',
        },
      }],
    }))).toBe(false);
    expect(isSocialVariantSetManifest(variantSet({
      request: {
        ...variantSet().request,
        destinationIntents: [{
          platform: 'instagram',
          accountRole: 'secondary',
          mode: 'trial',
          trialRequested: true,
        }],
      },
      variants: [{
        ...variantSet().variants[0]!,
        destination: {
          platform: 'instagram',
          accountRole: 'secondary',
          mode: 'trial',
          trialRequested: true,
        },
      }],
    }))).toBe(true);
  });

  test('persists bounded destination intent and rejects unrequested destinations', () => {
    expect(isSocialVariantSetManifest(variantSet({
      variants: [{
        ...variantSet().variants[0]!,
        destination: { platform: 'x', accountRole: 'secondary', mode: 'standard' },
      }],
    }))).toBe(false);
    expect(isSocialVariantSetManifest(variantSet({
      request: {
        ...variantSet().request,
        destinationIntents: [
          variantSet().request.destinationIntents[0]!,
          variantSet().request.destinationIntents[0]!,
        ],
      },
    }))).toBe(false);
  });

  test('fences stale updates and only advances mutable progress fields', () => {
    const current = variantSet({
      request: { ...variantSet().request, variantsPerSource: 1, totalRequested: 1 },
    });
    expect(() => assertSocialVariantSetRevision(current, 2)).toThrow(/Expected revision 2, found 1/);
    const next = advanceSocialVariantSetRevision(current, {
      status: 'ready',
      variants: current.variants,
    }, '2026-09-02T12:02:00.000Z');
    expect(next.revision).toBe(2);
    expect(next.id).toBe(current.id);
    expect(next.workspaceId).toBe(current.workspaceId);
    expect(next.sources).toEqual(current.sources);
    expect(next.request).toEqual(current.request);
    expect(next.editorSessionId).toBe(current.editorSessionId);
    expect(next.status).toBe('ready');
    expect(() => advanceSocialVariantSetRevision(current, {
      status: current.status,
      variants: current.variants,
    }, current.updatedAt)).toThrow(/advance updatedAt/);
  });
});

describe('social variant Output integration', () => {
  test('persists typed collection Outputs without rewriting normal Outputs', () => {
    const set = variantSet({ updatedAt: '2026-09-02T12:00:00.000Z' });
    const created = createOutputBundle(workspace, {
      id: OUTPUT_ID,
      workspaceId: 'workspace-1',
      title: 'Angelina social variants',
      kind: 'collection',
      status: 'draft',
      summary: 'Two alternate social edits.',
      origin: { source: 'session', sessionId: 'session-1', agentSlug: 'raw-video-editor' },
      context: { scope: 'campaign', campaignId: 'campaign-1' },
      assets: [{
        id: 'variant-asset-1',
        label: 'Chorus first',
        role: 'primary',
        path: 'chorus-first.mp4',
        mimeType: 'video/mp4',
        sha256: VARIANT_SHA,
      }],
      socialVariantSet: set,
      tags: ['social-variant-set'],
      createdAt: set.createdAt,
    });

    expect(created.schemaVersion).toBe(1);
    expect(readOutputManifest(workspace, OUTPUT_ID)?.socialVariantSet).toEqual(set);
    expect(isOutputManifest(created, OUTPUT_ID)).toBe(true);

    const normal = createOutputBundle(workspace, {
      workspaceId: 'workspace-1',
      title: 'Normal report',
      kind: 'report',
      origin: { source: 'manual' },
    });
    expect(normal.schemaVersion).toBe(1);
    expect(normal.socialVariantSet).toBeUndefined();
  });

  test('rejects a typed set whose workspace, campaign, session, or asset references drift', () => {
    const base = {
      schemaVersion: 1 as const,
      id: OUTPUT_ID,
      workspaceId: 'workspace-1',
      title: 'Variants',
      slug: 'variants',
      kind: 'collection' as const,
      status: 'draft' as const,
      summary: '',
      createdAt: '2026-09-02T12:00:00.000Z',
      updatedAt: '2026-09-02T12:00:00.000Z',
      origin: { source: 'session' as const, sessionId: 'session-1' },
      assets: [{ id: 'variant-asset-1', label: 'Variant', role: 'primary' as const, path: 'variant.mp4', sha256: VARIANT_SHA }],
      receipts: [],
      links: [],
      context: { scope: 'campaign' as const, campaignId: 'campaign-1' },
      socialVariantSet: variantSet({ updatedAt: '2026-09-02T12:00:00.000Z' }),
    };
    expect(isOutputManifest(base)).toBe(true);
    expect(isOutputManifest({ ...base, workspaceId: 'other-workspace' })).toBe(false);
    expect(isOutputManifest({ ...base, context: { ...base.context, campaignId: 'other-campaign' } })).toBe(false);
    expect(isOutputManifest({ ...base, origin: { ...base.origin, sessionId: 'other-session' } })).toBe(false);
    expect(isOutputManifest({ ...base, assets: [] })).toBe(false);
    expect(isOutputManifest({ ...base, socialVariantSet: { ...base.socialVariantSet, id: 'different-set' } })).toBe(false);
    expect(isOutputManifest({
      ...base,
      assets: [{ ...base.assets[0]!, sha256: 'c'.repeat(64) }],
    })).toBe(false);
  });
});
