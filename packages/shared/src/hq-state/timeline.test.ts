import { describe, expect, test } from 'bun:test';
import type { CampaignCalendarItem } from '../campaign-calendar/index.ts';
import type { ScheduledWorkOrder } from '../scheduled-work/index.ts';
import type { ArtistCalendarEvent } from '../artist-context/calendar.ts';
import {
  buildArtistTimeline,
  dateKeyInTimezone,
  type BuildArtistTimelineInput,
  type TimelineCampaignInput,
} from './timeline.ts';

const TZ = 'America/Chicago';
const NOW = new Date('2026-08-29T12:00:00.000Z');

function baseInput(overrides: Partial<BuildArtistTimelineInput> = {}): BuildArtistTimelineInput {
  return {
    now: NOW,
    from: '2026-08-29',
    to: '2026-11-27',
    timezone: TZ,
    hqWorkspaceId: 'artist-hq',
    hqEvents: [],
    hqOrders: [],
    campaigns: [],
    goals: [],
    ...overrides,
  };
}

function hqEvent(overrides: Partial<ArtistCalendarEvent> = {}): ArtistCalendarEvent {
  return {
    id: 'event-1',
    date: '2026-09-05',
    title: 'Label meeting',
    workspaceLinks: [],
    relatedPersonIds: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function campaignItem(overrides: Partial<CampaignCalendarItem> = {}): CampaignCalendarItem {
  return {
    id: 'item-1',
    date: '2026-09-10',
    timezone: TZ,
    title: 'Post teaser',
    kind: 'manual',
    status: 'scheduled',
    source: 'user',
    assetRefs: [],
    finalRefs: [],
    outputRefs: [],
    personIds: [],
    runHistory: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function order(overrides: Partial<ScheduledWorkOrder> = {}): ScheduledWorkOrder {
  return {
    version: 1,
    id: 'order-1',
    owner: { scope: 'campaign', workspaceId: 'camp-1', campaignId: 'camp-1' },
    calendarLink: { calendar: 'campaign', itemId: 'item-1' },
    title: 'Publish single teaser',
    type: 'social-publish',
    status: 'scheduled',
    // 18:00 UTC = 13:00 America/Chicago (CDT)
    startAt: '2026-09-10T18:00:00.000Z',
    timezone: TZ,
    execution: { type: 'agent-task', agentSlug: 'social-publisher', prompt: 'go' },
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: { payloadDigest: 'digest', idempotencyKey: 'key' },
    ...overrides,
  } as ScheduledWorkOrder;
}

function campaign(overrides: Partial<TimelineCampaignInput> = {}): TimelineCampaignInput {
  return {
    workspaceId: 'camp-1',
    campaignId: 'camp-1',
    label: 'Summer EP',
    items: [],
    orders: [],
    ...overrides,
  };
}

describe('dedup — explicit links only', () => {
  test('a paired order and shell yield one entry, taking the shell title and time', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        items: [campaignItem({ id: 'item-1', title: 'Teaser goes live', time: '13:00', kind: 'scheduled-job', scheduledWorkId: 'order-1' })],
        orders: [order({ id: 'order-1', calendarLink: { calendar: 'campaign', itemId: 'item-1' } })],
      })],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]!.origin.kind).toBe('scheduled-work');
    expect(timeline.entries[0]!.title).toBe('Teaser goes live');
    expect(timeline.entries[0]!.time).toBe('13:00');
    expect(timeline.warnings).toHaveLength(0);
  });

  test('a half-linked pair yields one entry plus a warning — never two, never zero', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        // Shell exists but its backlink points elsewhere.
        items: [campaignItem({ id: 'item-1', kind: 'scheduled-job', scheduledWorkId: 'someone-else' })],
        orders: [order({ id: 'order-1', calendarLink: { calendar: 'campaign', itemId: 'item-1' } })],
      })],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.warnings.some((warning) => warning.reason.includes('half-linked'))).toBe(true);
  });

  test('an order linking to a missing shell emits once with a warning', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({ orders: [order({ calendarLink: { calendar: 'campaign', itemId: 'ghost' } })] })],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.warnings.some((warning) => warning.reason.includes('missing calendar item'))).toBe(true);
  });

  test('hidden orders are omitted entirely', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({ orders: [order({ calendarVisibility: 'hidden' })] })],
    }));

    expect(timeline.entries).toHaveLength(0);
    expect(timeline.warnings).toHaveLength(0);
  });

  test('a shell-side back-reference alone still collapses the pair to one entry', () => {
    // The order's calendarLink points at a stale id, but the shell's
    // scheduledWorkId names the order: one entry, shell title wins, warning.
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        items: [campaignItem({ id: 'item-1', title: 'Teaser goes live', kind: 'scheduled-job', scheduledWorkId: 'order-1' })],
        orders: [order({ id: 'order-1', calendarLink: { calendar: 'campaign', itemId: 'stale-id' } })],
      })],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]!.origin.kind).toBe('scheduled-work');
    expect(timeline.entries[0]!.title).toBe('Teaser goes live');
    expect(timeline.warnings.some((warning) => warning.reason.includes('half-linked'))).toBe(true);
  });

  test('a shell without an order is a legitimate standalone entry', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({ items: [campaignItem()] })],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]!.origin.kind).toBe('campaign-item');
  });

  test('a release and a same-day HQ event both appear — no heuristic merging', () => {
    const timeline = buildArtistTimeline(baseInput({
      hqEvents: [hqEvent({ id: 'event-1', date: '2026-10-02', title: 'Single release party' })],
      campaigns: [campaign({ releaseDate: '2026-10-02' })],
    }));

    expect(timeline.entries).toHaveLength(2);
    const kinds = timeline.entries.map((entry) => entry.origin.kind).sort();
    expect(kinds).toEqual(['hq-event', 'release']);
  });

  test('an HQ event paired with an HQ order collapses to the order', () => {
    const timeline = buildArtistTimeline(baseInput({
      hqEvents: [hqEvent({ id: 'event-1', scheduledWorkId: 'order-hq' })],
      hqOrders: [order({
        id: 'order-hq',
        owner: { scope: 'hq', workspaceId: 'artist-hq' },
        calendarLink: { calendar: 'hq', itemId: 'event-1' },
        startAt: '2026-09-05T18:00:00.000Z',
        type: 'agent-task',
      })],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]!.origin.kind).toBe('scheduled-work');
    expect(timeline.entries[0]!.tier).toBe('strategic');
  });
});

