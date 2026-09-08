import { artistProfileDoc } from '../artist-context/profile.ts';
import {
  ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
  parseArtistInstagramSnapshotDocResult,
  type ArtistInstagramSnapshot,
} from '../artist-context/instagram.ts';
import {
  ARTIST_RELEASE_HORIZON_CONTEXT_SLUG,
  parseArtistReleaseHorizonDocResult,
} from '../artist-context/release-horizon.ts';
import {
  ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
  parseArtistSpotifySnapshotDocResult,
  type ArtistSpotifySnapshot,
} from '../artist-context/spotify.ts';
import { missionCampaignWindow, missionReleaseDateKey } from '../artist-context/mission-brief.ts';
import {
  ARTIST_CALENDAR_CONTEXT_SLUG,
  parseArtistCalendarDocResult,
} from '../artist-context/calendar.ts';
import {
  parseScheduledWorkDocResult,
  SCHEDULED_WORK_CONTEXT_SLUG,
} from '../scheduled-work/index.ts';
import { addDaysToDateKey, buildArtistTimeline, dateKeyInTimezone, resolveCampaignFocusByReleaseDate, rollingMonthKeys } from './timeline.ts';
import { CAMPAIGN_STATE_CONTEXT_SLUG, HQ_STATE_CONTEXT_SLUG } from './types.ts';
import { isSharedIntelContextSlug, parseSharedIntelNote } from '../shared-intel/index.ts';
import type { LoadedContextDoc } from '../workspace-context/types.ts';
import type {
  BuildManagerBriefInput,
  ManagerBriefV1,
  ManagerCampaignSnapshot,
  ManagerGrowthSignal,
  ManagerReleaseReadiness,
  ManagerSourceHealth,
  ManagerSourceRef,
} from './types.ts';

