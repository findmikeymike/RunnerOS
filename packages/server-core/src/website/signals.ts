import {
  emptySignals,
  loadWebsiteManifest,
  type CalendarSignal,
  type PostedContentSignal,
  type ReleaseSignal,
  type RoutineSignals,
} from '@craft-agent/shared/website'
import type { TimelineEntry } from '@craft-agent/shared/hq-state'
import { collectArtistTimeline } from '../hq-state/timeline-collector'
import { readXEditorialHistory } from '../x-editorial/history'

/** How far ahead the routine looks for releases and calendar entries. */
const HORIZON_DAYS = 180
/** How far back it looks for posts the site might not have. */
const POSTED_LOOKBACK_DAYS = 30

const ALBUM_HINT = /\b(album|lp)\b/i
const EP_HINT = /\bep\b/i

function releaseTypeFor(title: string): ReleaseSignal['type'] {
  if (ALBUM_HINT.test(title)) return 'album'
  if (EP_HINT.test(title)) return 'ep'
  return 'single'
}

function cleanTitle(title: string): string {
  return title.replace(/\s*\b(release|out now|drops?)\b\s*$/i, '').trim()
}

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Sort timeline entries into what the site cares about.
 *
 * Shows are deliberately absent. A calendar title does not reliably carry a
 * city and a venue, and a wrong venue on a public site is worse than no
 * venue, so shows come from the artist handing over a list. Upcoming entries
 * are still counted, but only so the agent can notice the site lists no shows
 * and ask for them.
 */
export function mapTimelineEntries(entries: TimelineEntry[]): {
  releases: ReleaseSignal[]
  upcomingEvents: CalendarSignal[]
} {
  const releases: ReleaseSignal[] = []
  const upcomingEvents: CalendarSignal[] = []

  for (const entry of entries) {
    if (entry.category === 'release') {
      const title = cleanTitle(entry.title)
      releases.push({
        id: entry.id,
        title: title || entry.title,
        type: releaseTypeFor(entry.title),
        date: entry.date,
      })
      continue
    }
    if (entry.category === 'event') {
      upcomingEvents.push({ id: entry.id, date: entry.date, title: entry.title })
    }
  }

  return { releases, upcomingEvents }
}

interface XCandidateLike {
  id?: string
  text?: string
  status?: string
  postedAt?: string
}

/**
 * Posts the artist already published, so the site can carry them as updates.
 *
 * Only candidates with a verified publication receipt count: a scheduled or
 * approved post has not happened yet, and putting it on the site early would
 * announce something the artist has not said.
 */
export function mapPostedContent(
  candidates: XCandidateLike[],
  since: string,
): PostedContentSignal[] {
  return candidates.flatMap<PostedContentSignal>(candidate => {
    if (candidate.status !== 'posted') return []
    const postedAt = candidate.postedAt
    if (!postedAt || postedAt.slice(0, 10) < since) return []
    const text = candidate.text?.trim()
    if (!text || !candidate.id) return []
    return [{ id: candidate.id, postedAt, text, platform: 'x' }]
  })
}

/**
 * Gather what the routine should know about.
 *
 * A missing HQ is not an error: the routine still runs and reports on what
 * the site already has.
 */
export function collectRoutineSignals(
  workspaceRootPath: string,
  workspaceId: string,
  now = new Date(),
): RoutineSignals {
  const manifest = loadWebsiteManifest(workspaceRootPath)
  const base: RoutineSignals = {
    ...emptySignals(),
    auditScore: manifest?.lastBuild?.auditScore,
  }

  try {
    const timeline = collectArtistTimeline({
      from: now.toISOString().slice(0, 10),
      to: addDays(now, HORIZON_DAYS),
      limit: 60,
    }, now)
    Object.assign(base, mapTimelineEntries(timeline.entries))
  } catch {
    // No HQ, or the timeline could not be read.
  }

  base.posted = collectPostedContent(workspaceRootPath, workspaceId, addDays(now, -POSTED_LOOKBACK_DAYS))
  return base
}

/**
 * Read published X slates for posts the site does not have yet.
 *
 * Best effort: this is a convenience, so an unreadable slate must not stop
 * the rest of the routine.
 */
function collectPostedContent(
  workspaceRootPath: string,
  workspaceId: string,
  since: string,
): PostedContentSignal[] {
  try {
    const history = readXEditorialHistory(workspaceRootPath, workspaceId, 8)
    return history.slates.flatMap(slate => mapPostedContent(slate.candidates ?? [], since))
  } catch {
    return []
  }
}
