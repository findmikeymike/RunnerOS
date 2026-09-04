import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ROUTINE,
  cronForRoutine,
  describeBrief,
  describeCadence,
  emptySignals,
  planScheduledUpdate,
  readSituation,
  type RoutineSignals,
} from './routine.ts';
import { applySiteContentOperations, defaultSiteContent } from './index.ts';
import type { SiteContent } from './types.ts';

const TODAY = '2026-09-15';

function content(overrides: Partial<SiteContent> = {}): SiteContent {
  return { ...defaultSiteContent('Low Tide'), ...overrides };
}

function withDoor(base: SiteContent): SiteContent {
  return { ...base, signup: { ...base.signup, enabled: true } };
}

function signals(overrides: Partial<RoutineSignals> = {}): RoutineSignals {
  return { ...emptySignals(), ...overrides };
}

describe('cadence', () => {
  test('weekly and monthly produce a cron, manual produces none', () => {
    expect(cronForRoutine({ cadence: 'weekly', dayOfWeek: 1, hour: 9 })).toBe('0 9 * * 1');
    expect(cronForRoutine({ cadence: 'monthly', dayOfMonth: 3, hour: 14 })).toBe('0 14 3 * *');
    expect(cronForRoutine({ cadence: 'manual' })).toBeNull();
  });

  test('a monthly day past the 28th still fires every month', () => {
    expect(cronForRoutine({ cadence: 'monthly', dayOfMonth: 31, hour: 9 })).toBe('0 9 28 * *');
  });

  test('out-of-range values are clamped rather than producing a broken cron', () => {
    expect(cronForRoutine({ cadence: 'weekly', dayOfWeek: 9, hour: 40 })).toBe('0 23 * * 6');
    expect(cronForRoutine({ cadence: 'weekly', dayOfWeek: -2, hour: -5 })).toBe('0 0 * * 0');
  });

  test('the default routine is manual, so nothing runs until the artist picks', () => {
    expect(DEFAULT_ROUTINE.cadence).toBe('manual');
    expect(cronForRoutine(DEFAULT_ROUTINE)).toBeNull();
  });

  test('cadence reads as plain language', () => {
    expect(describeCadence({ cadence: 'manual' })).toBe('Only when you ask');
    expect(describeCadence({ cadence: 'weekly', dayOfWeek: 5, hour: 17 })).toBe('Every Friday at 5:00 PM');
    expect(describeCadence({ cadence: 'monthly', dayOfMonth: 22, hour: 0 })).toBe('The 22nd of each month at 12:00 AM');
  });
});

describe('what a scheduled run may do on its own', () => {
  test('content already posted publicly becomes a site update', () => {
    const plan = planScheduledUpdate(content(), signals({
      posted: [{
        id: 'x1',
        postedAt: '2026-09-14T10:00:00.000Z',
        text: 'Mixing the last song today. It is the loudest thing here.',
        url: 'https://x.com/lowtide/1',
        platform: 'x',
      }],
    }), TODAY);

    expect(plan.operations).toHaveLength(1);
    const [op] = plan.operations;
    expect(op).toMatchObject({
      op: 'upsert-journal',
      value: { date: '2026-09-14', title: 'Mixing the last song today', embedUrl: 'https://x.com/lowtide/1' },
    });
    expect(plan.changeClass).toBe('content-only');
  });

  test('rerunning does not duplicate a post already on the site', () => {
    const post = { id: 'x1', postedAt: '2026-09-14T10:00:00.000Z', text: 'Hello', platform: 'x' };
    const first = planScheduledUpdate(content(), signals({ posted: [post] }), TODAY);
    const after = applySiteContentOperations(content(), first.operations).content;

    const second = planScheduledUpdate(after, signals({ posted: [post] }), TODAY);
    expect(second.operations).toHaveLength(0);
  });

  test('a backlog of posts is capped so the page is not flooded', () => {
    const posted = Array.from({ length: 9 }, (_, index) => ({
      id: `x${index}`,
      postedAt: `2026-09-0${index + 1}T10:00:00.000Z`,
      text: `Post ${index}`,
      platform: 'x',
    }));
    const plan = planScheduledUpdate(content(), signals({ posted }), TODAY);
    expect(plan.operations).toHaveLength(3);
  });

  test('it does nothing else at all', () => {
    // A released song with a stale pre-save, a newer release not featured,
    // and a low audit score. A scheduled run must still touch none of it.
    const existing = content({
      releases: [
        { id: 'old', title: 'Old', type: 'single', date: '2025-01-01', featured: true, links: { presave: 'https://p.example.com' } },
        { id: 'new', title: 'New', type: 'single', date: '2026-08-01', links: {} },
      ],
    });
    const plan = planScheduledUpdate(existing, signals({
      releases: [{ id: 'r9', title: 'Unlisted', type: 'single', date: '2026-09-01' }],
      upcomingEvents: [{ id: 'e1', date: '2026-10-02', title: 'Denver — Bluebird' }],
      auditScore: 40,
    }), TODAY);

    expect(plan.operations).toHaveLength(0);
  });
});

