/**
 * Renderer view of the Artist Calendar context doc.
 * Schema, parsing, and the event/sync helpers live in
 * `@craft-agent/shared/artist-context` so server-side tools read the same
 * format. Re-exported here to keep the `@/lib/artist-*` import convention.
 */
export {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  artistCalendarMetadata,
  attachPersonToCalendarEvent,
  calendarEventsForWorkspace,
  calendarNeedsGoogleSync,
  createCalendarEvent,
  emptyArtistCalendar,
  linkCalendarEventToWorkspace,
  parseArtistCalendarDocResult,
  serializeArtistCalendarBody,
  shouldAutoSyncGoogleCalendar,
  unlinkCalendarEventFromWorkspace,
  type ArtistCalendar,
  type ArtistCalendarEvent,
  type ArtistCalendarParseResult,
  type ArtistWorkspaceLink,
  type GoogleCalendarSyncState,
} from '@craft-agent/shared/artist-context'
