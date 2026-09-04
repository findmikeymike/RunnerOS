/**
 * The weekly site routine (spec 41 Slice B).
 *
 * This module is the routine's brain and holds no I/O: signals go in,
 * a plan and a brief come out. The service around it does the reading,
 * building, and publishing.
 *
 * The cadence is the artist's choice, not a fixed Monday. Some artists ship
 * constantly and want a weekly pass; others put out a record a year and would
 * find a weekly card noise.
 */

import type {
  ChangeClass,
  SiteContent,
  SiteContentOperation,
  SiteRelease,
  SiteShow,
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

/** A release promoted in the Release Kit that the site may not know about. */
export interface ReleaseSignal {
  id: string;
  title: string;
  type: SiteRelease['type'];
  date: string;
  artworkAssetId?: string;
  links?: SiteRelease['links'];
}

/** A show on the HQ calendar. */
export interface ShowSignal {
  id: string;
  date: string;
  city: string;
  venue: string;
  ticketUrl?: string;
  calendarEventId?: string;
}

export interface RoutineSignals {
  releases: ReleaseSignal[];
  shows: ShowSignal[];
  /** Audit score of the last build, if there was one. */
  auditScore?: number;
  /** Latest signup, used to notice a door nobody is walking through. */
  lastSignupAt?: string;
  /** Latest social post, used to notice a silent journal. */
  lastPostAt?: string;
}

export type StalenessKind =
  | 'missing-release'
  | 'missing-show'
  | 'past-show'
  | 'stale-presave'
  | 'stale-hero'
  | 'low-seo'
  | 'quiet-door'
  | 'quiet-journal';

export interface StalenessFinding {
  kind: StalenessKind;
  /** One line the artist reads on the card. */
  detail: string;
  /** True when the routine can fix it on its own. */
  actionable: boolean;
}

export interface RoutinePlan {
  operations: SiteContentOperation[];
  /** Human lines describing each edit, for the receipt. */
  changes: string[];
  /** Why the routine acted, for the receipt. */
  why: string[];
  findings: StalenessFinding[];
  changeClass: ChangeClass;
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/**
 * Decide what the site is missing and how to fix it.
 *
 * Pure: content and signals in, operations out. Only content-class edits are
 * ever produced here, because a routine must never change the design without
 * the artist asking.
 */
export function planSiteUpdate(
  content: SiteContent,
  signals: RoutineSignals,
  today: string,
): RoutinePlan {
  const operations: SiteContentOperation[] = [];
  const changes: string[] = [];
  const why: string[] = [];
  const findings: StalenessFinding[] = [];

  const knownReleases = new Map(content.releases.map(release => [release.id, release]));
  const knownShows = new Map(content.shows.map(show => [show.id, show]));

  // New releases promoted since the site last saw them.
  for (const release of signals.releases) {
    if (knownReleases.has(release.id)) continue;
    operations.push({
      op: 'upsert-release',
      value: {
        id: release.id,
        title: release.title,
        type: release.type,
        date: release.date,
        artworkAssetId: release.artworkAssetId,
        links: release.links ?? {},
      },
    });
    changes.push(`Added "${release.title}" to Music`);
    findings.push({ kind: 'missing-release', detail: `"${release.title}" was not on the site`, actionable: true });
  }

  // New shows on the calendar.
  for (const show of signals.shows) {
    if (knownShows.has(show.id)) continue;
    if (show.date < today) continue;
    operations.push({
      op: 'upsert-show',
      value: {
        id: show.id,
        date: show.date,
        city: show.city,
        venue: show.venue,
        ticketUrl: show.ticketUrl,
        calendarEventId: show.calendarEventId,
      },
    });
    changes.push(`Added ${show.city} on ${show.date} to Shows`);
    findings.push({ kind: 'missing-show', detail: `${show.city} on ${show.date} was not listed`, actionable: true });
  }

  // A release that is out but still advertising a pre-save is the single most
  // embarrassing thing an artist site does, so fix it without being asked.
  for (const release of content.releases) {
    if (release.date > today) continue;
    if (!release.links.presave) continue;
    const links = { ...release.links };
    delete links.presave;
    operations.push({ op: 'upsert-release', value: { ...release, links } });
    changes.push(`Removed the pre-save link from "${release.title}" now that it is out`);
    findings.push({
      kind: 'stale-presave',
      detail: `"${release.title}" is out but still linked to a pre-save`,
      actionable: true,
    });
  }

  // The hero should be the newest thing, not whatever was newest last year.
  const newest = [...content.releases, ...operations.flatMap(op =>
    op.op === 'upsert-release' ? [op.value] : [])]
    .filter(release => release.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const featured = content.releases.find(release => release.featured);

  if (newest && featured && featured.id !== newest.id && newest.date > featured.date) {
    operations.push({ op: 'upsert-release', value: { ...featured, featured: false } });
    operations.push({ op: 'upsert-release', value: { ...newest, featured: true } });
    changes.push(`Moved "${newest.title}" to the top of the page`);
    findings.push({
      kind: 'stale-hero',
      detail: `"${featured.title}" was still featured over the newer "${newest.title}"`,
      actionable: true,
    });
  } else if (newest && !featured) {
    operations.push({ op: 'upsert-release', value: { ...newest, featured: true } });
    changes.push(`Featured "${newest.title}" at the top of the page`);
    findings.push({ kind: 'stale-hero', detail: 'Nothing was featured on the home page', actionable: true });
  }

  // Past shows are left in place: the archive is worth having, and the
  // template already separates upcoming from past.
  const past = content.shows.filter(show => show.date < today).length;
  if (past > 0 && content.shows.every(show => show.date < today)) {
    findings.push({
      kind: 'past-show',
      detail: 'Every listed show has happened. Nothing is coming up.',
      actionable: false,
    });
  }

  // Things worth telling the artist but not worth acting on alone.
  if (typeof signals.auditScore === 'number' && signals.auditScore < 70) {
    findings.push({
      kind: 'low-seo',
      detail: `Search readiness is ${signals.auditScore} out of 100`,
      actionable: false,
    });
  }

  if (content.signup.enabled && signals.lastSignupAt && daysBetween(signals.lastSignupAt, today) > 30) {
    findings.push({
      kind: 'quiet-door',
      detail: 'No new signups in over a month. The door may be hard to find.',
      actionable: false,
    });
  }

  const lastJournal = content.journal[0]?.date;
  if (signals.lastPostAt && (!lastJournal || daysBetween(lastJournal, today) > 21)) {
    findings.push({
      kind: 'quiet-journal',
      detail: 'You have posted recently but the site has no news.',
      actionable: false,
    });
  }

  if (operations.length > 0) {
    why.push(...findings.filter(finding => finding.actionable).map(finding => finding.detail));
  }

  return { operations, changes, why, findings, changeClass: 'content-only' };
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
  /** Everything the routine noticed but did not act on. */
  notes: string[];
  /** True when there was nothing to do at all. */
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
  if (parts.length === 0 && brief.notes.length > 0) return brief.notes[0]!;
  return parts.join(' · ');
}
