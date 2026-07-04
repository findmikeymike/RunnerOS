import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { getSourceCredentialManager, getSourcesBySlugs } from '@craft-agent/shared/sources'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { refreshHqStateContextDocBestEffort } from '../../hq-state/refresh'

const ARTIST_CALENDAR_CONTEXT_SLUG = 'artist-calendar'
const GOOGLE_CALENDAR_SOURCE_SLUG = 'google-calendar'

type SyncStatus = 'not-synced' | 'synced' | 'local-change' | 'remote-change' | 'conflict' | 'error'
type ParsedEventTime = { ok: true; time: string | null } | { ok: false; error: string }

interface GoogleCalendarSyncState {
  calendarId?: string
  eventId?: string
  htmlLink?: string
  etag?: string
  syncStatus?: SyncStatus
  lastSyncedAt?: string
  error?: string
}

interface ArtistCalendarEvent {
  id: string
  date: string
  title: string
  time?: string
  notes?: string
  workspaceLinks?: unknown[]
  relatedPersonIds?: unknown[]
  google?: GoogleCalendarSyncState
  deletedAt?: string
  createdAt?: string
  updatedAt?: string
}

interface ArtistCalendar {
  version: 1
  events: ArtistCalendarEvent[]
  updatedAt: string
}

export interface GoogleCalendarSyncResult {
  ok: boolean
  synced: number
  deleted: number
  failed: number
  error?: string
}

export interface GoogleCalendarStatusResult {
  ok: boolean
  connected: boolean
  error?: string
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.googleWorkspace.GET_CALENDAR_STATUS,
  RPC_CHANNELS.googleWorkspace.SYNC_CALENDAR,
] as const

function broadcastContextChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

export function registerGoogleWorkspaceHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.googleWorkspace.GET_CALENDAR_STATUS, async (_ctx, workspaceId: string): Promise<GoogleCalendarStatusResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { ok: false, connected: false, error: `Workspace not found: ${workspaceId}` }

    const [source] = getSourcesBySlugs(workspace.rootPath, [GOOGLE_CALENDAR_SOURCE_SLUG])
    if (!source) return { ok: false, connected: false, error: 'Google Calendar source is not installed.' }

    const credential = await getSourceCredentialManager().loadEffective(source)
    return { ok: true, connected: Boolean(credential?.value || credential?.refreshToken) }
  })

  server.handle(RPC_CHANNELS.googleWorkspace.SYNC_CALENDAR, async (_ctx, workspaceId: string): Promise<GoogleCalendarSyncResult> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { ok: false, synced: 0, deleted: 0, failed: 0, error: `Workspace not found: ${workspaceId}` }

    const [source] = getSourcesBySlugs(workspace.rootPath, [GOOGLE_CALENDAR_SOURCE_SLUG])
    if (!source) return { ok: false, synced: 0, deleted: 0, failed: 0, error: 'Google Calendar source is not installed.' }

    const credentialManager = getSourceCredentialManager()
    const token = await credentialManager.getToken(source) ?? await credentialManager.refresh(source)
    if (!token) return { ok: false, synced: 0, deleted: 0, failed: 0, error: 'Google Calendar is not connected yet.' }

    const doc = loadContextDoc(workspace.rootPath, ARTIST_CALENDAR_CONTEXT_SLUG)
    const parsed = parseArtistCalendar(doc)
    if (!parsed.ok) return { ok: false, synced: 0, deleted: 0, failed: 0, error: parsed.error }

    const calendarId = process.env.GOOGLE_WORKSPACE_PRIMARY_CALENDAR_ID?.trim() || 'primary'
    const now = new Date().toISOString()
    let synced = 0
    let deleted = 0
    let failed = 0

    const events = await Promise.all(parsed.calendar.events.map(async (event): Promise<ArtistCalendarEvent | null> => {
      if (event.deletedAt) {
        const eventId = event.google?.eventId?.trim()
        if (!eventId) {
          deleted += 1
          return null
        }
        try {
          await deleteGoogleEvent({
            token,
            calendarId: event.google?.calendarId?.trim() || calendarId,
            eventId,
          })
          deleted += 1
          return null
        } catch (error) {
          failed += 1
          return {
            ...event,
            google: {
              ...(event.google ?? {}),
              calendarId: event.google?.calendarId?.trim() || calendarId,
              syncStatus: 'error' as const,
              lastSyncedAt: now,
              error: error instanceof Error ? error.message : String(error),
            },
            updatedAt: now,
          }
        }
      }

      try {
        const google = await upsertGoogleEvent({ token, calendarId, event })
        synced += 1
        return {
          ...event,
          google: {
            calendarId,
            eventId: google.id,
            htmlLink: google.htmlLink,
            etag: google.etag,
            syncStatus: 'synced' as const,
            lastSyncedAt: now,
          },
          updatedAt: now,
        }
      } catch (error) {
        failed += 1
        return {
          ...event,
          google: {
            ...(event.google ?? {}),
            calendarId,
            syncStatus: 'error' as const,
            lastSyncedAt: now,
            error: error instanceof Error ? error.message : String(error),
          },
          updatedAt: now,
        }
      }
    }))

    const nextCalendar: ArtistCalendar = {
      version: 1,
      events: events.filter((event): event is ArtistCalendarEvent => event !== null),
      updatedAt: now,
    }

    upsertContextDoc(workspace.rootPath, {
      slug: ARTIST_CALENDAR_CONTEXT_SLUG,
      metadata: {
        name: 'Artist Calendar',
        description: 'Global dates, deadlines, meetings, releases, and reminders for the artist.',
        routing: { mode: 'broadcast' },
        enabled: true,
      },
      body: serializeArtistCalendar(nextCalendar),
    })
    refreshHqStateContextDocBestEffort(workspace.rootPath)
    broadcastContextChanged(deps, workspaceId, loadAllContextDocs(workspace.rootPath))

    return { ok: failed === 0, synced, deleted, failed, ...(failed > 0 ? { error: `${failed} event${failed === 1 ? '' : 's'} failed to sync.` } : {}) }
  })
}

