/**
 * The site routine (spec 41 Slice B).
 *
 * Two very different jobs live here, and keeping them apart is the point.
 *
 * On a schedule the routine does only the direct, obvious work: pull in
 * anyone who signed up, and offer to put content already posted to socials
 * on the site. It does not infer shows, invent releases, or reshuffle the
 * home page on its own.
 *
 * Everything else is an *observation* — something worth saying to the artist
 * in conversation ("the pre-save is still up and the song is out", "you are a
 * week from release, want the final audio behind an email catcher"). The
 * artist decides. Observations never become edits without being asked.
 *
 * Cadence is the artist's choice, not a fixed Monday.
 */

import type {
  ChangeClass,
  SiteContent,
  SiteContentOperation,
  SiteRelease,
} from './types.ts';

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export type RoutineCadence = 'weekly' | 'monthly' | 'manual';

export interface WebsiteRoutineConfig {
  cadence: RoutineCadence;
  /** 0 = Sunday. Weekly only. Defaults to Monday. */
  dayOfWeek?: number;
  /** 1-28. Monthly only, capped so every month has the day. */
  dayOfMonth?: number;
  /** Local hour, 0-23. */
  hour?: number;
  timezone?: string;
  lastRunAt?: string;
  /** Automation identity, so the routine can be paused or removed later. */
  automation?: { event: string; matcherIndex: number };
}

export const DEFAULT_ROUTINE: WebsiteRoutineConfig = {
  cadence: 'manual',
  dayOfWeek: 1,
  dayOfMonth: 1,
  hour: 9,
};

function clampHour(hour: number | undefined): number {
  if (!Number.isFinite(hour)) return 9;
  return Math.min(23, Math.max(0, Math.trunc(hour!)));
}

/**
 * Cron for the configured cadence, or null when the artist runs it by hand.
 *
 * Monthly is capped at day 28 so a routine set for the 30th still fires in
 * February instead of silently skipping a month.
 */
