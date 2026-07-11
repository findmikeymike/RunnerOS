import { describe, expect, test } from 'bun:test';
import { renderSharedIntelBody, type SharedIntelNote } from '../shared-intel/index.ts';
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import {
  buildHqStateContextDoc,
  buildHqStateOfPlay,
  HQ_STATE_CONTEXT_SLUG,
  parseHqStateOfPlay,
  serializeHqStateOfPlay,
} from './index.ts';

const now = new Date('2026-07-04T12:00:00.000Z');

describe('HQ State of Play composer', () => {
  test('points first at profile completion when identity context is thin', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        doc('artist-profile', 'Artist Profile', {
          version: 1,
          artistName: 'Mikey Mike',
          updatedAt: '2026-07-04T00:00:00.000Z',
        }),
      ],
    });

    expect(state.nextMove.title).toBe('Complete Artist Profile');
    expect(state.nextMove.worker).toBe('branding-agent');
    expect(state.nextMove.route?.target).toBe('agent');
    expect(state.nextMove.route?.agentSlug).toBe('branding-agent');
    expect(state.nextMove.route?.blockedReason).toContain('Artist profile');
    expect(state.missing).toContain('artist sound');
    expect(state.sources['artist-profile']).toBe('2026-07-04T00:00:00.000Z');
  });

  test('prioritizes urgent calendar dates with missing vault assets', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        profileDoc(),
        doc('artist-calendar', 'Artist Calendar', {
          version: 1,
          updatedAt: '2026-07-04T00:00:00.000Z',
          events: [{ id: 'event-1', title: 'Single release', date: '2026-07-10', createdAt: '', updatedAt: '', workspaceLinks: [], relatedPersonIds: [] }],
        }),
        doc('artist-vault', 'Artist Vault', {
          version: 1,
          workspaceId: 'artist-hq',
          vaultRoot: 'vault',
          storageMode: 'copied',
          updatedAt: '2026-07-04T00:00:00.000Z',
          assets: [],
        }),
      ],
    });

    expect(state.nextMove.title).toBe('Close asset gaps before Single release');
    expect(state.nextMove.worker).toBe('art-director');
    expect(state.nextMove.route?.target).toBe('agent');
    expect(state.nextMove.route?.agentSlug).toBe('art-director');
    expect(state.nextMove.route?.contextDocSlugs).toEqual(['artist-calendar', 'artist-profile', 'artist-vault']);
    expect(state.attention.some((item) => item.kind === 'calendar')).toBe(true);
    expect(state.attention.some((item) => item.kind === 'vault')).toBe(true);
  });

  test('creates a launch-ready route hint for one-click outreach', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        profileDoc(),
        doc('artist-network', 'Artist Network', {
          version: 1,
          updatedAt: '2026-07-04T00:00:00.000Z',
          people: [{
            name: 'Alex Manager',
            relationship: 'vip',
            lastTouch: '2026-03-01',
            canHelpWith: 'playlist introductions',
          }],
        }),
        doc('artist-spotify-snapshot', 'Spotify Snapshot', {
          version: 1,
          updatedAt: '2026-07-04T00:00:00.000Z',
          metrics: { streams: 1000, listeners: 400 },
        }),
        completeVaultDoc(),
        doc('artist-community', 'Artist Community', {
          version: 1,
          updatedAt: '2026-07-04T00:00:00.000Z',
          contacts: [{ segment: 'fans' }],
          emailJobs: [],
        }),
        doc('artist-calendar', 'Artist Calendar', {
          version: 1,
          updatedAt: '2026-07-04T00:00:00.000Z',
          events: [{ title: 'Listening party', date: '2026-08-01' }],
        }),
        textDoc('launch-single-goal', 'Launch single', 'Release campaign goal.', { status: 'done', priority: 'low', deadline: '2026-07-01' }),
      ],
    });

    expect(state.nextMove.title).toBe('Re-open Alex Manager');
    expect(state.nextMove.route).toEqual(expect.objectContaining({
      target: 'agent',
      agentSlug: 'outreach-agent',
      action: 'outreach',
      confidence: 'high',
      contextDocSlugs: ['artist-network', 'artist-profile'],
    }));
    expect(state.nextMove.route?.prompt).toContain('Re-open Alex Manager');
  });

  test('excludes source and shared-intel docs from goals but includes user goals', () => {
    const sharedIntel: SharedIntelNote = {
      version: 1,
      id: 'si_1',
      title: 'Premium restraint rule',
      summary: 'Keep the rollout visually restrained and high-status.',
      whyItMatters: 'Useful for art direction.',
      tags: ['branding'],
      targetAgents: ['art-director'],
      sourceSessionId: 'session-1',
      createdAt: '2026-07-04T00:00:00.000Z',
      updatedAt: '2026-07-04T00:00:00.000Z',
      revision: 1,
      confidence: 'high',
    };
    const state = buildHqStateOfPlay({
      now,
      docs: [
        profileDoc(),
        doc('artist-vault', 'Artist Vault', { version: 1, workspaceId: 'artist-hq', vaultRoot: 'vault', storageMode: 'copied', assets: [], updatedAt: '2026-07-04T00:00:00.000Z' }, { status: 'active' }),
        textDoc('shared-intel-session-premium-restraint', 'Shared Intel', renderSharedIntelBody(sharedIntel), { routing: { mode: 'targeted', agents: ['art-director'] } }),
        textDoc('launch-single-goal', 'Launch single', 'Release campaign goal.', { status: 'active', priority: 'high', deadline: '2026-07-08' }),
      ],
    });

    expect(state.goalProgress).toHaveLength(1);
    expect(state.goalProgress[0]?.goal).toBe('Launch single');
    expect(state.attention.some((item) => item.kind === 'shared-intel')).toBe(true);
  });

  test('round-trips generated context body', () => {
    const built = buildHqStateContextDoc({ now, docs: [profileDoc()] });
    const parsed = parseHqStateOfPlay(built.body);

    expect(built.slug).toBe(HQ_STATE_CONTEXT_SLUG);
    expect(built.metadata.routing).toEqual({ mode: 'broadcast' });
    expect(parsed?.version).toBe(1);
    expect(parsed?.nextMove.title).toBeTruthy();
    expect(parsed?.nextMove.route?.prompt).toContain(parsed?.nextMove.title ?? '');
  });

  test('ignores disabled source docs when composing state', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        doc('artist-profile', 'Artist Profile', {
          version: 1,
          artistName: 'Private Artist',
          sound: 'private sound',
          audience: 'private audience',
          updatedAt: '2026-07-04T00:00:00.000Z',
        }, { enabled: false }),
      ],
    });

    expect(state.sources['artist-profile']).toBeUndefined();
    expect(state.headline).not.toContain('Private Artist');
    expect(state.nextMove.title).toBe('Complete Artist Profile');
  });

  test('puts a pending approval ahead of active goal work', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        profileDoc(),
        textDoc('growth-goal', 'Grow the audience', 'Active growth goal.', { status: 'active', priority: 'high' }),
      ],
      operational: operational({
        approvals: [operationalItem('output-1', 'Approve teaser cut', 'output', 'pending')],
      }),
    });

    expect(state.nextMove.title).toBe('Review Approve teaser cut');
    expect(state.nextMove.worker).toBeUndefined();
    expect(state.nextMove.route?.target).toBe('manual');
    expect(state.attention[0]?.kind).toBe('approval');
  });

  test('puts failed operational work ahead of speculative next moves', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [profileDoc()],
      operational: operational({
        failures: [operationalItem('automation-1', 'Weekly intel gatherer', 'automation-run', 'failed')],
      }),
    });

    expect(state.nextMove.title).toBe('Recover Weekly intel gatherer');
    expect(state.nextMove.why).toContain('Automation');
    expect(state.attention[0]?.kind).toBe('failure');
  });

  test('does not recommend duplicate asset work when Art Director is already running it', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        profileDoc(),
        doc('artist-calendar', 'Artist Calendar', {
          version: 1,
          events: [{ title: 'Single release', date: '2026-07-10' }],
        }),
        doc('artist-vault', 'Artist Vault', {
          version: 1,
          workspaceId: 'artist-hq',
          vaultRoot: 'vault',
          storageMode: 'copied',
          assets: [],
        }),
      ],
      operational: operational({
        active: [{
          ...operationalItem('work-1', 'Finish single cover art', 'scheduled-work', 'running'),
          worker: 'art-director',
          intent: 'Create final cover art for the single release.',
        }],
      }),
    });

    expect(state.nextMove.title).toBe('Track Finish single cover art');
    expect(state.nextMove.title).not.toContain('Close asset gaps');
    expect(state.nextMove.route?.target).toBe('manual');
  });

  test('does not treat a different release deliverable as duplicate work', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [
        profileDoc(),
        doc('artist-calendar', 'Artist Calendar', {
          version: 1,
          events: [{ title: 'Single release', date: '2026-07-10' }],
        }),
        doc('artist-vault', 'Artist Vault', {
          version: 1,
          workspaceId: 'artist-hq',
          vaultRoot: 'vault',
          storageMode: 'copied',
          assets: [vaultAsset('artist-photo')],
        }),
      ],
      operational: operational({
        active: [{
          ...operationalItem('photo-work', 'Select press photo', 'scheduled-work', 'running'),
          worker: 'art-director',
          intent: 'Select the final press photo.',
          fingerprint: 'v1:hq:art-director:press-photo',
        }],
      }),
    });

    expect(state.nextMove.title).toBe('Close asset gaps before Single release');
  });

  test('surfaces degraded operational sources instead of treating them as empty', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [profileDoc()],
      operational: operational({
        sourceHealth: [{
          source: 'scheduled-work',
          status: 'degraded',
          checkedAt: now.toISOString(),
          itemCount: 0,
          message: 'Scheduled Work JSON is malformed.',
        }],
      }),
    });

    expect(state.attention[0]).toEqual(expect.objectContaining({ kind: 'source-health' }));
    expect(state.attention[0]?.text).toContain('malformed');
  });

  test('ignores expired failures and failures from another scope', () => {
    const expired = {
      ...operationalItem('old-automation', 'Old automation failure', 'automation-run', 'failed'),
      expiresAt: '2026-07-01T00:00:00.000Z',
    };
    const otherCampaign = {
      ...operationalItem('campaign-failure', 'Other campaign failure', 'workflow-run', 'failed'),
      scope: { type: 'campaign' as const, campaignId: 'other' },
    };
    const state = buildHqStateOfPlay({
      now,
      docs: [profileDoc()],
      operational: operational({ failures: [expired, otherCampaign] }),
    });

    expect(state.nextMove.title).not.toContain('Old automation failure');
    expect(state.nextMove.title).not.toContain('Other campaign failure');
  });

  test('retains an exact entity reference for actionable operational work', () => {
    const state = buildHqStateOfPlay({
      now,
      docs: [profileDoc()],
      operational: operational({
        approvals: [operationalItem('output-approval', 'Approve final teaser', 'output', 'pending')],
      }),
    });

    expect(state.nextMove.entityRef).toEqual({
      kind: 'output',
      id: 'output-approval',
      source: 'output:output-approval',
      scope: { type: 'hq' },
    });
    expect(parseHqStateOfPlay(serializeHqStateOfPlay(state))?.nextMove.entityRef).toEqual(state.nextMove.entityRef);
  });
});