export const MANAGER_BRIEF_MAX_CHARS = 8000 as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildManagerBrief(input: BuildManagerBriefInput): ManagerBriefV1 {
  const now = input.now ?? new Date();
  const docs = input.docs.filter((doc) => doc.metadata.enabled !== false);
  const docBySlug = new Map(docs.map((doc) => [doc.slug, doc]));
  const health: ManagerSourceHealth[] = [];

  const profileDoc = docBySlug.get('artist-profile');
  const profileResult = artistProfileDoc.parse(profileDoc);
  health.push(sourceHealth({
    source: 'artist-profile',
    present: Boolean(profileDoc),
    parseOk: profileResult.ok,
    observedAt: profileResult.ok && profileDoc ? profileResult.value.updatedAt : undefined,
    staleDays: 180,
    now,
    malformedMessage: profileResult.ok ? undefined : profileResult.error,
    staleMessage: 'Artist profile should be reviewed.',
  }));

  const horizonDoc = docBySlug.get(ARTIST_RELEASE_HORIZON_CONTEXT_SLUG);
  const horizonResult = parseArtistReleaseHorizonDocResult(horizonDoc);
  health.push(sourceHealth({
    source: ARTIST_RELEASE_HORIZON_CONTEXT_SLUG,
    present: Boolean(horizonDoc),
    parseOk: horizonResult.ok,
    observedAt: horizonResult.ok ? horizonResult.horizon.updatedAt : undefined,
    staleDays: 90,
    now,
    malformedMessage: horizonResult.ok ? undefined : horizonResult.error,
    staleMessage: 'Release horizon should be reviewed.',
  }));

  const spotifyDoc = docBySlug.get(ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG);
  const spotifyResult = parseArtistSpotifySnapshotDocResult(spotifyDoc);
  const spotify = spotifyResult.snapshot;
  health.push(sourceHealth({
    source: ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG,
    present: Boolean(spotifyDoc),
    parseOk: spotifyResult.ok && Boolean(spotify),
    partial: Boolean(spotify?.partial || spotify?.errors?.length),
    observedAt: spotify?.snapshotDate,
    staleDays: 9,
    now,
    malformedMessage: spotifyResult.ok ? undefined : spotifyResult.error,
    partialMessage: spotify?.errors?.[0] ?? 'Spotify snapshot is partial.',
    staleMessage: 'Spotify snapshot is older than 9 days.',
  }));

  const instagramDoc = docBySlug.get(ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG);
  const instagramResult = parseArtistInstagramSnapshotDocResult(instagramDoc);
  const instagram = instagramResult.snapshot;
  health.push(sourceHealth({
    source: ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG,
    present: Boolean(instagramDoc),
    parseOk: instagramResult.ok && Boolean(instagram),
    partial: Boolean(instagram?.partial || instagram?.errors?.length),
    observedAt: instagram?.snapshotDate,
    staleDays: 9,
    now,
    malformedMessage: instagramResult.ok ? undefined : instagramResult.error,
    partialMessage: instagram?.errors?.[0] ?? 'Instagram snapshot is partial.',
    staleMessage: 'Instagram snapshot is older than 9 days.',
  }));

  const campaignFocus = resolveHqCampaignFocus(input.relatedCampaigns, now);
  if (campaignFocus) health.push(...campaignFocus.sourceHealth);
  health.push(...input.relatedCampaigns.flatMap((campaign) => campaign.sourceHealth.filter((item) =>
    item.status !== 'fresh'
    && /:(mission-brief|campaign-calendar|scheduled-work)$/.test(item.source))));
  health.push(...operationalHealth(input));

  const profile = profileResult.ok && profileDoc ? profileResult.value : undefined;
  const trajectory = Object.entries(horizonResult.horizon.months)
    .filter(([month]) => isMonthInRollingWindow(month, now))
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 12)
    .map(([month, plan]) => ({
      month,
      title: cap(plan.title, 100) ?? 'Untitled plan',
      event: plan.event,
      keyGoal: cap(plan.keyGoal, 180),
      source: sourceRef(input.workspaceId, ARTIST_RELEASE_HORIZON_CONTEXT_SLUG, horizonResult.horizon.updatedAt),
    }));

  const intelligence = docs
    .filter((doc) => isSharedIntelContextSlug(doc.slug))
    .map((doc) => ({ doc, note: parseSharedIntelNote(doc.body) }))
    .filter((entry) => entry.note && !entry.note.superseded)
    .sort((left, right) => intelScore(right.note!.updatedAt, right.note!.confidence, now)
      - intelScore(left.note!.updatedAt, left.note!.confidence, now))
    .slice(0, 3)
    .map(({ doc, note }) => ({
      id: note!.id,
      title: cap(note!.title, 120)!,
      summary: cap(note!.summary, 360)!,
      whyItMatters: cap(note!.whyItMatters, 240),
      confidence: note!.confidence,
      source: sourceRef(input.workspaceId, doc.slug, note!.updatedAt),
    }));

  const timeline = buildBriefTimeline(input, docs, docBySlug, now);
  const nextMove = input.operatingState?.nextMove;
  const brief: ManagerBriefV1 = {
    version: 1,
    workspaceId: input.workspaceId,
    revision: '',
    generatedAt: now.toISOString(),
    budget: { maxChars: MANAGER_BRIEF_MAX_CHARS, actualChars: 0, truncated: false },
    identity: {
      artistName: cap(profile?.artistName, 100),
      mission: cap(profile?.mission, 500),
      sound: cap(profile?.sound, 360),
      audience: cap(profile?.audience, 360),
      operatingRules: splitRules(profile?.rules).slice(0, 5),
    },
    trajectory,
    timeline,
    campaignFocus: campaignFocus?.focus,
    growth: {
      spotify: spotify ? spotifySignal(input.workspaceId, spotify) : undefined,
      instagram: instagram ? instagramSignal(input.workspaceId, instagram) : undefined,
    },
    intelligence,
    operatingState: {
      nextMove: nextMove ? {
        title: cap(nextMove.title, 180)!,
        why: cap(nextMove.why, 360)!,
        worker: cap(nextMove.worker, 80),
      } : undefined,
      attention: (input.operatingState?.attention ?? []).map((item) => cap(item.text, 240)).filter(isString).slice(0, 3),
      blockers: (input.operatingState?.blockers ?? []).map((item) => cap(item, 240)).filter(isString).slice(0, 3),
      activeWork: (input.operational?.active ?? [])
        .map((item) => cap(`${item.title} — ${item.status}${item.startAt ? ` (starts ${item.startAt.slice(0, 10)})` : ''}`, 220))
        .filter(isString).slice(0, 3),
    },
    sourceHealth: dedupeHealth(health),
  };

  return finalizeBudget(brief);
}