describe('tier derivation', () => {
  test('a campaign task awaiting approval is strategic; without approval it is operational', () => {
    const waiting = buildArtistTimeline(baseInput({
      campaigns: [campaign({ items: [campaignItem({ status: 'needs-approval' })] })],
    }));
    const plain = buildArtistTimeline(baseInput({
      campaigns: [campaign({ items: [campaignItem({ status: 'scheduled' })] })],
    }));

    expect(waiting.entries[0]!.tier).toBe('strategic');
    expect(waiting.entries[0]!.needsAttention).toBe(true);
    expect(plain.entries[0]!.tier).toBe('operational');
  });

  test('releases, goals, HQ events, and campaign deadlines are always strategic', () => {
    const timeline = buildArtistTimeline(baseInput({
      hqEvents: [hqEvent()],
      campaigns: [campaign({
        releaseDate: '2026-10-02',
        items: [campaignItem({ id: 'deadline-1', kind: 'deadline', title: 'Master due' })],
      })],
      goals: [{ slug: 'goal-1', title: 'Hit 10k listeners', deadline: '2026-11-01', workspaceId: 'artist-hq' }],
    }));

    expect(timeline.entries.every((entry) => entry.tier === 'strategic')).toBe(true);
    expect(timeline.entries).toHaveLength(4);
  });

  test('canceled and deleted items never appear', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        items: [
          campaignItem({ id: 'a', status: 'canceled' }),
          campaignItem({ id: 'b', deletedAt: '2026-08-20T00:00:00.000Z' }),
        ],
        orders: [order({ id: 'o1', status: 'canceled', calendarLink: { calendar: 'campaign', itemId: 'ghost' } })],
      })],
    }));

    expect(timeline.entries).toHaveLength(0);
  });
});

describe('goal eligibility', () => {
  test('a malformed deadline yields a warning, not an entry', () => {
    const timeline = buildArtistTimeline(baseInput({
      goals: [{ slug: 'bad', title: 'Vague goal', deadline: 'sometime soon', workspaceId: 'artist-hq' }],
    }));

    expect(timeline.entries).toHaveLength(0);
    expect(timeline.warnings.some((warning) => warning.source === 'goal')).toBe(true);
  });

  test('a malformed release date yields a warning, not an entry', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({ releaseDate: 'Q4' })],
    }));

    expect(timeline.entries).toHaveLength(0);
    expect(timeline.warnings.some((warning) => warning.source === 'mission-brief')).toBe(true);
  });
});

