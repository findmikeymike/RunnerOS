/**
 * Artist Timeline — unified calendar read model.
 *
 * Merges the five dated stores (HQ artist-calendar events, campaign-calendar
 * items, scheduled-work orders, campaign release dates, goal deadlines) into
 * one sorted, windowed list without adding a store: every entry points back at
 * its owner and the timeline never mutates anything.
 *
 * Spec: docs/creator-command-center/20-artist-timeline-unified-calendar-spec.md
 *
 * Contracts that matter (see spec §5 and §8):
 * - Dedup is by explicit link only. A visible ScheduledWorkOrder and the
 *   calendar shell it is bidirectionally paired with are one entry (the order
 *   wins; the shell lends its title/time). Nothing is ever merged by matching
 *   titles or dates — a false merge hides a real event.
 * - Hidden orders (`calendarVisibility: 'hidden'`) are omitted entirely.
 * - Ordering: filter by tier, sort strictly chronologically, then limit.
 * - The builder receives parsed inputs, so parse failures must be passed in by
 *   the collector via `warnings`; the builder merges them with its own
 *   half-link warnings.
 */
import type { ArtistCalendarEvent } from '../artist-context/calendar.ts';
import type { CampaignDateStatuses } from '../artist-context/mission-brief.ts';
import type { CampaignCalendarItem } from '../campaign-calendar/index.ts';
import type { ScheduledWorkOrder, ScheduledWorkType } from '../scheduled-work/index.ts';

export type TimelineTier = 'strategic' | 'operational';

export type TimelineCategory =
  | 'release'
  | 'milestone'
  | 'deadline'
  | 'approval'
  | 'publish'
  | 'review'
  | 'task'
  | 'event';

export type TimelineOriginKind =
  | 'hq-event'
  | 'campaign-item'
  | 'scheduled-work'
  | 'campaign-start'
  | 'release'
  | 'campaign-finish'
  | 'goal';

export interface TimelineOrigin {
  kind: TimelineOriginKind;
  workspaceId: string;
  campaignId?: string;
  /** Id within the owning store. The composite entry id is `${kind}:${sourceId}`. */
  sourceId: string;
}

export interface TimelineEntry {
  id: string;
  /** Calendar day in the reference timezone (YYYY-MM-DD). */
  date: string;
  time?: string;
  timezone: string;
  /** `${date}T${time ?? '00:00'}` in the reference timezone — the sort key. */
  sortKey: string;
  title: string;
  tier: TimelineTier;
  category: TimelineCategory;
  status?: string;
  /** True when blocked, failed, missed, or awaiting the artist. */
  needsAttention: boolean;
  /** Set when the entry's source doc failed its freshness window. */
  stale?: boolean;
  origin: TimelineOrigin;
}

export interface TimelineRollup {
  workspaceId: string;
  campaignId?: string;
  label: string;
  counts: { total: number; needsAttention: number };
}

export interface TimelineWarning {
  source: string;
  workspaceId?: string;
  reason: string;
}

export interface ArtistTimeline {
  from: string;
  to: string;
  timezone: string;
  entries: TimelineEntry[];
  /** Operational volume per campaign, for altitudes that do not list it. */
  rollups: TimelineRollup[];
  /** Canonical campaign spans used by year-level views. */
  campaignWindows: TimelineCampaignWindow[];
  /** Strategic entries beyond `to`, so a bounded window can still say "2 more later this year". */
  beyondWindow: { strategic: number; nextDate?: string };
  warnings: TimelineWarning[];
}

export interface TimelineCampaignWindow {
  workspaceId: string;
  campaignId?: string;
  label: string;
  startDate?: string;
  releaseDate?: string;
  finishDate?: string;
  statuses: CampaignDateStatuses;
  stale?: boolean;
}

export interface TimelineCampaignInput {
  workspaceId: string;
  campaignId?: string;
  label: string;
  startDate?: string;
  /** Canonical release date from mission-brief via `missionReleaseDateKey`. */
  releaseDate?: string;
  finishDate?: string;
  dateStatuses?: CampaignDateStatuses;
  items: CampaignCalendarItem[];
  orders: ScheduledWorkOrder[];
  /** Source names ('campaign-calendar' | 'scheduled-work' | 'mission-brief') that failed freshness. */
  staleSources?: string[];
}

