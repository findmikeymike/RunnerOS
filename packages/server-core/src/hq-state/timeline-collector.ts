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
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** Mission briefs older than this mark their release entry stale (spec §8a). */
const MISSION_BRIEF_STALE_MS = 30 * 24 * 60 * 60 * 1000;

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
  const from = input.from && DATE_KEY_REGEX.test(input.from) ? input.from : todayKey;
  const to = input.to && DATE_KEY_REGEX.test(input.to)
    ? input.to
    : addDaysToDateKey(from, DEFAULT_WINDOW_DAYS);

  const warnings: TimelineWarning[] = [];

  const hqCalendar = parseArtistCalendarDocResult(
    loadContextDoc(hq.rootPath, ARTIST_CALENDAR_CONTEXT_SLUG) ?? undefined,
  );
  if (!hqCalendar.ok) {
    warnings.push({ source: 'artist-calendar', workspaceId: hq.id, reason: hqCalendar.error });
  }

  const hqWork = parseScheduledWorkDocResult(
    loadContextDoc(hq.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
    hq.id,
  );
  if (!hqWork.ok) {
    warnings.push({ source: 'scheduled-work', workspaceId: hq.id, reason: hqWork.error });
  }

  const campaigns: TimelineCampaignInput[] = getWorkspaces()
    .filter((workspace) => workspace.artistWorkspaceScope === 'campaign')
    .map((workspace) => {
      const staleSources: string[] = [];

      const mission = parseMissionBriefDocResult(
        loadContextDoc(workspace.rootPath, MISSION_BRIEF_CONTEXT_SLUG) ?? undefined,
      );
      if (!mission.ok) {
        warnings.push({ source: 'mission-brief', workspaceId: workspace.id, reason: mission.error });
      } else {
        const updated = Date.parse(mission.brief.updatedAt);
        if (Number.isFinite(updated) && now.getTime() - updated > MISSION_BRIEF_STALE_MS) {
          staleSources.push('mission-brief');
        }
      }

      const calendar = parseCampaignCalendarDocResult(
        loadContextDoc(workspace.rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
        workspace.id,
      );
      if (!calendar.ok) {
        warnings.push({ source: 'campaign-calendar', workspaceId: workspace.id, reason: calendar.error });
      }

      const work = parseScheduledWorkDocResult(
        loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
        workspace.id,
      );
      if (!work.ok) {
        warnings.push({ source: 'scheduled-work', workspaceId: workspace.id, reason: work.error });
      }

      return {
        workspaceId: workspace.id,
        campaignId: workspace.id,
        label: workspace.name,
        releaseDate: mission.ok ? missionReleaseDateKey(mission.brief) : undefined,
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
      && DATE_KEY_REGEX.test(doc.metadata.deadline)
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
    campaigns,
    goals,
    warnings,
    tiers: input.tier ? [input.tier] : undefined,
    limit: input.limit,
  });
}