function operational(overrides: Partial<import('./types.ts').HqOperationalSnapshot> = {}): import('./types.ts').HqOperationalSnapshot {
  return {
    generatedAt: now.toISOString(),
    scope: { type: 'hq' },
    active: [],
    approvals: [],
    failures: [],
    recentOutputs: [],
    sourceHealth: [],
    ...overrides,
  };
}

function operationalItem(
  id: string,
  title: string,
  kind: import('./types.ts').HqOperationalItemKind,
  status: string,
): import('./types.ts').HqOperationalItem {
  const scope = { type: 'hq' as const };
  return {
    id,
    title,
    kind,
    status,
    updatedAt: now.toISOString(),
    scope,
    fingerprint: `v1:hq:unassigned:${id}`,
    source: `${kind}:${id}`,
  };
}

function profileDoc(): LoadedContextDoc {
  return doc('artist-profile', 'Artist Profile', {
    version: 1,
    artistName: 'Mikey Mike',
    sound: 'raw soul over left-field pop production',
    audience: 'fans of cinematic underdog songs',
    visualWorld: 'noir Americana',
    updatedAt: '2026-07-04T00:00:00.000Z',
  });
}

function completeVaultDoc(): LoadedContextDoc {
  return doc('artist-vault', 'Artist Vault', {
    version: 1,
    workspaceId: 'artist-hq',
    vaultRoot: 'vault',
    storageMode: 'copied',
    updatedAt: '2026-07-04T00:00:00.000Z',
    assets: [
      vaultAsset('master-final'),
      vaultAsset('cover-art'),
      vaultAsset('artist-photo'),
    ],
  });
}

function vaultAsset(kind: string): Record<string, unknown> {
  return {
    id: kind,
    kind,
    name: kind,
    relativePath: `${kind}.wav`,
    status: 'final',
    rightsStatus: 'cleared',
    usableByAgents: true,
    addedAt: '2026-07-04T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  };
}

function doc(slug: string, name: string, payload: unknown, metadata: Partial<ContextDocMetadata> = {}): LoadedContextDoc {
  return textDoc(slug, name, ['```json', JSON.stringify(payload, null, 2), '```'].join('\n'), metadata);
}

function textDoc(slug: string, name: string, body: string, metadata: Partial<ContextDocMetadata> = {}): LoadedContextDoc {
  return {
    slug,
    metadata: {
      name,
      routing: { mode: 'broadcast' },
      enabled: true,
      ...metadata,
    },
    body,
    path: `/tmp/context/${slug}`,
    workspaceRootPath: '/tmp',
  };
}