export interface TimelineGoalInput {
  slug: string;
  title: string;
  /** Strict YYYY-MM-DD; anything else yields a warning, not an entry. */
  deadline: string;
  workspaceId: string;
}

export interface BuildArtistTimelineInput {
  now: Date;
  from: string;
  to: string;
  timezone: string;
  hqWorkspaceId: string;
  hqEvents: ArtistCalendarEvent[];
  hqOrders: ScheduledWorkOrder[];
  /** HQ source names ('artist-calendar' | 'scheduled-work') that failed freshness. */
  hqStaleSources?: string[];
  campaigns: TimelineCampaignInput[];
  goals: TimelineGoalInput[];
  /** Parse failures from the collector; merged into the output warnings. */
  warnings?: TimelineWarning[];
  tiers?: TimelineTier[];
  limit?: number;
}

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Statuses that mean the artist (or the system) is being waited on. */
const ATTENTION_STATUSES = new Set([
  'failed',
  'missed',
  'needs-attention',
  'needs-approval',
  'awaiting-review',
]);

const ORDER_CATEGORY: Record<ScheduledWorkType, TimelineCategory> = {
  'agent-task': 'task',
  'workflow-run': 'task',
  'social-publish': 'publish',
  review: 'review',
};

export function buildArtistTimeline(input: BuildArtistTimelineInput): ArtistTimeline {
  const warnings: TimelineWarning[] = [...(input.warnings ?? [])];
  const all: TimelineEntry[] = [];

  collectScopeEntries(all, warnings, input, {
    scope: 'hq',
    workspaceId: input.hqWorkspaceId,
    events: input.hqEvents,
    items: [],
    orders: input.hqOrders,
    label: 'HQ',
    staleSources: input.hqStaleSources ?? [],
  });

  for (const campaign of input.campaigns) {
    collectScopeEntries(all, warnings, input, {
      scope: 'campaign',
      workspaceId: campaign.workspaceId,
      campaignId: campaign.campaignId,
      events: [],
      items: campaign.items,
      orders: campaign.orders,
      label: campaign.label,
      staleSources: campaign.staleSources ?? [],
    });

    addCampaignMilestone(all, warnings, input.timezone, campaign, 'start', campaign.startDate);
    addCampaignMilestone(all, warnings, input.timezone, campaign, 'release', campaign.releaseDate);
    addCampaignMilestone(all, warnings, input.timezone, campaign, 'finish', campaign.finishDate);
  }

  for (const goal of input.goals) {
    if (!isDateKey(goal.deadline)) {
      warnings.push({
        source: 'goal',
        workspaceId: goal.workspaceId,
        reason: `Goal "${goal.title}" has an invalid deadline "${goal.deadline}".`,
      });
      continue;
    }
    all.push({
      id: `goal:${goal.slug}`,
      date: goal.deadline,
      timezone: input.timezone,
      sortKey: `${goal.deadline}T00:00`,
      title: goal.title,
      tier: 'strategic',
      category: 'milestone',
      needsAttention: false,
      origin: { kind: 'goal', workspaceId: goal.workspaceId, sourceId: goal.slug },
    });
  }

  // Window filter. Forward-only defaults are the caller's job; the builder
  // honors whatever window it is given.
  const inWindow = all.filter((entry) => entry.date >= input.from && entry.date <= input.to);

  // Beyond-window synopsis is computed from everything, before tier filtering
  // and before limit, so truncation never hides the later-year count.
  const beyond = all
    .filter((entry) => entry.tier === 'strategic' && entry.date > input.to)
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const beyondWindow = {
    strategic: beyond.length,
    ...(beyond[0] ? { nextDate: beyond[0].date } : {}),
  };

  // Roll-ups summarize operational volume regardless of the tier filter —
  // that is their purpose at strategic altitudes.
  const rollups = buildRollups(inWindow, input.campaigns);
  const campaignWindows = input.campaigns.map((campaign) => ({
    workspaceId: campaign.workspaceId,
    ...(campaign.campaignId ? { campaignId: campaign.campaignId } : {}),
    label: campaign.label,
    ...(isDateKey(campaign.startDate) ? { startDate: campaign.startDate } : {}),
    ...(isDateKey(campaign.releaseDate) ? { releaseDate: campaign.releaseDate } : {}),
    ...(isDateKey(campaign.finishDate) ? { finishDate: campaign.finishDate } : {}),
    statuses: campaign.dateStatuses ?? {},
    ...(campaign.staleSources?.includes('mission-brief') ? { stale: true } : {}),
  }));

  const tiers = new Set(input.tiers ?? ['strategic', 'operational']);
  const entries = inWindow
    .filter((entry) => tiers.has(entry.tier))
    .sort(compareEntries)
    .slice(0, input.limit && input.limit > 0 ? input.limit : undefined);

  return {
    from: input.from,
    to: input.to,
    timezone: input.timezone,
    entries,
    rollups,
    campaignWindows,
    beyondWindow,
    warnings,
  };
}