export function resolveHqCampaignFocus(
  campaigns: ManagerCampaignSnapshot[],
  now = new Date(),
): { focus: NonNullable<ManagerBriefV1['campaignFocus']>; sourceHealth: ManagerSourceHealth[] } | null {
  if (campaigns.length === 0) return null;
  const selected = resolveCampaignFocusByReleaseDate(
    campaigns.map((candidate) => ({
      id: candidate.workspaceId,
      name: candidate.name,
      releaseDate: candidate.mission ? missionReleaseDateKey(candidate.mission) : undefined,
      primary: candidate.primary,
    })),
    now,
  );
  const campaign = campaigns.find((candidate) => candidate.workspaceId === selected?.id)
    ?? campaigns.find((candidate) => candidate.primary)
    ?? campaigns[0]!;
  const label = selected?.label ?? 'Release date needed';
  const campaignWindow = campaign.mission ? missionCampaignWindow(campaign.mission) : undefined;
  const missionUpdatedAt = campaign.mission?.updatedAt;
  const missionHealth = sourceHealth({
    source: `${campaign.workspaceId}:mission-brief`,
    present: Boolean(campaign.mission),
    parseOk: Boolean(campaign.mission),
    observedAt: missionUpdatedAt,
    staleDays: 30,
    now,
    staleMessage: 'Focused campaign brief is older than 30 days.',
  });

  return {
    focus: {
      workspaceId: campaign.workspaceId,
      name: cap(campaign.mission?.title, 120) ?? cap(campaign.name, 120) ?? 'Campaign',
      label,
      startDate: campaignWindow?.startDate,
      releaseDate: selected?.id === campaign.workspaceId ? selected.releaseDate : undefined,
      finishDate: campaignWindow?.finishDate,
      dateStatuses: campaignWindow?.statuses,
      goal: cap(campaign.mission?.goal, 500),
      releaseReadiness: normalizeManagerReleaseReadiness(campaign.releaseReadiness),
      readiness: campaign.readiness ? { done: campaign.readiness.done, total: campaign.readiness.total } : undefined,
      nextMissing: campaign.readiness?.nextMissing.map((item) => cap(item, 120)).filter(isString).slice(0, 5),
      source: sourceRef(campaign.workspaceId, 'mission-brief', missionUpdatedAt),
    },
    sourceHealth: dedupeHealth([missionHealth, ...campaign.sourceHealth]),
  };
}

const BRIEF_TIMELINE_WINDOW_DAYS = 90;
const BRIEF_TIMELINE_ENTRY_LIMIT = 10;
const BRIEF_TIMELINE_ROLLUP_LIMIT = 5;
const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The brief's `### Timeline` section (spec 20 §9): strategic entries for the
 * next 90 days from the HQ stores the composer already receives, per-campaign
 * operational roll-ups from the snapshot summaries, and the beyond-window
 * synopsis so later-year releases stay visible as one line.
 *
 * Campaign snapshots carry normalized, payload-free timeline entries. That
 * lets the brief include strategic deadlines/approvals and exact 90-day
 * roll-ups without injecting execution payloads or rereading campaign files.
 */
