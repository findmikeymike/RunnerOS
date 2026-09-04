import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ROUTINE,
  cronForRoutine,
  describeBrief,
  describeCadence,
  planSiteUpdate,
  type RoutineSignals,
} from './routine.ts';
import { applySiteContentOperations, defaultSiteContent } from './index.ts';
import type { SiteContent } from './types.ts';

const TODAY = '2026-09-15';

function content(overrides: Partial<SiteContent> = {}): SiteContent {
  return { ...defaultSiteContent('Low Tide'), ...overrides };
}

function signals(overrides: Partial<RoutineSignals> = {}): RoutineSignals {
  return { releases: [], shows: [], ...overrides };
}

describe('cadence', () => {
  test('weekly and monthly produce a cron, manual produces none', () => {
    expect(cronForRoutine({ cadence: 'weekly', dayOfWeek: 1, hour: 9 })).toBe('0 9 * * 1');
    expect(cronForRoutine({ cadence: 'monthly', dayOfMonth: 3, hour: 14 })).toBe('0 14 3 * *');
    expect(cronForRoutine({ cadence: 'manual' })).toBeNull();
  });

  test('a monthly day past the 28th still fires every month', () => {
    // Otherwise February would silently skip.
    expect(cronForRoutine({ cadence: 'monthly', dayOfMonth: 31, hour: 9 })).toBe('0 9 28 * *');
  });

  test('out-of-range values are clamped rather than producing a broken cron', () => {
    expect(cronForRoutine({ cadence: 'weekly', dayOfWeek: 9, hour: 40 })).toBe('0 23 * * 6');
    expect(cronForRoutine({ cadence: 'weekly', dayOfWeek: -2, hour: -5 })).toBe('0 0 * * 0');
    expect(cronForRoutine({ cadence: 'monthly', dayOfMonth: 0, hour: 9 })).toBe('0 9 1 * *');
  });

  test('the default routine is manual, so nothing runs until the artist picks', () => {
    expect(DEFAULT_ROUTINE.cadence).toBe('manual');
    expect(cronForRoutine(DEFAULT_ROUTINE)).toBeNull();
  });

  test('cadence reads as plain language', () => {
    expect(describeCadence({ cadence: 'manual' })).toBe('Only when you ask');
    expect(describeCadence({ cadence: 'weekly', dayOfWeek: 1, hour: 9 })).toBe('Every Monday at 9:00 AM');
    expect(describeCadence({ cadence: 'weekly', dayOfWeek: 5, hour: 17 })).toBe('Every Friday at 5:00 PM');
    expect(describeCadence({ cadence: 'monthly', dayOfMonth: 1, hour: 12 })).toBe('The 1st of each month at 12:00 PM');
    expect(describeCadence({ cadence: 'monthly', dayOfMonth: 22, hour: 0 })).toBe('The 22nd of each month at 12:00 AM');
    expect(describeCadence({ cadence: 'monthly', dayOfMonth: 3, hour: 9 })).toBe('The 3rd of each month at 9:00 AM');
  });
});

describe('what the routine notices', () => {
  test('a newly promoted release is added and featured', () => {
    const plan = planSiteUpdate(content(), signals({
      releases: [{ id: 'low-tide', title: 'Low Tide', type: 'single', date: '2026-09-01' }],
    }), TODAY);

    expect(plan.operations.filter(op => op.op === 'upsert-release')).toHaveLength(2);
    expect(plan.findings.map(f => f.kind)).toContain('missing-release');
    expect(plan.changes.join(' ')).toContain('Low Tide');
    // A routine must never touch design.
    expect(plan.changeClass).toBe('content-only');
  });

  test('an upcoming show is added, a past one is not', () => {
    const plan = planSiteUpdate(content(), signals({
      shows: [
        { id: 'denver', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' },
        { id: 'old', date: '2026-01-05', city: 'Austin', venue: 'Mohawk' },
      ],
    }), TODAY);

    const added = plan.operations.filter(op => op.op === 'upsert-show')
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ value: { city: 'Denver' } });
  });

  test('a release already on the site is not added twice', () => {
    const existing = content({
      releases: [{ id: 'low-tide', title: 'Low Tide', type: 'single', date: '2026-09-01', links: {} }],
    });
    const plan = planSiteUpdate(existing, signals({
      releases: [{ id: 'low-tide', title: 'Low Tide', type: 'single', date: '2026-09-01' }],
    }), TODAY);

    expect(plan.findings.some(f => f.kind === 'missing-release')).toBe(false);
  });

  test('a released song stops advertising a pre-save', () => {
    const existing = content({
      releases: [{
        id: 'low-tide',
        title: 'Low Tide',
        type: 'single',
        date: '2026-09-01',
        featured: true,
        links: { presave: 'https://presave.example.com/low-tide', spotify: 'https://open.spotify.com/x' },
      }],
    });
    const plan = planSiteUpdate(existing, signals(), TODAY);

    const fix = plan.operations.find(op => op.op === 'upsert-release');
    expect(fix).toBeDefined();
    if (fix?.op === 'upsert-release') {
      expect(fix.value.links.presave).toBeUndefined();
      // The real listen link must survive.
      expect(fix.value.links.spotify).toBe('https://open.spotify.com/x');
    }
    expect(plan.findings.map(f => f.kind)).toContain('stale-presave');
  });

  test('an unreleased song keeps its pre-save', () => {
    const existing = content({
      releases: [{
        id: 'future',
        title: 'Future',
        type: 'single',
        date: '2026-12-01',
        links: { presave: 'https://presave.example.com/future' },
      }],
    });
    const plan = planSiteUpdate(existing, signals(), TODAY);
    expect(plan.findings.some(f => f.kind === 'stale-presave')).toBe(false);
  });

  test('the hero moves to the newest released song', () => {
    const existing = content({
      releases: [
        { id: 'old', title: 'Old One', type: 'single', date: '2025-01-01', featured: true, links: {} },
        { id: 'new', title: 'New One', type: 'single', date: '2026-08-01', links: {} },
      ],
    });
    const plan = planSiteUpdate(existing, signals(), TODAY);

    const applied = applySiteContentOperations(existing, plan.operations).content;
    expect(applied.releases.find(r => r.id === 'new')?.featured).toBe(true);
    expect(applied.releases.find(r => r.id === 'old')?.featured).toBe(false);
    expect(plan.findings.map(f => f.kind)).toContain('stale-hero');
  });

  test('an unreleased song never takes the hero from a released one', () => {
    const existing = content({
      releases: [
        { id: 'out', title: 'Out Now', type: 'single', date: '2026-08-01', featured: true, links: {} },
        { id: 'soon', title: 'Coming Soon', type: 'single', date: '2026-12-01', links: {} },
      ],
    });
    const plan = planSiteUpdate(existing, signals(), TODAY);
    expect(plan.findings.some(f => f.kind === 'stale-hero')).toBe(false);
  });

  test('a quiet nothing-to-do run produces no operations', () => {
    const existing = content({
      releases: [{ id: 'out', title: 'Out', type: 'single', date: '2026-08-01', featured: true, links: {} }],
      shows: [{ id: 'denver', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }],
    });
    const plan = planSiteUpdate(existing, signals({
      releases: [{ id: 'out', title: 'Out', type: 'single', date: '2026-08-01' }],
      shows: [{ id: 'denver', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }],
    }), TODAY);

    expect(plan.operations).toHaveLength(0);
    expect(plan.changes).toHaveLength(0);
  });
});

