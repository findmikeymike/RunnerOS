import { describe, expect, test } from 'bun:test';
import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import {
  buildManagerBrief,
  MANAGER_BRIEF_MAX_CHARS,
  renderManagerBriefPromptSection,
  resolveHqCampaignFocus,
} from './manager-brief.ts';
import type { ManagerCampaignSnapshot } from './types.ts';

const now = new Date('2026-08-29T12:00:00.000Z');

describe('Manager Brief', () => {
  test('composes a compact source-linked artist operating packet', () => {
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      docs: [
        jsonDoc('artist-profile', {
          version: 1,
          artistName: 'Mikey Mike',
          mission: 'Build an independent body of work that lasts.',
          sound: 'Raw soul over left-field pop production.',
          audience: 'Listeners who want bruised honesty without polish.',
          rules: 'Never chase trends; Protect the songs',
          updatedAt: '2026-08-20T00:00:00.000Z',
        }),
        jsonDoc('artist-release-horizon', {
          version: 2,
          months: {
            '2026-09': { title: 'New single', event: 'release', plan: 'Ship it.', keyGoal: 'Master delivered' },
            '2027-10': { title: 'Outside window', event: 'business', plan: 'Ignore.', keyGoal: '' },
          },
          updatedAt: '2026-08-20T00:00:00.000Z',
        }),
        jsonDoc('artist-spotify-snapshot', {
          version: 1,
          snapshotDate: '2026-08-27',
          windowDays: 28,
          artist: {},
          metrics: { streams: 181000, listeners: 82000, followers: 9200 },
          tracks: [{ name: "Doin' Me", streams: 53000 }],
          updatedAt: '2026-08-27T12:00:00.000Z',
        }),
        jsonDoc('artist-instagram-snapshot', {
          version: 1,
          dataSource: 'instagram-insights-browser',
          snapshotDate: '2026-08-27',
          windowDays: 14,
          profile: { profile: 'primary', handle: '@mikeymike' },
          metrics: { followers: 12000, followerDelta: 140, accountsReached: 44000 },
          updatedAt: '2026-08-27T13:00:00.000Z',
        }),
      ],
      relatedCampaigns: [campaign('campaign-1', 'September single', '2026-09-12')],
      operatingState: {
        nextMove: { title: 'Approve the cover', why: 'Distribution needs final art.', worker: 'art-director' },
        blockers: ['Final cover not approved'],
      },
    });

    expect(brief.identity.artistName).toBe('Mikey Mike');
    expect(brief.trajectory.map((item) => item.month)).toEqual(['2026-09']);
    expect(brief.campaignFocus).toEqual(expect.objectContaining({ label: 'Current campaign', releaseDate: '2026-09-12' }));
    expect(brief.growth.spotify).toEqual(expect.objectContaining({ value: 181000 }));
    expect(brief.growth.instagram).toEqual(expect.objectContaining({ delta: 140 }));
    expect(brief.revision).toMatch(/^manager-v1:fnv1a:[0-9a-f]{8}$/);
    expect(brief.budget.actualChars).toBe(renderManagerBriefPromptSection(brief).length);
    expect(brief.budget.actualChars).toBeLessThanOrEqual(MANAGER_BRIEF_MAX_CHARS);
  });

  test('selects nearest dated campaign, preferring a future date on a tie', () => {
    const focus = resolveHqCampaignFocus([
      campaign('past', 'Past release', '2026-08-19'),
      campaign('future', 'Future release', '2026-09-08'),
    ], now);

    expect(focus?.focus.workspaceId).toBe('future');
    expect(focus?.focus.label).toBe('Current campaign');
  });

  test('falls back to the primary campaign without inventing a fuzzy date', () => {
    const primary = campaign('primary', 'Primary campaign');
    primary.primary = true;
    primary.mission = { ...primary.mission!, releaseDate: undefined, timeline: 'this fall' };
    const focus = resolveHqCampaignFocus([
      primary,
      campaign('other', 'Other campaign'),
    ], now);

    expect(focus?.focus.workspaceId).toBe('primary');
    expect(focus?.focus.label).toBe('Release date needed');
    expect(focus?.focus.releaseDate).toBeUndefined();
  });

  test('keeps revision stable when only generation time changes', () => {
    const input = {
      workspaceId: 'hq-1',
      docs: [jsonDoc('artist-profile', {
        version: 1,
        artistName: 'Mikey Mike',
        mission: 'Stay focused.',
        updatedAt: '2026-08-20T00:00:00.000Z',
      })],
      relatedCampaigns: [] as ManagerCampaignSnapshot[],
    };
    const first = buildManagerBrief({ ...input, now });
    const second = buildManagerBrief({ ...input, now: new Date('2026-08-30T12:00:00.000Z') });

    expect(first.generatedAt).not.toBe(second.generatedAt);
    expect(first.revision).toBe(second.revision);
  });

  test('labels stale Spotify and partial Instagram independently without inventing movement', () => {
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      docs: [
        jsonDoc('artist-spotify-snapshot', {
          version: 1,
          snapshotDate: '2026-08-01',
          windowDays: 28,
          artist: {},
          metrics: { streams: 1000 },
          updatedAt: '2026-08-01T00:00:00.000Z',
        }),
        jsonDoc('artist-instagram-snapshot', {
          version: 1,
          dataSource: 'instagram-insights-browser',
          snapshotDate: '2026-08-28',
          windowDays: 14,
          profile: { profile: 'primary' },
          metrics: { followers: 2000, followerDelta: -12 },
          partial: true,
          errors: ['Reach was unavailable.'],
          updatedAt: '2026-08-28T00:00:00.000Z',
        }),
      ],
      relatedCampaigns: [],
    });

    expect(brief.growth.spotify).toEqual(expect.objectContaining({ value: 1000, delta: undefined }));
    expect(brief.growth.instagram).toEqual(expect.objectContaining({ value: 2000, delta: -12, partial: true }));
    expect(brief.sourceHealth).toContainEqual(expect.objectContaining({ source: 'artist-spotify-snapshot', status: 'stale' }));
    expect(brief.sourceHealth).toContainEqual(expect.objectContaining({ source: 'artist-instagram-snapshot', status: 'partial' }));
  });

  test('reports malformed year planning as source health and omits invented trajectory', () => {
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      docs: [jsonDoc('artist-release-horizon', { version: 2, months: 'not-a-month-map' })],
      relatedCampaigns: [],
    });

    expect(brief.trajectory).toEqual([]);
    expect(brief.sourceHealth).toContainEqual(expect.objectContaining({
      source: 'artist-release-horizon',
      status: 'malformed',
    }));
  });

  test('never exceeds the prompt budget under hostile source text', () => {
    const huge = 'A'.repeat(20_000);
    const campaignSnapshot = campaign('campaign-1', huge, '2026-09-12');
    campaignSnapshot.sourceHealth = Array.from({ length: 60 }, (_, index) => ({
      source: `source-${index}-${huge}`,
      status: 'malformed' as const,
      message: huge,
    }));
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      docs: [jsonDoc('artist-profile', {
        version: 1,
        artistName: huge,
        mission: huge,
        sound: huge,
        audience: huge,
        rules: huge,
        updatedAt: '2026-08-20T00:00:00.000Z',
      })],
      relatedCampaigns: [campaignSnapshot],
      operatingState: {
        nextMove: { title: huge, why: huge },
        attention: Array.from({ length: 20 }, () => ({ kind: 'x', text: huge, source: 'x' })),
        blockers: Array.from({ length: 20 }, () => huge),
      },
    });

    expect(renderManagerBriefPromptSection(brief).length).toBeLessThanOrEqual(MANAGER_BRIEF_MAX_CHARS);
    expect(brief.budget.actualChars).toBe(renderManagerBriefPromptSection(brief).length);
  });
});