function buildBriefTimeline(
  input: BuildManagerBriefInput,
  docs: LoadedContextDoc[],
  docBySlug: Map<string, LoadedContextDoc>,
  now: Date,
): ManagerBriefV1['timeline'] {
  const timezone = input.timezone ?? 'UTC';
  const from = dateKeyInTimezone(now.toISOString(), timezone) ?? now.toISOString().slice(0, 10);
  const to = addDaysToDateKey(from, BRIEF_TIMELINE_WINDOW_DAYS);

  const calendar = parseArtistCalendarDocResult(docBySlug.get(ARTIST_CALENDAR_CONTEXT_SLUG));
  const work = parseScheduledWorkDocResult(docBySlug.get(SCHEDULED_WORK_CONTEXT_SLUG), input.workspaceId);

  // Goal eligibility per spec §3: Pulse goals only, with generated state and
  // shared-intel docs excluded by slug so they can never masquerade as goals.
  const goals = docs
    .filter((doc) =>
      doc.metadata.status !== undefined
      && doc.metadata.status !== 'done'
      && typeof doc.metadata.deadline === 'string'
      && DATE_KEY_REGEX.test(doc.metadata.deadline)
      && !isSharedIntelContextSlug(doc.slug)
      && doc.slug !== HQ_STATE_CONTEXT_SLUG
      && doc.slug !== CAMPAIGN_STATE_CONTEXT_SLUG)
    .map((doc) => ({
      slug: doc.slug,
      title: doc.metadata.name.trim() || doc.slug,
      deadline: doc.metadata.deadline!,
      workspaceId: input.workspaceId,
    }));

  const result = buildArtistTimeline({
    now,
    from,
    to,
    timezone,
    hqWorkspaceId: input.workspaceId,
    hqEvents: calendar.ok ? calendar.calendar.events : [],
    hqOrders: work.ok ? work.work.items : [],
    campaigns: input.relatedCampaigns.map((campaign) => {
      const window = campaign.mission ? missionCampaignWindow(campaign.mission) : undefined;
      return {
        workspaceId: campaign.workspaceId,
        label: campaign.name,
        startDate: window?.startDate,
        releaseDate: campaign.mission ? missionReleaseDateKey(campaign.mission) : undefined,
        finishDate: window?.finishDate,
        dateStatuses: window?.statuses,
        items: [],
        orders: [],
      };
    }),
    goals,
    tiers: ['strategic'],
  });

  const snapshotEntries = input.relatedCampaigns.flatMap((campaign) => campaign.timelineEntries ?? []);
  const strategicEntries = dedupeTimelineEntries([
    ...result.entries,
    ...snapshotEntries.filter((entry) => entry.tier === 'strategic' && entry.date >= from && entry.date <= to),
  ])
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey) || left.id.localeCompare(right.id))
    .slice(0, BRIEF_TIMELINE_ENTRY_LIMIT);

  const rollups = input.relatedCampaigns
    .map((campaign) => {
      const entries = (campaign.timelineEntries ?? []).filter((entry) => entry.date >= from && entry.date <= to);
      if (campaign.timelineEntries) {
        return {
          label: cap(campaign.name, 80) ?? campaign.workspaceId,
          scheduled: entries.filter((entry) => entry.tier === 'operational').length,
          needsAttention: entries.filter((entry) => entry.needsAttention).length,
        };
      }
      // Compatibility for callers that have not yet adopted normalized
      // snapshots. Production snapshots always take the exact branch above.
      return {
        label: cap(campaign.name, 80) ?? campaign.workspaceId,
        scheduled: Math.max(campaign.calendar?.active ?? 0, campaign.work?.active ?? 0),
        needsAttention: Math.max(campaign.calendar?.blocked ?? 0, campaign.work?.blocked ?? 0),
      };
    })
    .filter((rollup) => rollup.scheduled > 0 || rollup.needsAttention > 0)
    .slice(0, BRIEF_TIMELINE_ROLLUP_LIMIT);

  const canonicalMilestoneIds = new Set(input.relatedCampaigns.flatMap((campaign) => [
    `campaign-start:${campaign.workspaceId}`,
    `release:${campaign.workspaceId}`,
    `campaign-finish:${campaign.workspaceId}`,
  ]));
  const extraBeyond = dedupeTimelineEntries(snapshotEntries.filter((entry) =>
    entry.tier === 'strategic'
    && entry.date > to
    && !canonicalMilestoneIds.has(entry.id)))
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const beyond = {
    strategic: result.beyondWindow.strategic + extraBeyond.length,
    ...earliestDate(result.beyondWindow.nextDate, extraBeyond[0]?.date),
  };

  if (strategicEntries.length === 0 && rollups.length === 0 && beyond.strategic === 0) {
    return undefined;
  }
  return {
    from,
    to,
    entries: strategicEntries.map((entry) => ({
      date: entry.date,
      ...(entry.time ? { time: entry.time } : {}),
      title: cap(entry.title, 120) ?? 'Untitled',
      category: entry.category,
      workspaceId: entry.origin.workspaceId,
      ...(entry.stale ? { stale: true } : {}),
    })),
    rollups,
    beyond,
  };
}