function addCampaignMilestone(
  out: TimelineEntry[],
  warnings: TimelineWarning[],
  timezone: string,
  campaign: TimelineCampaignInput,
  milestone: 'start' | 'release' | 'finish',
  date: string | undefined,
): void {
  if (!date) return;
  if (!isDateKey(date)) {
    warnings.push({
      source: 'mission-brief',
      workspaceId: campaign.workspaceId,
      reason: `${milestone[0]!.toUpperCase()}${milestone.slice(1)} date "${date}" is not a valid YYYY-MM-DD date.`,
    });
    return;
  }
  const kind = milestone === 'start' ? 'campaign-start' : milestone === 'finish' ? 'campaign-finish' : 'release';
  out.push({
    id: `${kind}:${campaign.workspaceId}`,
    date,
    timezone,
    sortKey: `${date}T00:00`,
    title: milestone === 'release' ? campaign.label : `${campaign.label} — campaign ${milestone}`,
    tier: 'strategic',
    category: milestone === 'release' ? 'release' : 'milestone',
    status: campaign.dateStatuses?.[milestone] ?? 'target',
    needsAttention: false,
    stale: campaign.staleSources?.includes('mission-brief') || undefined,
    origin: {
      kind,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.campaignId,
      sourceId: campaign.workspaceId,
    },
  });
}

// ---------------------------------------------------------------------------
// Per-scope collection with explicit-link dedup
// ---------------------------------------------------------------------------

interface ScopeInput {
  scope: 'hq' | 'campaign';
  workspaceId: string;
  campaignId?: string;
  events: ArtistCalendarEvent[];
  items: CampaignCalendarItem[];
  orders: ScheduledWorkOrder[];
  label: string;
  staleSources: string[];
}