describe('what the routine mentions but will not touch', () => {
  test('a low search score is reported, not fixed', () => {
    const plan = planSiteUpdate(content(), signals({ auditScore: 55 }), TODAY);
    const finding = plan.findings.find(f => f.kind === 'low-seo')!;
    expect(finding.actionable).toBe(false);
    expect(finding.detail).toContain('55');
  });

  test('a door nobody walks through is flagged after a month', () => {
    const base = content();
    const withDoor = { ...base, signup: { ...base.signup, enabled: true } };

    const quiet = planSiteUpdate(withDoor, signals({ lastSignupAt: '2026-07-01' }), TODAY);
    expect(quiet.findings.some(f => f.kind === 'quiet-door')).toBe(true);

    const busy = planSiteUpdate(withDoor, signals({ lastSignupAt: '2026-09-10' }), TODAY);
    expect(busy.findings.some(f => f.kind === 'quiet-door')).toBe(false);
  });

  test('a site with no signup door is never nagged about signups', () => {
    // Signup stays off until a capture backend exists, so this is the
    // default state and must stay quiet.
    const plan = planSiteUpdate(content(), signals({ lastSignupAt: '2026-07-01' }), TODAY);
    expect(plan.findings.some(f => f.kind === 'quiet-door')).toBe(false);
  });

  test('posting on social while the site says nothing is flagged', () => {
    const plan = planSiteUpdate(content(), signals({ lastPostAt: '2026-09-12' }), TODAY);
    expect(plan.findings.some(f => f.kind === 'quiet-journal')).toBe(true);
  });

  test('an all-past show list is pointed out without deleting the archive', () => {
    const existing = content({
      shows: [{ id: 'old', date: '2026-01-05', city: 'Austin', venue: 'Mohawk' }],
    });
    const plan = planSiteUpdate(existing, signals(), TODAY);

    expect(plan.findings.some(f => f.kind === 'past-show')).toBe(true);
    expect(plan.operations.some(op => op.op === 'remove')).toBe(false);
  });
});

describe('the brief line', () => {
  test('reads differently when the change still needs a click', () => {
    expect(describeBrief({
      runId: 'r1',
      weekOf: TODAY,
      cadence: 'weekly',
      notes: [],
      site: { buildHash: 'h', changeClass: 'content-only', summary: 'Added the Denver show', auditScore: 92, tier: 'one-click' },
    })).toBe('Publish: Added the Denver show');

    expect(describeBrief({
      runId: 'r1',
      weekOf: TODAY,
      cadence: 'weekly',
      notes: [],
      site: { buildHash: 'h', changeClass: 'content-only', summary: 'Added the Denver show', auditScore: 92, tier: 'trusted' },
    })).toBe('Published: Added the Denver show');
  });

  test('combines the site change and the new fans', () => {
    expect(describeBrief({
      runId: 'r1',
      weekOf: TODAY,
      cadence: 'weekly',
      notes: [],
      site: { buildHash: 'h', changeClass: 'content-only', summary: 'Added two shows', auditScore: 92, tier: 'one-click' },
      subscribers: { imported: 14, duplicates: 2, skippedSuppressed: 0 },
    })).toBe('Publish: Added two shows · 14 new fans from the site');
  });

  test('a quiet run says so plainly', () => {
    expect(describeBrief({ runId: 'r1', weekOf: TODAY, cadence: 'monthly', notes: [], nothingToDo: true }))
      .toBe('Nothing needed on the site this time.');
  });

  test('with no action it leads with what it noticed', () => {
    expect(describeBrief({
      runId: 'r1',
      weekOf: TODAY,
      cadence: 'weekly',
      notes: ['Search readiness is 55 out of 100'],
    })).toBe('Search readiness is 55 out of 100');
  });
});