function dedupeTimelineEntries<T extends { id: string }>(entries: T[]): T[] {
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function earliestDate(left?: string, right?: string): { nextDate?: string } {
  const nextDate = [left, right].filter(isString).sort()[0];
  return nextDate ? { nextDate } : {};
}

export function renderManagerBriefPromptSection(brief: ManagerBriefV1, options: { includeRecommendations?: boolean } = {}): string {
  const lines: string[] = [
    '## Manager Brief',
    '',
    `Revision: ${brief.revision}`,
  ];
  const identity = brief.identity;
  if (identity.artistName) lines.push(`Artist: ${identity.artistName}`);
  if (identity.mission) lines.push(`Mission: ${identity.mission}`);
  if (identity.sound) lines.push(`Sound: ${identity.sound}`);
  if (identity.audience) lines.push(`Audience: ${identity.audience}`);
  if (identity.operatingRules?.length) lines.push(`Operating rules: ${identity.operatingRules.join('; ')}`);

  const campaign = brief.campaignFocus;
  if (campaign) {
    lines.push('', '### Campaign Focus', `${campaign.label}: ${campaign.name}`);
    if (campaign.startDate) lines.push(`Campaign start: ${campaign.startDate} (${campaign.dateStatuses?.start ?? 'target'})`);
    if (campaign.releaseDate) lines.push(`Release date: ${campaign.releaseDate} (${campaign.dateStatuses?.release ?? 'target'})`);
    if (campaign.finishDate) lines.push(`Campaign finish: ${campaign.finishDate} (${campaign.dateStatuses?.finish ?? 'target'})`);
    if (campaign.goal) lines.push(`Goal: ${campaign.goal}`);
    if (!campaign.releaseReadiness && campaign.readiness) lines.push(`Essentials marked done: ${campaign.readiness.done}/${campaign.readiness.total} (not approved Release Kit evidence)`);
    if (!campaign.releaseReadiness && campaign.nextMissing?.length) lines.push(`Essentials marked needed: ${campaign.nextMissing.join(', ')}`);
    lines.push(...renderManagerReleaseReadiness(campaign.releaseReadiness));
    lines.push(`Source: ${formatSource(campaign.source)}`);
  }

  const operating = brief.operatingState;
  if (operating.nextMove || operating.blockers.length || operating.attention.length || operating.activeWork.length) {
    lines.push('', '### HQ / Career Operating State', 'HQ profile, Vault and career gaps are not campaign release blockers.');
    if (operating.nextMove && options.includeRecommendations !== false) {
      lines.push(`Next move: ${operating.nextMove.title}`);
      lines.push(`Why: ${operating.nextMove.why}`);
      if (operating.nextMove.worker) lines.push(`Worker: @${operating.nextMove.worker}`);
    }
    if (operating.blockers.length) lines.push(`HQ context gaps: ${operating.blockers.join(' | ')}`);
    if (operating.attention.length) lines.push(`Attention: ${operating.attention.join(' | ')}`);
    if (operating.activeWork.length) lines.push(`Active work: ${operating.activeWork.join(' | ')}`);
  }

  const warnings = brief.sourceHealth.filter((item) => item.status !== 'fresh');
  if (warnings.length) {
    lines.push('', '### Source Health');
    for (const item of warnings) lines.push(`- ${item.source}: ${item.status}${item.message ? ` — ${item.message}` : ''}`);
  }

  const timeline = brief.timeline;
  if (timeline && (timeline.entries.length || timeline.rollups.length || timeline.beyond.strategic > 0)) {
    lines.push('', '### Timeline', `Window: ${timeline.from} to ${timeline.to}`);
    for (const entry of timeline.entries) {
      lines.push(`- ${entry.date}${entry.time ? ` ${entry.time}` : ''}: ${entry.title} [${entry.category}]${entry.stale ? ' [stale]' : ''}`);
    }
    for (const rollup of timeline.rollups) {
      lines.push(`- ${rollup.label}: ${rollup.scheduled} scheduled${rollup.needsAttention ? `, ${rollup.needsAttention} need attention` : ''}`);
    }
    if (timeline.beyond.strategic > 0) {
      lines.push(`Beyond: ${timeline.beyond.strategic} strategic date${timeline.beyond.strategic === 1 ? '' : 's'} later${timeline.beyond.nextDate ? ` (next ${timeline.beyond.nextDate})` : ''}`);
    }
  }

  if (brief.trajectory.length) {
    lines.push('', '### Release Horizon');
    for (const item of brief.trajectory) {
      lines.push(`- ${item.month}: ${item.title} [${item.event}]${item.keyGoal ? ` — ${item.keyGoal}` : ''}`);
    }
  }

  if (brief.growth.spotify || brief.growth.instagram) {
    lines.push('', '### Growth', 'Catalog and audience performance; not evidence that this campaign is release-ready.');
    if (brief.growth.spotify) lines.push(renderGrowth('Spotify', brief.growth.spotify));
    if (brief.growth.instagram) lines.push(renderGrowth('Instagram', brief.growth.instagram));
  }

  if (brief.intelligence.length) {
    lines.push('', '### Intelligence');
    for (const item of brief.intelligence) {
      lines.push(`- ${item.title} (${item.confidence}): ${item.summary}${item.whyItMatters ? ` Why it matters: ${item.whyItMatters}` : ''}`);
    }
  }
  return lines.join('\n').trim();
}

function finalizeBudget(source: ManagerBriefV1): ManagerBriefV1 {
  const brief = structuredClone(source);
  const removeLowestPriorityItem = (): boolean => {
    if (brief.operatingState.activeWork.length) return Boolean(brief.operatingState.activeWork.pop());
    if (brief.operatingState.attention.length) return Boolean(brief.operatingState.attention.pop());
    if (brief.intelligence.length) return Boolean(brief.intelligence.pop());
    if ((brief.growth.instagram?.highlights.length ?? 0) > 0) return Boolean(brief.growth.instagram!.highlights.pop());
    if ((brief.growth.spotify?.highlights.length ?? 0) > 0) return Boolean(brief.growth.spotify!.highlights.pop());
    // Timeline degrades internally, then drops whole — always before trajectory
    // (spec 20 §9): roll-ups first, then entries beyond 30 days farthest-first,
    // then the section including its near entries and beyond-window line.
    if (brief.timeline?.rollups.length) return Boolean(brief.timeline.rollups.pop());
    if (brief.timeline) {
      const nearThreshold = addDaysToDateKey(brief.timeline.from, 30);
      const farthest = brief.timeline.entries.at(-1);
      if (farthest && farthest.date > nearThreshold) return Boolean(brief.timeline.entries.pop());
      brief.timeline = undefined;
      return true;
    }
    if (brief.trajectory.length) return Boolean(brief.trajectory.pop());
    if (brief.growth.instagram) { brief.growth.instagram = undefined; return true; }
    if (brief.growth.spotify) { brief.growth.spotify = undefined; return true; }
    if (brief.operatingState.blockers.length) return Boolean(brief.operatingState.blockers.pop());
    if (brief.operatingState.nextMove) { brief.operatingState.nextMove = undefined; return true; }
    if (omitLastReleaseEssential(brief.campaignFocus?.releaseReadiness)) return true;
    return false;
  };

  brief.revision = managerBriefRevision(brief);
  let rendered = renderManagerBriefPromptSection(brief);
  while (rendered.length > MANAGER_BRIEF_MAX_CHARS && removeLowestPriorityItem()) {
    brief.budget.truncated = true;
    brief.revision = managerBriefRevision(brief);
    rendered = renderManagerBriefPromptSection(brief);
  }
  if (brief.budget.truncated) {
    brief.sourceHealth = dedupeHealth([...brief.sourceHealth, {
      source: 'manager-brief-budget',
      status: 'partial',
      message: 'Lower-priority brief items were omitted to stay within the prompt budget.',
    }]);
    brief.revision = managerBriefRevision(brief);
    rendered = renderManagerBriefPromptSection(brief);
    while (rendered.length > MANAGER_BRIEF_MAX_CHARS && removeLowestPriorityItem()) {
      brief.revision = managerBriefRevision(brief);
      rendered = renderManagerBriefPromptSection(brief);
    }
  }
  brief.budget.actualChars = rendered.length;
  return brief;
}

function managerBriefRevision(brief: ManagerBriefV1): string {
  const stable = stableStringify({
    identity: brief.identity,
    trajectory: brief.trajectory,
    timeline: brief.timeline,
    campaignFocus: brief.campaignFocus,
    growth: brief.growth,
    intelligence: brief.intelligence,
    operatingState: brief.operatingState,
    sourceHealth: brief.sourceHealth.map(({ source, status, observedAt, staleAfter, message }) => ({ source, status, observedAt, staleAfter, message })),
  });
  return `manager-v1:fnv1a:${fnv1a(stable)}`;
}

function spotifySignal(workspaceId: string, snapshot: ArtistSpotifySnapshot): ManagerGrowthSignal {
  const points = snapshot.dailyStreams ?? [];
  const delta = points.length >= 2 ? points.at(-1)!.streams - points[0]!.streams : undefined;
  return {
    asOf: snapshot.snapshotDate,
    windowDays: snapshot.windowDays,
    primaryMetric: 'streams',
    value: snapshot.metrics.streams,
    delta,
    highlights: [
      metricHighlight(snapshot.metrics.listeners, 'listeners'),
      metricHighlight(snapshot.metrics.followers, 'followers'),
      snapshot.tracks?.[0]?.name ? `Top track: ${snapshot.tracks[0].name}` : undefined,
    ].filter(isString).slice(0, 3),
    partial: Boolean(snapshot.partial || snapshot.errors?.length),
    source: sourceRef(workspaceId, ARTIST_SPOTIFY_SNAPSHOT_CONTEXT_SLUG, snapshot.updatedAt),
  };
}

function instagramSignal(workspaceId: string, snapshot: ArtistInstagramSnapshot): ManagerGrowthSignal {
  return {
    asOf: snapshot.snapshotDate,
    windowDays: snapshot.windowDays,
    primaryMetric: 'follower change',
    value: snapshot.metrics.followers,
    delta: snapshot.metrics.followerDelta,
    highlights: [
      metricHighlight(snapshot.metrics.accountsReached, 'accounts reached'),
      metricHighlight(snapshot.metrics.interactions, 'interactions'),
      metricHighlight(snapshot.metrics.comments, 'comments'),
    ].filter(isString).slice(0, 3),
    partial: Boolean(snapshot.partial || snapshot.errors?.length),
    source: sourceRef(workspaceId, ARTIST_INSTAGRAM_SNAPSHOT_CONTEXT_SLUG, snapshot.updatedAt),
  };
}

function operationalHealth(input: BuildManagerBriefInput): ManagerSourceHealth[] {
  return (input.operational?.sourceHealth ?? []).map((item) => ({
    source: `operational:${item.source}`,
    status: item.status === 'fresh' ? 'fresh' : item.status === 'unavailable' ? 'unavailable' : 'partial',
    // checkedAt is diagnostic runtime noise, not artist truth. Including it in
    // the brief would churn the revision on every read even when nothing changed.
    observedAt: item.latestDataAt,
    message: cap(item.message, 220),
  }));
}

function sourceHealth(input: {
  source: string;
  present: boolean;
  parseOk: boolean;
  partial?: boolean;
  observedAt?: string;
  staleDays: number;
  now: Date;
  malformedMessage?: string;
  partialMessage?: string;
  staleMessage?: string;
}): ManagerSourceHealth {
  if (!input.present) return { source: input.source, status: 'unavailable', message: 'No source available.' };
  if (!input.parseOk) return { source: input.source, status: 'malformed', message: cap(input.malformedMessage, 220) };
  const observedAt = normalizeObservation(input.observedAt);
  if (input.partial) return { source: input.source, status: 'partial', observedAt, message: cap(input.partialMessage, 220) };
  if (!observedAt) return { source: input.source, status: 'partial', message: 'Source timestamp is missing or invalid.' };
  const staleAfter = new Date(Date.parse(observedAt) + input.staleDays * DAY_MS).toISOString();
  return {
    source: input.source,
    status: input.now.getTime() > Date.parse(staleAfter) ? 'stale' : 'fresh',
    observedAt,
    staleAfter,
    message: input.now.getTime() > Date.parse(staleAfter) ? input.staleMessage : undefined,
  };
}

function sourceRef(workspaceId: string, contextSlug: string, updatedAt?: string): ManagerSourceRef {
  return { workspaceId, contextSlug, updatedAt: normalizeObservation(updatedAt) };
}

function isMonthInRollingWindow(month: string, now: Date): boolean {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  return rollingMonthKeys(now).includes(month);
}

function intelScore(updatedAt: string, confidence: 'high' | 'medium' | 'low', now: Date): number {
  const age = Math.max(0, Math.floor((now.getTime() - Date.parse(updatedAt)) / DAY_MS));
  const confidenceScore = confidence === 'high' ? 30 : confidence === 'medium' ? 20 : 10;
  return confidenceScore + Math.max(0, 30 - age) - (age > 30 ? age : 0);
}

function splitRules(value: unknown): string[] {
  const text = cap(value, 600);
  if (!text) return [];
  return text.split(/\n|;|\s+\|\s+/).map((item) => cap(item, 180)).filter(isString);
}

function renderGrowth(label: string, signal: ManagerGrowthSignal): string {
  const value = typeof signal.value === 'number' ? ` ${formatNumber(signal.value)}` : '';
  const delta = typeof signal.delta === 'number' ? `, delta ${signal.delta >= 0 ? '+' : ''}${formatNumber(signal.delta)}` : '';
  const highlights = signal.highlights.length ? ` — ${signal.highlights.join('; ')}` : '';
  return `- ${label} (${signal.asOf}): ${signal.primaryMetric}${value}${delta}${signal.partial ? ' [partial]' : ''}${highlights}`;
}

function metricHighlight(value: number | undefined, label: string): string | undefined {
  return typeof value === 'number' ? `${formatNumber(value)} ${label}` : undefined;
}

function formatSource(source: ManagerSourceRef): string {
  return [source.workspaceId, source.contextSlug, source.entityId].filter(Boolean).join('/');
}

function normalizeObservation(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
}

function cap(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const boundary = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('; '), slice.lastIndexOf(', '), slice.lastIndexOf(' '));
  return `${slice.slice(0, boundary > max * 0.55 ? boundary : max - 1).trimEnd()}…`;
}