function collectScopeEntries(
  out: TimelineEntry[],
  warnings: TimelineWarning[],
  input: BuildArtistTimelineInput,
  scope: ScopeInput,
): void {
  const staleCalendar = scope.staleSources.includes(
    scope.scope === 'hq' ? 'artist-calendar' : 'campaign-calendar',
  );
  const staleWork = scope.staleSources.includes('scheduled-work');

  const eventById = new Map(scope.events.map((event) => [event.id, event]));
  const itemById = new Map(scope.items.map((item) => [item.id, item]));
  // Shell back-references (shell.scheduledWorkId -> shell). The canonical pair
  // is bidirectional, but a shell written before the link healed may only
  // carry the back-reference; honoring it keeps the pair to one entry.
  const eventByWorkId = new Map(
    scope.events.flatMap((event) => (event.scheduledWorkId ? [[event.scheduledWorkId, event] as const] : [])),
  );
  const itemByWorkId = new Map(
    scope.items.flatMap((item) => (item.scheduledWorkId ? [[item.scheduledWorkId, item] as const] : [])),
  );
  /** Shell ids consumed by a paired order — suppressed from standalone emission. */
  const consumedShells = new Set<string>();

  for (const order of scope.orders) {
    const linked =
      order.calendarLink.calendar === 'hq'
        ? eventById.get(order.calendarLink.itemId)
        : itemById.get(order.calendarLink.itemId);
    // Fall back to the shell-side back-reference so a one-way pair still
    // collapses to one entry instead of duplicating.
    const backReferenced =
      order.calendarLink.calendar === 'hq'
        ? eventByWorkId.get(order.id)
        : itemByWorkId.get(order.id);
    const shell = linked ?? backReferenced;
    const shellBacklink = shell?.scheduledWorkId;

    // A linked shell belongs to its order even when the order is canceled,
    // deleted, or hidden. Consume it before omitting the order so a stale or
    // partially-healed shell cannot resurrect private/canceled work.
    if (order.deletedAt || order.status === 'canceled' || order.calendarVisibility === 'hidden') {
      if (shell) consumedShells.add(shell.id);
      continue;
    }

    if (!shell) {
      warnings.push({
        source: 'scheduled-work',
        workspaceId: scope.workspaceId,
        reason: `Order "${order.title}" (${order.id}) links to a missing calendar item ${order.calendarLink.itemId}.`,
      });
    } else {
      if (shellBacklink !== order.id || shell !== linked) {
        warnings.push({
          source: 'scheduled-work',
          workspaceId: scope.workspaceId,
          reason: `Order "${order.title}" (${order.id}) and calendar item ${shell.id} are half-linked.`,
        });
      }
      consumedShells.add(shell.id);
    }

    const dateKey = dateKeyInTimezone(order.startAt, input.timezone);
    if (!dateKey) {
      warnings.push({
        source: 'scheduled-work',
        workspaceId: scope.workspaceId,
        reason: `Order "${order.title}" (${order.id}) has an unreadable start time.`,
      });
      continue;
    }

    const shellItem = shell && 'kind' in shell ? shell : undefined;
    const time =
      (shell && shell.time) || timeKeyInTimezone(order.startAt, input.timezone);
    const needsAttention = ATTENTION_STATUSES.has(order.status) || Boolean(order.attention);
    out.push({
      id: `scheduled-work:${order.id}`,
      date: dateKey,
      ...(time ? { time } : {}),
      timezone: input.timezone,
      sortKey: `${dateKey}T${time ?? '00:00'}`,
      title: shell?.title?.trim() || order.title,
      tier: deriveOrderTier(order, shellItem?.kind, needsAttention),
      category: shellItem?.kind === 'deadline'
        ? 'deadline'
        : shellItem?.kind === 'approval'
          ? 'approval'
          : ORDER_CATEGORY[order.type],
      status: order.status,
      needsAttention,
      stale: staleWork || undefined,
      origin: {
        kind: 'scheduled-work',
        workspaceId: scope.workspaceId,
        campaignId: scope.campaignId,
        sourceId: order.id,
      },
    });
  }

  for (const event of scope.events) {
    if (event.deletedAt || consumedShells.has(event.id)) continue;
    if (!isDateKey(event.date)) continue;
    out.push({
      id: `hq-event:${event.id}`,
      date: event.date,
      ...(event.time ? { time: event.time } : {}),
      timezone: input.timezone,
      sortKey: `${event.date}T${event.time ?? '00:00'}`,
      title: event.title,
      tier: 'strategic',
      category: 'event',
      needsAttention: false,
      stale: staleCalendar || undefined,
      origin: { kind: 'hq-event', workspaceId: scope.workspaceId, sourceId: event.id },
    });
  }

  for (const item of scope.items) {
    if (item.deletedAt || item.status === 'canceled' || consumedShells.has(item.id)) continue;
    if (!isDateKey(item.date)) continue;
    const needsAttention = ATTENTION_STATUSES.has(item.status);
    const strategic = item.kind === 'deadline' || item.kind === 'approval' || needsAttention;
    const converted = item.time
      ? dateTimeInReferenceTimezone(item.date, item.time, item.timezone, input.timezone)
      : null;
    if (item.time && !converted) {
      warnings.push({
        source: 'campaign-calendar',
        workspaceId: scope.workspaceId,
        reason: `Calendar item "${item.title}" (${item.id}) has an unreadable local date, time, or timezone.`,
      });
      continue;
    }
    const date = converted?.date ?? item.date;
    const time = converted?.time ?? item.time;
    out.push({
      id: `campaign-item:${item.id}`,
      date,
      ...(time ? { time } : {}),
      timezone: input.timezone,
      sortKey: `${date}T${time ?? '00:00'}`,
      title: item.title,
      tier: strategic ? 'strategic' : 'operational',
      category:
        item.kind === 'deadline' ? 'deadline' : item.kind === 'approval' ? 'approval' : 'task',
      status: item.status,
      needsAttention,
      stale: staleCalendar || undefined,
      origin: {
        kind: 'campaign-item',
        workspaceId: scope.workspaceId,
        campaignId: scope.campaignId,
        sourceId: item.id,
      },
    });
  }
}