describe('Manager Brief timeline section', () => {
  const timelineDocs = () => [
    jsonDoc('artist-profile', {
      version: 1,
      artistName: 'Mikey Mike',
      updatedAt: '2026-08-20T00:00:00.000Z',
    }),
    jsonDoc('artist-calendar', {
      version: 1,
      updatedAt: '2026-08-20T00:00:00.000Z',
      events: [
        { id: 'meet-1', date: '2026-09-20', title: 'Label meeting', workspaceLinks: [], relatedPersonIds: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
      ],
    }),
    goalDoc('listeners-goal', 'Hit 10k listeners', '2026-10-15'),
  ];

  test('renders strategic dates, campaign roll-ups, and the beyond-window synopsis', () => {
    const withWork: ManagerCampaignSnapshot = {
      ...campaign('campaign-1', 'Autumn Single', '2026-10-02'),
      calendar: { total: 4, active: 3, blocked: 1, completed: 0, updatedAt: '2026-08-20T00:00:00.000Z' },
      work: { total: 2, active: 2, blocked: 0, completed: 0, updatedAt: '2026-08-20T00:00:00.000Z' },
      timelineEntries: [
        timelineEntry('deadline-1', '2026-09-10', 'Master deadline', 'strategic', true, 'deadline'),
        timelineEntry('task-1', '2026-09-12', 'Prepare visualizer', 'operational'),
        timelineEntry('task-2', '2026-09-14', 'Schedule teaser', 'operational'),
      ],
    };
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      timezone: 'UTC',
      docs: timelineDocs(),
      relatedCampaigns: [withWork, campaign('campaign-2', 'Winter EP', '2027-01-15')],
    });

    expect(brief.timeline).toBeDefined();
    expect(brief.timeline!.from).toBe('2026-08-29');
    expect(brief.timeline!.to).toBe('2026-11-27');
    expect(brief.timeline!.entries.map((entry) => entry.title)).toEqual([
      'Master deadline',
      'Label meeting',
      'Autumn Single',
      'Hit 10k listeners',
    ]);
    expect(brief.timeline!.rollups).toEqual([
      { label: 'Autumn Single', scheduled: 2, needsAttention: 1 },
    ]);
    expect(brief.timeline!.beyond).toEqual({ strategic: 1, nextDate: '2027-01-15' });

    const rendered = renderManagerBriefPromptSection(brief);
    expect(rendered).toContain('### Timeline');
    expect(rendered).toContain('- 2026-09-20: Label meeting [event]');
    expect(rendered).toContain('- Autumn Single: 2 scheduled, 1 need attention');
    expect(rendered).toContain('Beyond: 1 strategic date later (next 2027-01-15)');
    // Release Horizon remains its own untouched section.
    const timelineIndex = rendered.indexOf('### Timeline');
    expect(timelineIndex).toBeGreaterThan(-1);
  });

  test('omits the section entirely when nothing is dated', () => {
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      timezone: 'UTC',
      docs: [jsonDoc('artist-profile', { version: 1, artistName: 'M', updatedAt: '2026-08-20T00:00:00.000Z' })],
      relatedCampaigns: [],
    });

    expect(brief.timeline).toBeUndefined();
    expect(renderManagerBriefPromptSection(brief)).not.toContain('### Timeline');
  });

  test('revision changes when a calendar event is added', () => {
    const base = buildManagerBrief({ workspaceId: 'hq-1', now, timezone: 'UTC', docs: timelineDocs(), relatedCampaigns: [] });
    const withExtra = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      timezone: 'UTC',
      docs: [
        ...timelineDocs().filter((doc) => doc.slug !== 'artist-calendar'),
        jsonDoc('artist-calendar', {
          version: 1,
          updatedAt: '2026-08-21T00:00:00.000Z',
          events: [
            { id: 'meet-1', date: '2026-09-20', title: 'Label meeting', workspaceLinks: [], relatedPersonIds: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
            { id: 'show-1', date: '2026-09-28', title: 'Hometown show', workspaceLinks: [], relatedPersonIds: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
          ],
        }),
      ],
      relatedCampaigns: [],
    });

    expect(withExtra.revision).not.toBe(base.revision);
  });

  test('under budget pressure the timeline degrades before the release horizon', () => {
    const monthKeys = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08'];
    const longMonths: Record<string, { title: string; event: string; plan: string; keyGoal: string }> = {};
    monthKeys.forEach((month, index) => {
      longMonths[month] = {
        title: `Plan ${index} ${'x'.repeat(90)}`,
        event: 'release',
        plan: 'p'.repeat(100),
        keyGoal: `Goal ${index} ${'y'.repeat(160)}`,
      };
    });
    const busyEvents = Array.from({ length: 10 }, (_, index) => ({
      id: `event-${index}`,
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      title: `Strategic commitment ${index} ${'z'.repeat(100)}`,
      workspaceLinks: [],
      relatedPersonIds: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }));
    const brief = buildManagerBrief({
      workspaceId: 'hq-1',
      now,
      timezone: 'UTC',
      docs: [
        jsonDoc('artist-profile', {
          version: 1,
          artistName: 'Mikey Mike',
          mission: 'm'.repeat(480),
          sound: 's'.repeat(340),
          audience: 'a'.repeat(340),
          rules: Array.from({ length: 5 }, (_, index) => `Rule ${index} ${'r'.repeat(160)}`).join('; '),
          updatedAt: '2026-08-20T00:00:00.000Z',
        }),
        jsonDoc('artist-release-horizon', { version: 2, months: longMonths, updatedAt: '2026-08-20T00:00:00.000Z' }),
        jsonDoc('artist-calendar', { version: 1, updatedAt: '2026-08-20T00:00:00.000Z', events: busyEvents }),
      ],
      relatedCampaigns: [{
        ...campaign('campaign-1', 'Autumn Single', '2026-10-02'),
        mission: {
          ...campaign('campaign-1', 'Autumn Single', '2026-10-02').mission!,
          goal: 'g'.repeat(490),
        },
        readiness: {
          done: 3,
          total: 12,
          nextMissing: Array.from({ length: 5 }, (_, index) => `Missing piece ${index} ${'n'.repeat(100)}`),
        },
      }],
      operatingState: {
        blockers: Array.from({ length: 3 }, (_, index) => `Blocker ${index} ${'b'.repeat(220)}`),
      },
    });

    expect(brief.budget.truncated).toBe(true);
    const rendered = renderManagerBriefPromptSection(brief);
    expect(rendered.length).toBeLessThanOrEqual(MANAGER_BRIEF_MAX_CHARS);
    // Trajectory survives while the timeline gave ground first.
    expect(brief.trajectory.length).toBeGreaterThan(0);
    const timelineShrank = !brief.timeline || brief.timeline.entries.length < 10;
    expect(timelineShrank).toBe(true);
  });
});