describe('what it raises with the artist instead', () => {
  test('a released song still advertising a pre-save is called out', () => {
    const existing = content({
      releases: [{
        id: 'low-tide',
        title: 'Low Tide',
        type: 'single',
        date: '2026-09-01',
        links: { presave: 'https://presave.example.com' },
      }],
    });
    const found = readSituation(existing, signals(), TODAY);
    const presave = found.find(item => item.kind === 'stale-presave')!;
    expect(presave.headline).toContain('Low Tide');
    expect(presave.headline).toContain('pre-save');
  });

  test('an unreleased song keeps its pre-save without comment', () => {
    const existing = content({
      releases: [{ id: 'f', title: 'Future', type: 'single', date: '2026-12-01', links: { presave: 'https://p.example.com' } }],
    });
    expect(readSituation(existing, signals(), TODAY).some(item => item.kind === 'stale-presave')).toBe(false);
  });

  test('a release inside two weeks prompts the email catcher idea', () => {
    const found = readSituation(withDoor(content()), signals({
      releases: [{ id: 'r1', title: 'Low Tide', type: 'single', date: '2026-09-22' }],
    }), TODAY);

    const soon = found.find(item => item.kind === 'release-soon')!;
    expect(soon.headline).toContain('7 days');
    expect(found.some(item => item.kind === 'gate-final-audio')).toBe(true);
  });

  test('a release far out does not prompt anything yet', () => {
    const found = readSituation(withDoor(content()), signals({
      releases: [{ id: 'r1', title: 'Later', type: 'single', date: '2026-12-01' }],
    }), TODAY);
    expect(found.some(item => item.kind === 'release-soon')).toBe(false);
  });

  test('an empty show list with a busy calendar asks for the list, never guesses', () => {
    const found = readSituation(content(), signals({
      upcomingEvents: [{ id: 'e1', date: '2026-10-02', title: 'Denver — Bluebird' }],
    }), TODAY);

    const shows = found.find(item => item.kind === 'no-shows-listed')!;
    // The fix is the artist handing over the details, not the agent parsing them.
    expect(shows.suggestion).toContain('Send me the dates');
  });

  test('a site already listing shows says nothing about them', () => {
    const existing = content({
      shows: [{ id: 's1', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }],
    });
    const found = readSituation(existing, signals({
      upcomingEvents: [{ id: 'e1', date: '2026-10-02', title: 'Denver — Bluebird' }],
    }), TODAY);
    expect(found.some(item => item.kind === 'no-shows-listed')).toBe(false);
  });

  test('the hero being stale is raised, not changed', () => {
    const existing = content({
      releases: [
        { id: 'old', title: 'Old One', type: 'single', date: '2025-01-01', featured: true, links: {} },
        { id: 'new', title: 'New One', type: 'single', date: '2026-08-01', links: {} },
      ],
    });
    const found = readSituation(existing, signals(), TODAY);
    expect(found.find(item => item.kind === 'stale-hero')?.suggestion).toContain('New One');
  });

  test('no signup door at all is the first thing worth fixing', () => {
    const found = readSituation(content(), signals(), TODAY);
    expect(found.some(item => item.kind === 'no-door')).toBe(true);
  });

  test('a door nobody has used in a month is raised; a busy one is not', () => {
    const quiet = readSituation(withDoor(content()), signals({ lastSignupAt: '2026-07-01' }), TODAY);
    expect(quiet.some(item => item.kind === 'quiet-door')).toBe(true);

    const busy = readSituation(withDoor(content()), signals({ lastSignupAt: '2026-09-10' }), TODAY);
    expect(busy.some(item => item.kind === 'quiet-door')).toBe(false);
  });

  test('a low search score is raised with an offer to fix it', () => {
    const found = readSituation(content(), signals({ auditScore: 55 }), TODAY);
    expect(found.find(item => item.kind === 'low-seo')?.headline).toContain('55');
  });

  test('a healthy site with nothing pending says nothing', () => {
    const existing = withDoor(content({
      releases: [{ id: 'out', title: 'Out', type: 'single', date: '2026-08-01', featured: true, links: {} }],
      shows: [{ id: 's1', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }],
    }));
    const found = readSituation(existing, signals({ auditScore: 95, lastSignupAt: '2026-09-14' }), TODAY);
    expect(found).toHaveLength(0);
  });
});

describe('the brief line', () => {
  test('reads differently when the change still needs a click', () => {
    const base = { runId: 'r1', weekOf: TODAY, cadence: 'weekly' as const, observations: [] };
    const site = { buildHash: 'h', changeClass: 'content-only' as const, summary: 'Added your latest post', auditScore: 92 };

    expect(describeBrief({ ...base, site: { ...site, tier: 'one-click' } }))
      .toBe('Publish: Added your latest post');
    expect(describeBrief({ ...base, site: { ...site, tier: 'trusted' } }))
      .toBe('Published: Added your latest post');
  });

  test('a quiet run says so plainly', () => {
    expect(describeBrief({ runId: 'r1', weekOf: TODAY, cadence: 'monthly', observations: [], nothingToDo: true }))
      .toBe('Nothing needed on the site this time.');
  });

  test('with no action it leads with what it wants to raise', () => {
    expect(describeBrief({
      runId: 'r1',
      weekOf: TODAY,
      cadence: 'weekly',
      observations: [{ kind: 'stale-presave', headline: '"Low Tide" is out but the site still links to a pre-save.', suggestion: 'Swap it.' }],
    })).toBe('"Low Tide" is out but the site still links to a pre-save.');
  });
});
