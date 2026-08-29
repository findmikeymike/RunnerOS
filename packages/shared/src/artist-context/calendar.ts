import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import { buildContextDocBody, extractJsonBlock } from './json-block.ts';
import { isIsoDateString, normalizeInlineText } from './text.ts';
import {
  normalizeGoogleSyncStatus,
  normalizeIds,
  normalizeWorkspaceLinks,
  upsertWorkspaceLink,
  type ArtistWorkspaceLink,
  type GoogleSyncStatus,
} from './workspace-link.ts';

export const ARTIST_CALENDAR_CONTEXT_SLUG = 'artist-calendar';

const CALENDAR_PREAMBLE = [
  'This is global artist calendar context. Treat it as long-term creator context, not one-campaign context.',
];

export type { ArtistWorkspaceLink };

export interface GoogleCalendarSyncState {
  calendarId?: string;
  eventId?: string;
  htmlLink?: string;
  etag?: string;
  syncStatus?: GoogleSyncStatus;
  lastSyncedAt?: string;
  error?: string;
}

export interface ArtistCalendarEvent {
  id: string;
  date: string;
  title: string;
  time?: string;
  notes?: string;
  workspaceLinks: ArtistWorkspaceLink[];
  relatedPersonIds: string[];
  scheduledWorkId?: string;
  google?: GoogleCalendarSyncState;
  /** Soft delete: the event stays so a pending Google deletion can still be pushed. */
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtistCalendar {
  version: 1;
  events: ArtistCalendarEvent[];
  updatedAt: string;
}

export type ArtistCalendarParseResult =
  | { ok: true; calendar: ArtistCalendar }
  | { ok: false; calendar: ArtistCalendar; error: string };

export function artistCalendarMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Calendar',
    description: 'Global dates, deadlines, meetings, releases, and reminders for the artist.',
    routing: { mode: 'broadcast' },
    enabled: true,
  };
}

export function emptyArtistCalendar(): ArtistCalendar {
  return { version: 1, events: [], updatedAt: new Date().toISOString() };
}

export function parseArtistCalendarDocResult(
  doc: Pick<LoadedContextDoc, 'body'> | undefined,
): ArtistCalendarParseResult {
  if (!doc?.body.trim()) return { ok: true, calendar: emptyArtistCalendar() };

  const json = extractJsonBlock(doc.body);
  if (!json) {
    return {
      ok: false,
      calendar: emptyArtistCalendar(),
      error: 'Artist Calendar exists, but no JSON block could be read.',
    };
  }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistCalendar>;
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) {
      return {
        ok: false,
        calendar: emptyArtistCalendar(),
        error: 'Artist Calendar JSON has an unsupported shape.',
      };
    }
    const updatedAt = parsed.updatedAt;
    if (!isIsoTimestamp(updatedAt)) {
      return {
        ok: false,
        calendar: { version: 1, events: [], updatedAt: '1970-01-01T00:00:00.000Z' },
        error: 'Artist Calendar updatedAt is missing or invalid.',
      };
    }
    return {
      ok: true,
      calendar: {
        version: 1,
        events: parsed.events
          .filter(isCalendarEvent)
          .map((event) => normalizeCalendarEvent(event, updatedAt)),
        updatedAt,
      },
    };
  } catch {
    return {
      ok: false,
      calendar: emptyArtistCalendar(),
      error: 'Artist Calendar JSON is malformed.',
    };
  }
}

export function serializeArtistCalendarBody(calendar: ArtistCalendar): string {
  return buildContextDocBody(CALENDAR_PREAMBLE, {
    version: 1,
    events: [...calendar.events].sort((left, right) =>
      `${left.date} ${left.time ?? ''}`.localeCompare(`${right.date} ${right.time ?? ''}`),
    ),
    updatedAt: new Date().toISOString(),
  });
}