function deriveOrderTier(
  order: ScheduledWorkOrder,
  shellKind: CampaignCalendarItem['kind'] | undefined,
  needsAttention: boolean,
): TimelineTier {
  if (order.owner.scope === 'hq') return 'strategic';
  if (needsAttention) return 'strategic';
  if (shellKind === 'deadline' || shellKind === 'approval') return 'strategic';
  return 'operational';
}

function buildRollups(
  entries: TimelineEntry[],
  campaigns: TimelineCampaignInput[],
): TimelineRollup[] {
  const labelByWorkspace = new Map(campaigns.map((campaign) => [campaign.workspaceId, campaign]));
  const byWorkspace = new Map<string, { total: number; needsAttention: number }>();
  for (const entry of entries) {
    if (!labelByWorkspace.has(entry.origin.workspaceId)) continue;
    const counts = byWorkspace.get(entry.origin.workspaceId) ?? { total: 0, needsAttention: 0 };
    if (entry.tier === 'operational') counts.total += 1;
    if (entry.needsAttention) counts.needsAttention += 1;
    if (counts.total > 0 || counts.needsAttention > 0) byWorkspace.set(entry.origin.workspaceId, counts);
  }
  return [...byWorkspace.entries()]
    .map(([workspaceId, counts]) => {
      const campaign = labelByWorkspace.get(workspaceId);
      return {
        workspaceId,
        ...(campaign?.campaignId ? { campaignId: campaign.campaignId } : {}),
        label: campaign?.label ?? workspaceId,
        counts,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function compareEntries(left: TimelineEntry, right: TimelineEntry): number {
  const byTime = left.sortKey.localeCompare(right.sortKey);
  if (byTime !== 0) return byTime;
  const byKind = left.origin.kind.localeCompare(right.origin.kind);
  if (byKind !== 0) return byKind;
  return left.id.localeCompare(right.id);
}

/**
 * The rolling window of month keys starting at the current month — UTC when no
 * timezone is given (matching the Manager Brief's trajectory window), or the
 * given reference timezone's current month. Single home for the "next 12
 * months" concept (spec 20 §11).
 */
export function rollingMonthKeys(now: Date, count = 12, timezone?: string): string[] {
  const startKey = timezone
    ? dateKeyInTimezone(now.toISOString(), timezone) ?? now.toISOString().slice(0, 10)
    : now.toISOString().slice(0, 10);
  const [year, month] = startKey.split('-').map(Number);
  const startIndex = year! * 12 + (month! - 1);
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  });
}

export interface CampaignFocusCandidate {
  id: string;
  name: string;
  /** Strict YYYY-MM-DD; anything else is treated as undated. */
  releaseDate?: string;
  primary?: boolean;
}

export interface CampaignFocusSelection {
  id: string;
  name: string;
  label: 'Current campaign' | 'Next campaign' | 'Latest campaign' | 'Release date needed';
  releaseDate?: string;
  /** Signed days from today to the release (negative = past). */
  days?: number;
}

/**
 * Pick the campaign the artist is "in" right now: the release date closest to
 * today (ties: future first, then name), labeled Current within +/-45 days.
 * Shared so the Manager Brief and the HQ header cannot disagree about which
 * campaign is in focus. Days are computed in UTC from date keys.
 */
export function resolveCampaignFocusByReleaseDate(
  candidates: CampaignFocusCandidate[],
  now: Date,
): CampaignFocusSelection | null {
  if (candidates.length === 0) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dated = candidates
    .map((candidate) => {
      if (!candidate.releaseDate || !/^\d{4}-\d{2}-\d{2}$/.test(candidate.releaseDate)) return null;
      const timestamp = Date.parse(`${candidate.releaseDate}T00:00:00.000Z`);
      if (Number.isNaN(timestamp)) return null;
      return { candidate, days: Math.round((timestamp - today) / (24 * 60 * 60 * 1000)) };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) =>
      Math.abs(left.days) - Math.abs(right.days)
      || Number(right.days >= 0) - Number(left.days >= 0)
      || left.candidate.name.localeCompare(right.candidate.name));

  const selected = dated[0];
  if (selected) {
    return {
      id: selected.candidate.id,
      name: selected.candidate.name,
      label: Math.abs(selected.days) <= 45
        ? 'Current campaign'
        : selected.days >= 0 ? 'Next campaign' : 'Latest campaign',
      releaseDate: selected.candidate.releaseDate,
      days: selected.days,
    };
  }
  const fallback = candidates.find((candidate) => candidate.primary) ?? candidates[0]!;
  return { id: fallback.id, name: fallback.name, label: 'Release date needed' };
}

// ---------------------------------------------------------------------------
// Timezone helpers (promoted from the renderer's artist-hq-home-feed.ts so the
// server and tools share one implementation — spec §11)
// ---------------------------------------------------------------------------

export function dateKeyInTimezone(value: string, timezone: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return localDateKey(date);
  }
}

export function timeKeyInTimezone(value: string, timezone: string): string | undefined {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === 'hour')?.value;
    const minute = parts.find((part) => part.type === 'minute')?.value;
    return hour && minute ? `${hour}:${minute}` : undefined;
  } catch {
    return undefined;
  }
}