function dedupeHealth(items: ManagerSourceHealth[]): ManagerSourceHealth[] {
  const bySource = new Map<string, ManagerSourceHealth>();
  const rank = { malformed: 5, unavailable: 4, partial: 3, stale: 2, fresh: 1 } as const;
  for (const item of items) {
    const normalized = {
      ...item,
      source: cap(item.source, 120) ?? 'unknown',
      message: cap(item.message, 220),
    };
    const existing = bySource.get(normalized.source);
    if (!existing || rank[normalized.status] > rank[existing.status]) bySource.set(normalized.source, normalized);
  }
  return [...bySource.values()]
    .sort((left, right) => rank[right.status] - rank[left.status] || left.source.localeCompare(right.source))
    .slice(0, 12);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}

/** Optional for cached v1 briefs; invalid sections remain unknown, never zero-ready claims. */
export function normalizeManagerReleaseReadiness(value: unknown): ManagerReleaseReadiness | undefined {
  if (value === undefined) return undefined;
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item);
  const count = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0;
  const status = (item: unknown) => item === 'available' || item === 'unavailable' || item === 'malformed';
  const unknown: ManagerReleaseReadiness = {
    kit: { status: 'malformed', categories: [] },
    essentials: { status: 'malformed', done: 0, total: 0, items: [], omitted: 0 },
  };
  if (!record(value)) return unknown;
  const kit = value.kit;
  if (record(kit) && status(kit.status)) {
    if (kit.status !== 'available') unknown.kit.status = kit.status as 'unavailable' | 'malformed';
    else if (Array.isArray(kit.categories) && kit.categories.length <= 5 && kit.categories.every((item) => record(item)
      && Boolean(cap(item.label, 80)) && ['ready', 'needsReview', 'missing', 'restricted'].every((key) => count(item[key])))) {
      unknown.kit = {
        status: 'available', updatedAt: cap(kit.updatedAt, 40),
        categories: kit.categories.map((item) => ({ label: cap(item.label, 80)!, ready: item.ready, needsReview: item.needsReview, missing: item.missing, restricted: item.restricted })),
      };
    }
  }
  const essentials = value.essentials;
  if (record(essentials) && status(essentials.status)) {
    if (essentials.status !== 'available') unknown.essentials.status = essentials.status as 'unavailable' | 'malformed';
    else if (count(essentials.done) && count(essentials.total) && essentials.done <= essentials.total && count(essentials.omitted)
      && Array.isArray(essentials.items) && essentials.items.length <= essentials.total
      && essentials.items.every((item) => record(item) && Boolean(cap(item.label, 80)) && Boolean(cap(item.status, 40)))) {
      const items = essentials.items.slice(0, 40).map((item) => ({ label: cap(item.label, 80)!, status: cap(item.status, 40)! }));
      unknown.essentials = { status: 'available', done: essentials.done, total: essentials.total, items,
        omitted: Math.max(essentials.total - items.length, essentials.omitted + essentials.items.length - items.length) };
    }
  }
  return unknown;
}

