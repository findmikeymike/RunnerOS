import { describe, expect, test } from 'bun:test';
import { renderSharedIntelBody, type SharedIntelNote } from '../shared-intel/index.ts';
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import {
  buildHqStateContextDoc,
  buildHqStateOfPlay,
  HQ_STATE_CONTEXT_SLUG,
  parseHqStateOfPlay,
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
    expect(state.nextMove.route?.target).toBe('manual');
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
    expect(state.nextMove.route?.target).toBe('manual');
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
});

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