/** Convert a campaign-local wall-clock value into the shared reference zone. */
export function dateTimeInReferenceTimezone(
  dateKey: string,
  timeKey: string,
  sourceTimezone: string,
  referenceTimezone: string,
): { date: string; time: string } | null {
  if (!isDateKey(dateKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeKey)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = timeKey.split(':').map(Number);
  const target = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let guess = target;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: sourceTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    for (let pass = 0; pass < 3; pass += 1) {
      const parts = formatter.formatToParts(new Date(guess));
      const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
      const observed = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
      if (!Number.isFinite(observed)) return null;
      const adjustment = target - observed;
      guess += adjustment;
      if (adjustment === 0) break;
    }
    const finalParts = formatter.formatToParts(new Date(guess));
    const finalValue = (type: Intl.DateTimeFormatPartTypes) => Number(finalParts.find((part) => part.type === type)?.value);
    if (finalValue('year') !== year || finalValue('month') !== month || finalValue('day') !== day
      || finalValue('hour') !== hour || finalValue('minute') !== minute) return null;
    const instant = new Date(guess).toISOString();
    const date = dateKeyInTimezone(instant, referenceTimezone);
    const time = timeKeyInTimezone(instant, referenceTimezone);
    return date && time ? { date, time } : null;
  } catch {
    return null;
  }
}

/** `dateKey` plus `days`, computed in UTC so it cannot double-apply an offset. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  return value.toISOString().slice(0, 10);
}

function isDateKey(value: string | undefined): value is string {
  if (!value || !DATE_KEY_REGEX.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month! - 1
    && parsed.getUTCDate() === day;
}

/** Strict calendar-date validation for collectors and request boundaries. */
export function isTimelineDateKey(value: string | undefined): value is string {
  return isDateKey(value);
}

function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