export function renderManagerReleaseReadiness(value: ManagerReleaseReadiness | undefined): string[] {
  const readiness = normalizeManagerReleaseReadiness(value);
  if (!readiness) return [];
  const { kit, essentials } = readiness;
  const lines = ['', '### Campaign Release Kit'];
  if (kit.status !== 'available') lines.push(`Kit inventory ${kit.status}; approved assets unknown.`);
  else {
    lines.push('Recorded approved-file inventory, not category completeness or verification of files on disk.');
    if (kit.updatedAt) lines.push(`Kit updated: ${kit.updatedAt}`);
    const empty = kit.categories.filter((item) => item.ready === 0).map((item) => item.label);
    if (empty.length) lines.push(`No usable approved files recorded for: ${empty.join('; ')}.`);
    for (const item of kit.categories) {
      const warnings = [item.needsReview ? `${item.needsReview} need review` : '', item.missing ? `${item.missing} snapshot files missing` : '', item.restricted ? `${item.restricted} restricted` : ''].filter(Boolean);
      lines.push(`- ${item.label}: ${item.ready} ready approved snapshots${warnings.length ? `; ${warnings.join('; ')}` : ''}`);
    }
    if (!kit.categories.length) lines.push('No category inventory supplied; approved assets unknown.');
    lines.push('A video need not be Spotify Canvas; a plan need not be the rollout plan. Use the named Essentials below.');
  }
  lines.push('', '### Campaign Essentials');
  if (essentials.status !== 'available') lines.push(`Essentials ${essentials.status}; completion unknown.`);
  else {
    lines.push(`${essentials.done}/${essentials.total} marked done on the checklist; this does not prove approved files are in the Kit.`);
    const labels: Record<string, string> = { done: 'Marked done', 'in-progress': 'In progress', review: 'In review', ready: 'Ready for review', needed: 'Needed' };
    const groups = new Map<string, string[]>();
    for (const item of essentials.items) groups.set(item.status, [...(groups.get(item.status) ?? []), item.label]);
    for (const [status, items] of groups) lines.push(`${labels[status] ?? `Status ${status}`}: ${items.join('; ')}`);
    if (essentials.omitted) lines.push(`${essentials.omitted} additional checklist items omitted; their individual status is not shown.`);
    if (!essentials.total) lines.push('No included checklist items recorded; release completeness is unknown.');
  }
  return lines;
}

/** Last resort after lower-priority context: retain totals and disclose each omitted item. */
export function omitLastReleaseEssential(value: ManagerReleaseReadiness | undefined): boolean {
  if (!value?.essentials.items.length) return false;
  value.essentials.items.pop();
  value.essentials.omitted += 1;
  return true;
}