describe('ordering and windowing', () => {
  test('mixed tiers sort strictly chronologically; limit applies after sort', () => {
    const timeline = buildArtistTimeline(baseInput({
      hqEvents: [hqEvent({ id: 'late', date: '2026-11-01', title: 'Late' })],
      campaigns: [campaign({
        items: [campaignItem({ id: 'early', date: '2026-09-01', title: 'Early task' })],
        releaseDate: '2026-10-02',
      })],
      limit: 2,
    }));

    expect(timeline.entries.map((entry) => entry.date)).toEqual(['2026-09-01', '2026-10-02']);
  });

  test('tier filter selects without reordering', () => {
    const timeline = buildArtistTimeline(baseInput({
      hqEvents: [hqEvent({ date: '2026-11-01' })],
      campaigns: [campaign({ items: [campaignItem({ date: '2026-09-01' })] })],
      tiers: ['strategic'],
    }));

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]!.origin.kind).toBe('hq-event');
  });

  test('beyondWindow counts strategic entries past the window and survives limit', () => {
    const timeline = buildArtistTimeline(baseInput({
      to: '2026-09-30',
      campaigns: [
        campaign({ workspaceId: 'c1', label: 'Single A', releaseDate: '2026-11-14' }),
        campaign({ workspaceId: 'c2', label: 'Single B', releaseDate: '2026-12-05' }),
      ],
      hqEvents: [hqEvent({ date: '2026-09-05' })],
      limit: 1,
    }));

    expect(timeline.beyondWindow).toEqual({ strategic: 2, nextDate: '2026-11-14' });
    expect(timeline.entries).toHaveLength(1);
  });

  test('entries before the window are excluded', () => {
    const timeline = buildArtistTimeline(baseInput({
      hqEvents: [hqEvent({ date: '2026-08-01' })],
    }));

    expect(timeline.entries).toHaveLength(0);
  });
});

describe('roll-ups', () => {
  test('operational volume is counted per campaign and unaffected by the tier filter', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        items: [
          campaignItem({ id: 'a', date: '2026-09-01' }),
          campaignItem({ id: 'b', date: '2026-09-02', status: 'failed' }),
        ],
      })],
      tiers: ['strategic'],
    }));

    // The failed item is strategic (needs attention); only 'a' is operational.
    expect(timeline.rollups).toEqual([
      { workspaceId: 'camp-1', campaignId: 'camp-1', label: 'Summer EP', counts: { total: 1, needsAttention: 0 } },
    ]);
  });
});

describe('warnings and staleness', () => {
  test('collector warnings merge with builder warnings', () => {
    const timeline = buildArtistTimeline(baseInput({
      warnings: [{ source: 'campaign-calendar', workspaceId: 'broken', reason: 'parse failed' }],
      campaigns: [campaign({ orders: [order({ calendarLink: { calendar: 'campaign', itemId: 'ghost' } })] })],
    }));

    expect(timeline.warnings).toHaveLength(2);
  });

  test('entries from stale sources are present and flagged, never dropped', () => {
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        items: [campaignItem()],
        releaseDate: '2026-10-02',
        staleSources: ['campaign-calendar', 'mission-brief'],
      })],
    }));

    expect(timeline.entries).toHaveLength(2);
    expect(timeline.entries.every((entry) => entry.stale === true)).toBe(true);
  });
});

describe('timezone', () => {
  test('an order near midnight lands on the reference-timezone day, not the UTC day', () => {
    // 03:30 UTC on Sep 11 is 22:30 on Sep 10 in America/Chicago.
    const timeline = buildArtistTimeline(baseInput({
      campaigns: [campaign({
        orders: [order({ startAt: '2026-09-11T03:30:00.000Z', calendarLink: { calendar: 'campaign', itemId: 'ghost' } })],
      })],
    }));

    expect(timeline.entries[0]!.date).toBe('2026-09-10');
    expect(timeline.entries[0]!.time).toBe('22:30');
  });

  test('dateKeyInTimezone returns null for garbage input', () => {
    expect(dateKeyInTimezone('not a date', TZ)).toBeNull();
  });
});
