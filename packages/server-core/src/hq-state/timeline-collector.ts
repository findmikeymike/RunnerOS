/**
 * Artist Timeline collector — gathers parsed inputs for `buildArtistTimeline`
 * from every dated store and converts each parse failure into a warning.
 *
 * The builder is pure and cannot see parse failures, so this is the layer
 * responsible for the spec's "a campaign whose calendar fails to parse
 * contributes a warning, not an abort" rule
 * (docs/creator-command-center/20-artist-timeline-unified-calendar-spec.md §8).
 */
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  missionCampaignWindow,
  missionReleaseDateKey,
  MISSION_BRIEF_CONTEXT_SLUG,
  parseArtistCalendarDocResult,
  parseMissionBriefDocResult,
} from '@craft-agent/shared/artist-context';
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  parseCampaignCalendarDocResult,
} from '@craft-agent/shared/campaign-calendar';
import { getWorkspaces } from '@craft-agent/shared/config';
import {
  addDaysToDateKey,
  buildArtistTimeline,
  CAMPAIGN_STATE_CONTEXT_SLUG,
  dateKeyInTimezone,
  HQ_STATE_CONTEXT_SLUG,
  isTimelineDateKey,
  type ArtistTimeline,
  type TimelineCampaignInput,
  type TimelineGoalInput,
  type TimelineTier,
  type TimelineWarning,
} from '@craft-agent/shared/hq-state';
import {
  parseScheduledWorkDocResult,
  SCHEDULED_WORK_CONTEXT_SLUG,
} from '@craft-agent/shared/scheduled-work';
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions';
import { isSharedIntelContextSlug } from '@craft-agent/shared/shared-intel';
import {
  loadAuthorizedContextDocsForAgent,
  loadContextDoc,
} from '@craft-agent/shared/workspace-context';
import { findArtistHqWorkspace, resolveTimelineTimezone } from './snapshot';

export { addDaysToDateKey };

const DEFAULT_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = {
  'artist-calendar': 30,
  'campaign-calendar': 14,
  'scheduled-work': 7,
  'mission-brief': 30,
} as const;

export interface CollectArtistTimelineInput {
  from?: string;
  to?: string;
  tier?: TimelineTier;
  limit?: number;
}