export function cronForRoutine(config: WebsiteRoutineConfig): string | null {
  const hour = clampHour(config.hour);
  if (config.cadence === 'weekly') {
    const day = Number.isFinite(config.dayOfWeek) ? Math.min(6, Math.max(0, Math.trunc(config.dayOfWeek!))) : 1;
    return `0 ${hour} * * ${day}`;
  }
  if (config.cadence === 'monthly') {
    const day = Number.isFinite(config.dayOfMonth) ? Math.min(28, Math.max(1, Math.trunc(config.dayOfMonth!))) : 1;
    return `0 ${hour} ${day} * *`;
  }
  return null;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(value: number): string {
  const suffix = value % 10 === 1 && value !== 11 ? 'st'
    : value % 10 === 2 && value !== 12 ? 'nd'
      : value % 10 === 3 && value !== 13 ? 'rd'
        : 'th';
  return `${value}${suffix}`;
}

function clockLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${period}`;
}

/** One plain line for the settings row. */
export function describeCadence(config: WebsiteRoutineConfig): string {
  const hour = clampHour(config.hour);
  if (config.cadence === 'manual') return 'Only when you ask';
  if (config.cadence === 'weekly') {
    const day = Number.isFinite(config.dayOfWeek) ? Math.min(6, Math.max(0, Math.trunc(config.dayOfWeek!))) : 1;
    return `Every ${DAY_NAMES[day]} at ${clockLabel(hour)}`;
  }
  const day = Number.isFinite(config.dayOfMonth) ? Math.min(28, Math.max(1, Math.trunc(config.dayOfMonth!))) : 1;
  return `The ${ordinal(day)} of each month at ${clockLabel(hour)}`;
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/** A release the HQ knows about. Read for context, never auto-published. */
export interface ReleaseSignal {
  id: string;
  title: string;
  type: SiteRelease['type'];
  date: string;
}

/** Something the artist already posted publicly, with a link back to it. */
export interface PostedContentSignal {
  id: string;
  postedAt: string;
  text: string;
  url?: string;
  platform: string;
}

/** A dated calendar entry that may or may not be a show. Never parsed. */
export interface CalendarSignal {
  id: string;
  date: string;
  title: string;
}

export interface RoutineSignals {
  /** Releases known to HQ, for observations about timing. */
  releases: ReleaseSignal[];
  /** Posted social content the site could carry as an update. */
  posted: PostedContentSignal[];
  /** Upcoming calendar entries, used only to notice the site has no shows. */
  upcomingEvents: CalendarSignal[];
  auditScore?: number;
  lastSignupAt?: string;
}

export function emptySignals(): RoutineSignals {
  return { releases: [], posted: [], upcomingEvents: [] };
}

// ---------------------------------------------------------------------------
// The scheduled plan: direct and obvious only
// ---------------------------------------------------------------------------

export interface ScheduledPlan {
  operations: SiteContentOperation[];
  changes: string[];
  why: string[];
  changeClass: ChangeClass;
}

/** Journal ids are derived from the post, so a rerun updates instead of duplicating. */
function journalIdFor(post: PostedContentSignal): string {
  return `post-${post.platform}-${post.id}`;
}

/** First sentence or first 70 characters, whichever comes first. */
function headlineFor(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentence = /^(.{10,70}?)[.!?](\s|$)/.exec(clean);
  if (sentence) return sentence[1]!.trim();
  return clean.length > 70 ? `${clean.slice(0, 67).trimEnd()}…` : clean;
}

/**
 * What the scheduled run may do without asking.
 *
 * Only one thing: carry content the artist already published on socials over
 * to their own site as an update. Nothing here invents a fact about the
 * artist, and the result still needs a publish approval before it is public.
 */
export function planScheduledUpdate(
  content: SiteContent,
  signals: RoutineSignals,
  today: string,
): ScheduledPlan {
  const operations: SiteContentOperation[] = [];
  const changes: string[] = [];
  const known = new Set(content.journal.map(entry => entry.id));

  // Newest first, and only a few, so a backlog does not flood the page.
  const candidates = [...signals.posted]
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .filter(post => !known.has(journalIdFor(post)))
    .slice(0, 3);

  for (const post of candidates) {
    operations.push({
      op: 'upsert-journal',
      value: {
        id: journalIdFor(post),
        date: post.postedAt.slice(0, 10),
        title: headlineFor(post.text),
        body: post.text,
        embedUrl: post.url,
      },
    });
    changes.push(`Added your ${post.platform} post from ${post.postedAt.slice(0, 10)} as a site update`);
  }

  return {
    operations,
    changes,
    why: operations.length > 0 ? ['You posted this publicly and the site did not have it.'] : [],
    changeClass: 'content-only',
  };
}

// ---------------------------------------------------------------------------
// Observations: things to say, not things to do
// ---------------------------------------------------------------------------

export type ObservationKind =
  | 'stale-presave'
  | 'release-soon'
  | 'gate-final-audio'
  | 'stale-hero'
  | 'no-shows-listed'
  | 'low-seo'
  | 'quiet-door'
  | 'no-door';

export interface Observation {
  kind: ObservationKind;
  /** What the agent would actually say, in the artist's language. */
  headline: string;
  /** The concrete thing being offered, if the artist says yes. */
  suggestion: string;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** A release inside this window is close enough to plan around. */
const RELEASE_SOON_DAYS = 14;

/**
 * Read the situation and return what is worth raising with the artist.
 *
 * These are conversation openers, not a task list. The agent uses them when
 * the artist starts a chat, and the scheduled card carries them as notes so
 * nothing acts on them quietly.
 */
export function readSituation(
  content: SiteContent,
  signals: RoutineSignals,
  today: string,
): Observation[] {
  const observations: Observation[] = [];

  // A song that is out but still advertising a pre-save is the most
  // embarrassing thing an artist site does. Worth saying immediately.
  for (const release of content.releases) {
    if (release.date <= today && release.links.presave) {
      observations.push({
        kind: 'stale-presave',
        headline: `"${release.title}" is out but the site still links to a pre-save.`,
        suggestion: 'Swap the pre-save for the listen link.',
      });
    }
  }

  const upcoming = signals.releases
    .filter(release => release.date > today && daysBetween(today, release.date) <= RELEASE_SOON_DAYS)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  if (upcoming) {
    const days = daysBetween(today, upcoming.date);
    observations.push({
      kind: 'release-soon',
      headline: `"${upcoming.title}" is out in ${days} ${days === 1 ? 'day' : 'days'}.`,
      suggestion: 'Feature it on the home page and get the pre-save link up.',
    });
    if (content.signup.enabled) {
      observations.push({
        kind: 'gate-final-audio',
        headline: 'You could put an early listen behind an email catcher before it drops.',
        suggestion: `Add a sneak-peek form for "${upcoming.title}" so fans trade an address for the first play.`,
      });
    }
  }

  // Featuring is a judgement call about what the artist wants front and
  // centre, so it is raised rather than done.
  const newestOut = content.releases
    .filter(release => release.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const featured = content.releases.find(release => release.featured);
  if (newestOut && featured && featured.id !== newestOut.id && newestOut.date > featured.date) {
    observations.push({
      kind: 'stale-hero',
      headline: `The home page still leads with "${featured.title}" while "${newestOut.title}" is newer.`,
      suggestion: `Move "${newestOut.title}" to the top.`,
    });
  }

  // Shows are never inferred from calendar titles. If the calendar is busy
  // and the site is empty, ask the artist for the list.
  if (content.shows.filter(show => show.date >= today).length === 0 && signals.upcomingEvents.length > 0) {
    observations.push({
      kind: 'no-shows-listed',
      headline: 'Your site has no upcoming shows, but your calendar is not empty.',
      suggestion: 'Send me the dates, cities, venues, and ticket links and I will put them up.',
    });
  }

  if (!content.signup.enabled) {
    observations.push({
      kind: 'no-door',
      headline: 'There is no way for a visitor to give you their email.',
      suggestion: 'Turn on the signup form so people who find you can hear from you again.',
    });
  } else if (signals.lastSignupAt && daysBetween(signals.lastSignupAt, today) > 30) {
    observations.push({
      kind: 'quiet-door',
      headline: 'Nobody has signed up in over a month.',
      suggestion: 'Move the form higher on the page or offer something in return.',
    });
  }

  if (typeof signals.auditScore === 'number' && signals.auditScore < 70) {
    observations.push({
      kind: 'low-seo',
      headline: `Search engines are only reading the site at ${signals.auditScore} out of 100.`,
      suggestion: 'Let me fix the titles and descriptions the audit flagged.',
    });
  }

  return observations;
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

export interface BriefSiteItem {
  buildHash: string;
  changeClass: ChangeClass;
  summary: string;
  previewOutputId?: string;
  auditScore: number;
  /** `trusted` means it is already live and the card offers Undo instead. */
  tier: 'one-click' | 'trusted';
  deployReceiptId?: string;
}

export interface BriefSubscriberItem {
  imported: number;
  duplicates: number;
  skippedSuppressed: number;
  receiptId?: string;
}

export interface WebsiteBrief {
  runId: string;
  weekOf: string;
  cadence: RoutineCadence;
  site?: BriefSiteItem;
  subscribers?: BriefSubscriberItem;
  /** Things worth raising, carried as text so nothing acts on them. */
  observations: Observation[];
  /** True when there was nothing to do and nothing to say. */
  nothingToDo?: true;
}

/** One line for the Needs You row and the messaging bridge. */
export function describeBrief(brief: WebsiteBrief): string {
  if (brief.nothingToDo) return 'Nothing needed on the site this time.';
  const parts: string[] = [];
  if (brief.site) {
    parts.push(brief.site.tier === 'trusted'
      ? `Published: ${brief.site.summary}`
      : `Publish: ${brief.site.summary}`);
  }
  if (brief.subscribers && brief.subscribers.imported > 0) {
    parts.push(`${brief.subscribers.imported} new ${brief.subscribers.imported === 1 ? 'fan' : 'fans'} from the site`);
  }
  if (parts.length === 0 && brief.observations.length > 0) return brief.observations[0]!.headline;
  return parts.join(' · ');
}
