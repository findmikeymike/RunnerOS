import { describe, expect, test } from 'bun:test';
import {
  artistCalendarMetadata,
  attachPersonToCalendarEvent,
  calendarEventsForWorkspace,
  calendarNeedsGoogleSync,
  createCalendarEvent,
  linkCalendarEventToWorkspace,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  shouldAutoSyncGoogleCalendar,
  unlinkCalendarEventFromWorkspace,
  type ArtistCalendar,
  type ArtistCalendarEvent,
} from './calendar.ts';
import {
  NETWORK_CATEGORIES,
  createNetworkCategory,
  createNetworkPerson,
  linkNetworkPersonToWorkspace,
  networkPeopleForWorkspace,
  parseArtistNetworkDocResult,
  updateNetworkPerson,
} from './network.ts';

const json = (record: unknown) => JSON.stringify(record);
const doc = (body: string) => ({ body });

const EVENT_BASE = {
  id: 'e1',
  date: '2026-08-01',
  title: 'Release day',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('artist calendar', () => {
  test('an absent doc yields an empty calendar without error', () => {
    const result = parseArtistCalendarDocResult(undefined);
    expect(result.ok).toBe(true);
    expect(result.calendar.events).toEqual([]);
  });

  test('rejects a wrong version or a non-array events field', () => {
    expect(parseArtistCalendarDocResult(doc(json({ version: 2, events: [] }))).ok).toBe(false);
    expect(parseArtistCalendarDocResult(doc(json({ version: 1, events: 'no' }))).ok).toBe(false);
  });

  test('drops events missing an id, a title, or a valid ISO date', () => {
    const result = parseArtistCalendarDocResult(
      doc(
        json({
          version: 1,
          events: [
            EVENT_BASE,
            { id: 'e2', date: 'not-a-date', title: 'Dropped' },
            { id: 'e3', title: 'No date' },
            { date: '2026-08-02', title: 'No id' },
          ],
        }),
      ),
    );
    expect(result.calendar.events.map((event) => event.id)).toEqual(['e1']);
  });

  /**
   * The renderer original called `.replace()` on these values directly, so a
   * single mistyped field threw and discarded the whole calendar as malformed.
   * Losing every event because one `time` was a number is worse than losing the
   * field, so mistyped values are now dropped individually.
   */
  test('a mistyped field drops that field, not the whole calendar', () => {
    const result = parseArtistCalendarDocResult(
      doc(json({ version: 1, events: [{ ...EVENT_BASE, time: 5, notes: 7 }] })),
    );
    expect(result.ok).toBe(true);
    expect(result.calendar.events).toHaveLength(1);
    expect(result.calendar.events[0]?.time).toBeUndefined();
    expect(result.calendar.events[0]?.notes).toBeUndefined();
  });

  test('normalizes links and dedupes related person ids', () => {
    const result = parseArtistCalendarDocResult(
      doc(
        json({
          version: 1,
          events: [
            {
              ...EVENT_BASE,
              workspaceLinks: [{ workspaceId: ' ws-1 ' }, { workspaceId: '  ' }, 'junk'],
              relatedPersonIds: ['p1', 'p1', ' p2 ', '', 5],
            },
          ],
        }),
      ),
    );
    const event = result.calendar.events[0]!;
    expect(event.workspaceLinks.map((link) => link.workspaceId)).toEqual(['ws-1']);
    expect(event.relatedPersonIds).toEqual(['p1', 'p2']);
  });

  test('discards an unrecognized google sync status', () => {
    const result = parseArtistCalendarDocResult(
      doc(json({ version: 1, events: [{ ...EVENT_BASE, google: { syncStatus: 'nonsense' } }] })),
    );
    expect(result.calendar.events[0]?.google?.syncStatus).toBeUndefined();
  });

  test('serializes sorted by date then time', () => {
    const calendar: ArtistCalendar = {
      version: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
      events: [
        { ...EVENT_BASE, id: 'b', date: '2026-08-02', workspaceLinks: [], relatedPersonIds: [] },
        {
          ...EVENT_BASE,
          id: 'a',
          date: '2026-08-01',
          time: '18:00',
          workspaceLinks: [],
          relatedPersonIds: [],
        },
        {
          ...EVENT_BASE,
          id: 'c',
          date: '2026-08-01',
          time: '09:00',
          workspaceLinks: [],
          relatedPersonIds: [],
        },
      ],
    };
    const reparsed = parseArtistCalendarDocResult(doc(serializeArtistCalendarBody(calendar)));
    expect(reparsed.calendar.events.map((event) => event.id)).toEqual(['c', 'a', 'b']);
  });

  test('workspace links are one per workspace and removable', () => {
    const event = createCalendarEvent({ date: '2026-08-01', title: 'Show' });
    const linked = linkCalendarEventToWorkspace(event, { workspaceId: 'ws-1', role: 'owner' });
    const relinked = linkCalendarEventToWorkspace(linked, { workspaceId: 'ws-1', role: 'editor' });
    expect(relinked.workspaceLinks).toHaveLength(1);
    expect(relinked.workspaceLinks[0]?.role).toBe('editor');

    expect(calendarEventsForWorkspace([relinked], 'ws-1')).toHaveLength(1);
    expect(calendarEventsForWorkspace([relinked], 'ws-2')).toHaveLength(0);
    expect(unlinkCalendarEventFromWorkspace(relinked, 'ws-1').workspaceLinks).toEqual([]);
  });

  test('attaching a person twice does not duplicate it', () => {
    const event = createCalendarEvent({ date: '2026-08-01', title: 'Show' });
    const once = attachPersonToCalendarEvent(event, 'p1');
    expect(attachPersonToCalendarEvent(once, 'p1').relatedPersonIds).toEqual(['p1']);
  });

  test('a soft-deleted event still needs sync only while google holds a copy', () => {
    const base: ArtistCalendarEvent = {
      ...EVENT_BASE,
      workspaceLinks: [],
      relatedPersonIds: [],
      google: { eventId: 'g1', syncStatus: 'synced' },
    };
    expect(calendarNeedsGoogleSync([base])).toBe(false);
    expect(calendarNeedsGoogleSync([{ ...base, deletedAt: 'yesterday' }])).toBe(true);
    expect(calendarNeedsGoogleSync([{ ...base, deletedAt: 'yesterday', google: undefined }])).toBe(
      false,
    );
    expect(calendarNeedsGoogleSync([{ ...base, google: undefined }])).toBe(true);
  });

  test('auto-sync backs off harder when nothing is dirty', () => {
    const clean: ArtistCalendar = {
      version: 1,
      updatedAt: '2026-08-01T00:00:00.000Z',
      events: [
        {
          ...EVENT_BASE,
          workspaceLinks: [],
          relatedPersonIds: [],
          google: { eventId: 'g1', syncStatus: 'synced' },
        },
      ],
    };
    const now = 10_000_000_000;

    expect(shouldAutoSyncGoogleCalendar({ ...clean, events: [] }, null, now)).toBe(false);
    expect(shouldAutoSyncGoogleCalendar(clean, null, now)).toBe(true);
    // Clean: six-hour cooldown.
    expect(shouldAutoSyncGoogleCalendar(clean, now - 60_000, now)).toBe(false);
    expect(shouldAutoSyncGoogleCalendar(clean, now - 7 * 60 * 60 * 1000, now)).toBe(true);

    // Dirty: one-minute cooldown.
    const dirty: ArtistCalendar = {
      ...clean,
      events: [{ ...clean.events[0]!, google: undefined }],
    };
    expect(shouldAutoSyncGoogleCalendar(dirty, now - 61_000, now)).toBe(true);
    expect(shouldAutoSyncGoogleCalendar(dirty, now - 1_000, now)).toBe(false);
  });

  test('broadcasts to every agent', () => {
    expect(artistCalendarMetadata().routing).toEqual({ mode: 'broadcast' });
  });
});

describe('artist network', () => {
  test('rejects a wrong version or a non-array people field', () => {
    expect(parseArtistNetworkDocResult(doc(json({ version: 2, people: [] }))).ok).toBe(false);
    expect(parseArtistNetworkDocResult(doc(json({ version: 1, people: 'no' }))).ok).toBe(false);
  });

  test('drops people missing an id, name, category, or tags array', () => {
    const result = parseArtistNetworkDocResult(
      doc(
        json({
          version: 1,
          people: [
            { id: 'p1', name: 'Dana', category: 'key', tags: [] },
            { id: 'p2', name: 'No tags', category: 'music' },
            { name: 'No id', category: 'music', tags: [] },
          ],
        }),
      ),
    );
    expect(result.network.people.map((person) => person.id)).toEqual(['p1']);
  });

  test('an unrecognized relationship falls back to new', () => {
    const result = parseArtistNetworkDocResult(
      doc(
        json({
          version: 1,
          people: [{ id: 'p1', name: 'Dana', category: 'key', tags: [], relationship: 'nonsense' }],
        }),
      ),
    );
    expect(result.network.people[0]?.relationship).toBe('new');
  });

  test('built-in categories survive a doc that tries to override them', () => {
    const result = parseArtistNetworkDocResult(
      doc(
        json({
          version: 1,
          people: [],
          categories: [
            { id: 'Custom Cat', label: '  My   Cat ' },
            { id: 5, label: 'dropped' },
          ],
        }),
      ),
    );
    const ids = result.network.categories.map((category) => category.id);
    for (const builtin of NETWORK_CATEGORIES) expect(ids).toContain(builtin.id);
    expect(result.network.categories.find((c) => c.id === 'custom-cat')?.label).toBe('My Cat');
  });

  test('new categories slugify and disambiguate on collision', () => {
    const existing = [{ id: 'press', label: 'Press' }];
    expect(createNetworkCategory('Press & Media', existing).id).toBe('press-and-media');
    expect(createNetworkCategory('Press', existing).id).toBe('press-2');
    expect(createNetworkCategory('   ', existing)).toEqual({ id: 'category', label: 'Category' });
  });

  test('tags come from a comma list and links are one per workspace', () => {
    const person = createNetworkPerson({
      name: '  Dana Reed ',
      category: 'key',
      tags: 'manager, , press ',
    });
    expect(person.name).toBe('Dana Reed');
    expect(person.tags).toEqual(['manager', 'press']);
    expect(person.relationship).toBe('new');

    const linked = linkNetworkPersonToWorkspace(person, { workspaceId: 'ws-1', role: 'owner' });
    const relinked = linkNetworkPersonToWorkspace(linked, { workspaceId: 'ws-1', role: 'editor' });
    expect(relinked.workspaceLinks).toHaveLength(1);
    expect(networkPeopleForWorkspace([relinked], 'ws-1')).toHaveLength(1);
    expect(networkPeopleForWorkspace([relinked], 'ws-2')).toHaveLength(0);
  });

  test('updating a person keeps identity and creation time', () => {
    const person = createNetworkPerson({ name: 'Dana', category: 'key' });
    const updated = updateNetworkPerson(person, {
      name: 'Dana Reed',
      category: 'press',
      tags: 'a,b',
    });
    expect(updated.id).toBe(person.id);
    expect(updated.createdAt).toBe(person.createdAt);
    expect(updated.name).toBe('Dana Reed');
    expect(updated.category).toBe('press');
    expect(updated.tags).toEqual(['a', 'b']);
  });
});