function goalDoc(slug: string, name: string, deadline: string): LoadedContextDoc {
  return {
    slug,
    metadata: {
      name,
      routing: { mode: 'broadcast' },
      enabled: true,
      status: 'active',
      priority: 'high',
      deadline,
    } satisfies ContextDocMetadata,
    body: 'Goal body.',
    path: `/tmp/${slug}`,
    workspaceRootPath: '/tmp',
  };
}

function campaign(workspaceId: string, name: string, releaseDate?: string): ManagerCampaignSnapshot {
  return {
    workspaceId,
    name,
    primary: false,
    mission: {
      id: 'mission-brief',
      workspaceId,
      status: 'full',
      completeness: 100,
      missionType: 'single',
      title: name,
      goal: 'Build momentum.',
      releaseDate,
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    readiness: { done: 8, total: 12, nextMissing: ['Cover art'] },
    sourceHealth: [],
  };
}

function timelineEntry(
  id: string,
  date: string,
  title: string,
  tier: 'strategic' | 'operational',
  needsAttention = false,
  category: 'deadline' | 'task' = 'task',
) {
  return {
    id: `campaign-item:campaign-1:${id}`,
    date,
    timezone: 'UTC',
    sortKey: `${date}T00:00`,
    title,
    tier,
    category,
    needsAttention,
    origin: { kind: 'campaign-item' as const, workspaceId: 'campaign-1', campaignId: 'campaign-1', sourceId: id },
  };
}

function jsonDoc(slug: string, payload: unknown): LoadedContextDoc {
  return {
    slug,
    metadata: { name: slug, routing: { mode: 'broadcast' }, enabled: true } satisfies ContextDocMetadata,
    body: ['```json', JSON.stringify(payload), '```'].join('\n'),
    path: `/tmp/${slug}`,
    workspaceRootPath: '/tmp',
  };
}
