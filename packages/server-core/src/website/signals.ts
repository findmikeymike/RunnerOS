import { loadWebsiteManifest, type ReleaseSignal, type RoutineSignals, type ShowSignal } from '@craft-agent/shared/website'
import type { TimelineEntry } from '@craft-agent/shared/hq-state'
import { collectArtistTimeline } from '../hq-state/timeline-collector'

/** How far ahead the routine looks for shows and releases. */
const HORIZON_DAYS = 180

export interface CollectedSignals extends RoutineSignals {
  /**
   * Calendar events that read like shows but carry no city and venue.
   *
   * Reported rather than guessed at: putting the wrong venue on a public
   * site is worse than leaving it off and telling the artist.
   */
  unmappedEvents: Array<{ id: string; date: string; title: string }>
}

/** "Denver — Bluebird Theater", "Denver - Bluebird", "Denver, Bluebird". */
const SHOW_TITLE = /^\s*(?<city>[^—\-,|]{2,60}?)\s*[—\-,|]\s*(?<venue>.{2,80}?)\s*$/u

/**
 * Words that make a calendar event look like a show even when the title is
 * not in a shape we can split into city and venue.
 */
const SHOW_HINT = /\b(show|gig|live|tour|set|concert|festival|opening for|residency)\b/i

const ALBUM_HINT = /\b(album|lp)\b/i
const EP_HINT = /\bep\b/i

function releaseTypeFor(title: string): ReleaseSignal['type'] {
  if (ALBUM_HINT.test(title)) return 'album'
  if (EP_HINT.test(title)) return 'ep'
  return 'single'
}

/** Strip the decoration a calendar title picks up: "Show: ", " (sold out)". */
function cleanTitle(title: string): string {
  return title
    .replace(/^\s*(show|gig|live|concert)\s*[:\-—]\s*/i, '')
    .replace(/\s*\((?:sold out|cancelled|canceled|postponed)\)\s*$/i, '')
    .trim()
}

function toShow(entry: TimelineEntry): ShowSignal | null {
  const match = SHOW_TITLE.exec(cleanTitle(entry.title))
  const city = match?.groups?.city?.trim()
  const venue = match?.groups?.venue?.trim()
  if (!city || !venue) return null
  return {
    id: entry.id,
    date: entry.date,
    city,
    venue,
    calendarEventId: entry.id,
  }
}

function toRelease(entry: TimelineEntry): ReleaseSignal {
  const title = cleanTitle(entry.title).replace(/\s*\b(release|out now|drops?)\b\s*$/i, '').trim()
  return {
    id: entry.id,
    title: title || entry.title,
    type: releaseTypeFor(entry.title),
    date: entry.date,
  }
}

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Gather what the routine should know about, from the artist timeline.
 *
 * The timeline already merges HQ events, campaign items, release dates, and
 * scheduled work into one dated list, so this reads one source rather than
 * stitching several. Anything it cannot map confidently is reported, never
 * guessed.
 */
export function collectRoutineSignals(
  workspaceRootPath: string,
  now = new Date(),
): CollectedSignals {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  const base: CollectedSignals = {
    releases: [],
    shows: [],
    auditScore: manifest?.lastBuild?.auditScore,
    unmappedEvents: [],
  }

  let entries: TimelineEntry[]
  try {
    const timeline = collectArtistTimeline({
      from: now.toISOString().slice(0, 10),
      to: addDays(now, HORIZON_DAYS),
      limit: 60,
    }, now)
    entries = timeline.entries
  } catch {
    // No HQ, or the timeline could not be read. The routine still runs and
    // reports on what the site already has.
    return base
  }

  return { ...base, ...mapTimelineEntries(entries) }
}

/**
 * Sort timeline entries into releases, shows, and things that look like
 * shows but cannot be mapped. Pure, so the title heuristics are testable.
 */
export function mapTimelineEntries(entries: TimelineEntry[]): {
  releases: ReleaseSignal[]
  shows: ShowSignal[]
  unmappedEvents: Array<{ id: string; date: string; title: string }>
} {
  const releases: ReleaseSignal[] = []
  const shows: ShowSignal[] = []
  const unmappedEvents: Array<{ id: string; date: string; title: string }> = []

  for (const entry of entries) {
    if (entry.category === 'release') {
      releases.push(toRelease(entry))
      continue
    }
    if (entry.category !== 'event') continue

    const show = toShow(entry)
    if (show) shows.push(show)
    else if (SHOW_HINT.test(entry.title)) {
      unmappedEvents.push({ id: entry.id, date: entry.date, title: entry.title })
    }
  }

  return { releases, shows, unmappedEvents }
}