export function createCalendarEvent(input: {
  date: string;
  title: string;
  time?: string;
  notes?: string;
  workspaceLink?: Omit<ArtistWorkspaceLink, 'linkedAt'>;
  relatedPersonIds?: string[];
}): ArtistCalendarEvent {
  const now = new Date().toISOString();
  return {
    id: `event-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: input.date,
    title: input.title.trim(),
    time: normalizeInlineText(input.time),
    notes: normalizeInlineText(input.notes),
    workspaceLinks: input.workspaceLink
      ? normalizeWorkspaceLinks([{ ...input.workspaceLink, linkedAt: now }])
      : [],
    relatedPersonIds: normalizeIds(input.relatedPersonIds),
    createdAt: now,
    updatedAt: now,
  };
}

export function linkCalendarEventToWorkspace(
  event: ArtistCalendarEvent,
  link: Omit<ArtistWorkspaceLink, 'linkedAt'>,
): ArtistCalendarEvent {
  return {
    ...event,
    workspaceLinks: upsertWorkspaceLink(event.workspaceLinks, link),
    updatedAt: new Date().toISOString(),
  };
}

export function unlinkCalendarEventFromWorkspace(
  event: ArtistCalendarEvent,
  workspaceId: string,
): ArtistCalendarEvent {
  return {
    ...event,
    workspaceLinks: event.workspaceLinks.filter((link) => link.workspaceId !== workspaceId),
    updatedAt: new Date().toISOString(),
  };
}

export function calendarEventsForWorkspace(
  events: ArtistCalendarEvent[],
  workspaceId: string,
): ArtistCalendarEvent[] {
  return events.filter((event) =>
    event.workspaceLinks.some((link) => link.workspaceId === workspaceId),
  );
}

/** A soft-deleted event still needs sync if Google is holding a copy of it. */
export function calendarNeedsGoogleSync(events: ArtistCalendarEvent[]): boolean {
  return events.some((event) => {
    if (event.deletedAt) return Boolean(event.google?.eventId);
    if (!event.google?.eventId) return true;
    return event.google.syncStatus !== 'synced';
  });
}

/** Dirty calendars retry after a minute; clean ones poll every six hours. */
export function shouldAutoSyncGoogleCalendar(
  calendar: ArtistCalendar,
  lastAttemptAt: number | null,
  now = Date.now(),
): boolean {
  if (calendar.events.length === 0) return false;
  const cooldown = calendarNeedsGoogleSync(calendar.events) ? 60_000 : 6 * 60 * 60 * 1000;
  return !lastAttemptAt || now - lastAttemptAt >= cooldown;
}

export function attachPersonToCalendarEvent(
  event: ArtistCalendarEvent,
  personId: string,
): ArtistCalendarEvent {
  return {
    ...event,
    relatedPersonIds: normalizeIds([...event.relatedPersonIds, personId]),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeCalendarEvent(event: ArtistCalendarEvent, fallbackTimestamp: string): ArtistCalendarEvent {
  return {
    ...event,
    title: event.title.trim(),
    time: normalizeInlineText(event.time),
    notes: normalizeInlineText(event.notes),
    workspaceLinks: normalizeWorkspaceLinks(event.workspaceLinks),
    relatedPersonIds: normalizeIds(event.relatedPersonIds),
    google: normalizeGoogleSync(event.google),
    deletedAt: normalizeInlineText(event.deletedAt),
    updatedAt: isIsoTimestamp(event.updatedAt) ? event.updatedAt : fallbackTimestamp,
    createdAt: isIsoTimestamp(event.createdAt) ? event.createdAt : fallbackTimestamp,
  };
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

function normalizeGoogleSync(value: unknown): GoogleCalendarSyncState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as GoogleCalendarSyncState;
  return {
    calendarId: normalizeInlineText(candidate.calendarId),
    eventId: normalizeInlineText(candidate.eventId),
    htmlLink: normalizeInlineText(candidate.htmlLink),
    etag: normalizeInlineText(candidate.etag),
    syncStatus: normalizeGoogleSyncStatus(candidate.syncStatus),
    lastSyncedAt: normalizeInlineText(candidate.lastSyncedAt),
    error: normalizeInlineText(candidate.error),
  };
}

/** An event needs an id, an ISO date, and a title to be addressable at all. */
function isCalendarEvent(value: unknown): value is ArtistCalendarEvent {
  const candidate = value as Partial<ArtistCalendarEvent>;
  return (
    typeof candidate.id === 'string'
    && typeof candidate.date === 'string'
    && isIsoDateString(candidate.date)
    && typeof candidate.title === 'string'
  );
}