async function upsertGoogleEvent(args: {
  token: string
  calendarId: string
  event: ArtistCalendarEvent
}): Promise<{ id: string; htmlLink?: string; etag?: string }> {
  const { token, calendarId, event } = args
  const eventId = event.google?.eventId?.trim()
  const url = eventId
    ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
    : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  const response = await fetch(url, {
    method: eventId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(toGoogleEventPayload(event)),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google Calendar returned ${response.status}: ${text.slice(0, 240)}`)
  }

  const json = await response.json() as { id?: unknown; htmlLink?: unknown; etag?: unknown }
  if (typeof json.id !== 'string' || !json.id) throw new Error('Google Calendar response did not include an event ID.')
  return {
    id: json.id,
    htmlLink: typeof json.htmlLink === 'string' ? json.htmlLink : undefined,
    etag: typeof json.etag === 'string' ? json.etag : undefined,
  }
}

async function deleteGoogleEvent(args: {
  token: string
  calendarId: string
  eventId: string
}): Promise<void> {
  const { token, calendarId, eventId } = args
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  if (response.status === 404 || response.status === 410) return
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Google Calendar delete returned ${response.status}: ${text.slice(0, 240)}`)
  }
}

function toGoogleEventPayload(event: ArtistCalendarEvent): Record<string, unknown> {
  const parsedTime = parseTime(event.time)
  if (!parsedTime.ok) throw new Error(`Invalid time for "${event.title}": ${parsedTime.error}`)
  const description = [event.notes, `RunnerOS event ID: ${event.id}`].filter(Boolean).join('\n\n')
  if (!parsedTime.time) {
    return {
      summary: event.title,
      description,
      start: { date: event.date },
      end: { date: addDays(event.date, 1) },
      extendedProperties: { private: { runnerosEventId: event.id } },
    }
  }

  const start = new Date(`${event.date}T${parsedTime.time}:00`)
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    summary: event.title,
    description,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    extendedProperties: { private: { runnerosEventId: event.id } },
  }
}

function parseArtistCalendar(doc: LoadedContextDoc | null): { ok: true; calendar: ArtistCalendar } | { ok: false; error: string } {
  if (!doc?.body.trim()) {
    return { ok: true, calendar: { version: 1, events: [], updatedAt: new Date().toISOString() } }
  }
  const json = extractJson(doc.body)
  if (!json) return { ok: false, error: 'Artist Calendar exists, but no JSON block could be read.' }
  try {
    const parsed = JSON.parse(json) as Partial<ArtistCalendar>
    if (parsed.version !== 1 || !Array.isArray(parsed.events)) {
      return { ok: false, error: 'Artist Calendar JSON has an unsupported shape.' }
    }
    return {
      ok: true,
      calendar: {
        version: 1,
        events: parsed.events.filter(isCalendarEvent),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      },
    }
  } catch {
    return { ok: false, error: 'Artist Calendar JSON is malformed.' }
  }
}

function serializeArtistCalendar(calendar: ArtistCalendar): string {
  return [
    'This is global artist calendar context. Treat it as long-term creator context, not one-campaign context.',
    '',
    '```json',
    JSON.stringify({
      version: 1,
      events: [...calendar.events].sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`)),
      updatedAt: calendar.updatedAt,
    }, null, 2),
    '```',
  ].join('\n')
}

function extractJson(body: string): string | null {
  const fenced = body.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1]
  const firstBrace = body.indexOf('{')
  const lastBrace = body.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace <= firstBrace) return null
  return body.slice(firstBrace, lastBrace + 1)
}

function isCalendarEvent(value: unknown): value is ArtistCalendarEvent {
  const candidate = value as Partial<ArtistCalendarEvent>
  return Boolean(
    typeof candidate.id === 'string'
    && typeof candidate.date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date)
    && typeof candidate.title === 'string'
    && candidate.title.trim(),
  )
}

function parseTime(value: string | undefined): ParsedEventTime {
  const raw = value?.trim()
  if (!raw) return { ok: true, time: null }
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ')
  if (normalized === 'noon') return { ok: true, time: '12:00' }
  if (normalized === 'midnight') return { ok: true, time: '00:00' }

  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (!match) return { ok: false, error: `"${raw}" is not a supported time. Try 9am, 9:30am, 14:00, noon, or leave it blank for all-day.` }
  let hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  const meridiem = match[3]?.toLowerCase()
  if (minute > 59) return { ok: false, error: `"${raw}" has invalid minutes.` }
  if (meridiem && (hour < 1 || hour > 12)) return { ok: false, error: `"${raw}" must use 1-12 with am/pm.` }
  if (!meridiem && hour > 23) return { ok: false, error: `"${raw}" must use 0-23 without am/pm.` }
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  return { ok: true, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