export function collectArtistTimeline(
  input: CollectArtistTimelineInput,
  now = new Date(),
): ArtistTimeline {
  const hq = findArtistHqWorkspace();
  if (!hq) throw new Error('Artist HQ workspace is not configured.');

  const timezone = resolveTimelineTimezone();
  const todayKey = dateKeyInTimezone(now.toISOString(), timezone) ?? now.toISOString().slice(0, 10);
  const from = isTimelineDateKey(input.from) ? input.from : todayKey;
  const to = isTimelineDateKey(input.to)
    ? input.to
    : addDaysToDateKey(from, DEFAULT_WINDOW_DAYS);

  const warnings: TimelineWarning[] = [];

  const hqCalendarDoc = loadContextDoc(hq.rootPath, ARTIST_CALENDAR_CONTEXT_SLUG);
  const hqCalendar = parseArtistCalendarDocResult(hqCalendarDoc ?? undefined);
  const hqStaleSources: string[] = [];
  if (!hqCalendar.ok) {
    warnings.push({ source: 'artist-calendar', workspaceId: hq.id, reason: hqCalendar.error });
  } else if (hqCalendarDoc) {
    markStale('artist-calendar', hq.id, hqCalendar.calendar.updatedAt, STALE_DAYS['artist-calendar'], now, hqStaleSources, warnings);
  }

  const hqWorkDoc = loadContextDoc(hq.rootPath, SCHEDULED_WORK_CONTEXT_SLUG);
  const hqWork = parseScheduledWorkDocResult(hqWorkDoc ?? undefined, hq.id);
  if (!hqWork.ok) {
    warnings.push({ source: 'scheduled-work', workspaceId: hq.id, reason: hqWork.error });
  } else if (hqWorkDoc) {
    markStale('scheduled-work', hq.id, hqWork.work.updatedAt, STALE_DAYS['scheduled-work'], now, hqStaleSources, warnings);
  }

  const campaigns: TimelineCampaignInput[] = getWorkspaces()
    .filter((workspace) => workspace.artistWorkspaceScope === 'campaign')
    .map((workspace) => {
      const staleSources: string[] = [];

      const missionDoc = loadContextDoc(workspace.rootPath, MISSION_BRIEF_CONTEXT_SLUG);
      const mission = parseMissionBriefDocResult(missionDoc ?? undefined);
      if (!mission.ok) {
        warnings.push({ source: 'mission-brief', workspaceId: workspace.id, reason: mission.error });
      } else if (missionDoc) {
        markStale('mission-brief', workspace.id, mission.brief.updatedAt, STALE_DAYS['mission-brief'], now, staleSources, warnings);
      }

      const calendarDoc = loadContextDoc(workspace.rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG);
      const calendar = parseCampaignCalendarDocResult(calendarDoc ?? undefined, workspace.id);
      if (!calendar.ok) {
        warnings.push({ source: 'campaign-calendar', workspaceId: workspace.id, reason: calendar.error });
      } else if (calendarDoc) {
        markStale('campaign-calendar', workspace.id, calendar.calendar.updatedAt, STALE_DAYS['campaign-calendar'], now, staleSources, warnings);
      }

      const workDoc = loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG);
      const work = parseScheduledWorkDocResult(workDoc ?? undefined, workspace.id);
      if (!work.ok) {
        warnings.push({ source: 'scheduled-work', workspaceId: workspace.id, reason: work.error });
      } else if (workDoc) {
        markStale('scheduled-work', workspace.id, work.work.updatedAt, STALE_DAYS['scheduled-work'], now, staleSources, warnings);
      }

      const campaignWindow = mission.ok ? missionCampaignWindow(mission.brief) : undefined;
      return {
        workspaceId: workspace.id,
        campaignId: workspace.id,
        label: workspace.name,
        startDate: campaignWindow?.startDate,
        releaseDate: mission.ok ? missionReleaseDateKey(mission.brief) : undefined,
        finishDate: campaignWindow?.finishDate,
        dateStatuses: campaignWindow?.statuses,
        items: calendar.ok ? calendar.calendar.items : [],
        orders: work.ok ? work.work.items : [],
        ...(staleSources.length > 0 ? { staleSources } : {}),
      };
    });

  // Goal eligibility is explicit (spec §3): Pulse goals only — status set and
  // not done, enabled, strict date deadline. A bare `deadline` on a non-goal
  // doc contributes nothing.
  const goals: TimelineGoalInput[] = loadAuthorizedContextDocsForAgent(hq.rootPath, CONCIERGE_SLUG)
    .filter((doc) =>
      doc.metadata.status !== undefined
      && doc.metadata.status !== 'done'
      && doc.metadata.enabled !== false
      && typeof doc.metadata.deadline === 'string'
      && isTimelineDateKey(doc.metadata.deadline)
      && !isSharedIntelContextSlug(doc.slug)
      && doc.slug !== HQ_STATE_CONTEXT_SLUG
      && doc.slug !== CAMPAIGN_STATE_CONTEXT_SLUG,
    )
    .map((doc) => ({
      slug: doc.slug,
      title: doc.metadata.name.trim() || doc.slug,
      deadline: doc.metadata.deadline!,
      workspaceId: hq.id,
    }));

  return buildArtistTimeline({
    now,
    from,
    to,
    timezone,
    hqWorkspaceId: hq.id,
    hqEvents: hqCalendar.ok ? hqCalendar.calendar.events : [],
    hqOrders: hqWork.ok ? hqWork.work.items : [],
    hqStaleSources,
    campaigns,
    goals,
    warnings,
    tiers: input.tier ? [input.tier] : undefined,
    limit: input.limit,
  });
}

function markStale(
  source: keyof typeof STALE_DAYS,
  workspaceId: string,
  observedAt: string | undefined,
  staleDays: number,
  now: Date,
  staleSources: string[],
  warnings: TimelineWarning[],
): void {
  const observed = observedAt ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(observed) || now.getTime() - observed <= staleDays * DAY_MS) return;
  staleSources.push(source);
  warnings.push({
    source,
    workspaceId,
    reason: `${source} is older than ${staleDays} days; entries are shown but marked stale.`,
  });
}
