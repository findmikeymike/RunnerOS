import { CONCIERGE_SLUG } from '../agent-definitions/types.ts';
import type { MissionBrief } from '../artist-context/mission-brief.ts';
import type { ContextDocMetadata } from '../workspace-context/types.ts';
import {
  CAMPAIGN_STATE_CONTEXT_FENCE,
  CAMPAIGN_STATE_CONTEXT_SLUG,
  type BuildCampaignManagerBriefInput,
  type CampaignManagerBriefV1,
  type ManagerSourceHealth,
} from './types.ts';

export const CAMPAIGN_MANAGER_BRIEF_MAX_CHARS = 6000 as const;

export function campaignStateContextMetadata(): ContextDocMetadata {
  return {
    name: 'Campaign State of Play',
    description: 'Generated, bounded operating brief for the current campaign manager.',
    routing: { mode: 'targeted', agents: [CONCIERGE_SLUG] },
    enabled: true,
    delivery: 'always',
  };
}

export function buildCampaignManagerBrief(input: BuildCampaignManagerBriefInput): CampaignManagerBriefV1 {
  const mission = input.campaign.mission;
  const failures = (input.operational?.failures ?? []).map(formatOperational).slice(0, 3);
  const approvals = (input.operational?.approvals ?? []).map(formatOperational).slice(0, 3);
  const activeWork = (input.operational?.active ?? []).map(formatOperational).slice(0, 4);
  const blockers = [
    mission?.status === 'empty' || !mission ? 'Campaign mission is not defined.' : undefined,
    !mission?.releaseDate && !mission?.timeline ? 'Release date or timeline is not defined.' : undefined,
    ...(input.campaign.readiness?.nextMissing ?? []).slice(0, 4).map((item) => cap(`Missing: ${item}`, 220)),
    ...failures.map((item) => `Failed: ${item}`),
  ].filter(isString).slice(0, 6);

  const brief: CampaignManagerBriefV1 = {
    version: 1,
    workspaceId: input.campaign.workspaceId,
    artistWorkspaceId: input.artistWorkspaceId,
    revision: '',
    generatedAt: (input.now ?? new Date()).toISOString(),
    budget: { maxChars: CAMPAIGN_MANAGER_BRIEF_MAX_CHARS, actualChars: 0, truncated: false },
    artist: {
      artistName: input.artistBrief.identity.artistName,
      mission: cap(input.artistBrief.identity.mission, 360),
      sound: cap(input.artistBrief.identity.sound, 260),
      audience: cap(input.artistBrief.identity.audience, 260),
      trajectory: input.artistBrief.trajectory.slice(0, 4),
      growth: input.artistBrief.growth,
      intelligence: input.artistBrief.intelligence.slice(0, 2),
    },
    campaign: {
      name: cap(mission?.title, 120) ?? cap(input.campaign.name, 120) ?? 'Campaign',
      mission: mission ? compactMission(mission) : undefined,
      readiness: input.campaign.readiness ? {
        done: input.campaign.readiness.done,
        total: input.campaign.readiness.total,
        nextMissing: input.campaign.readiness.nextMissing.map((item) => cap(item, 120)).filter(isString).slice(0, 5),
      } : undefined,
      calendar: input.campaign.calendar,
      work: input.campaign.work,
      assets: input.campaign.assets,
      outputs: input.campaign.outputs,
      calendarHighlights: (input.campaign.calendarHighlights ?? []).slice(0, 5).map((item) => ({ ...item, title: cap(item.title, 160) ?? 'Untitled item' })),
      workHighlights: (input.campaign.workHighlights ?? []).slice(0, 5).map((item) => ({ ...item, title: cap(item.title, 160) ?? 'Untitled work' })),
      essentialAssets: (input.campaign.essentialAssets ?? []).slice(0, 5).map((item) => ({ ...item, label: cap(item.label, 100) ?? 'Asset' })),
      outputHighlights: (input.campaign.outputHighlights ?? []).slice(0, 4).map((item) => ({ ...item, title: cap(item.title, 160) ?? 'Untitled output' })),
    },
    operatingState: {
      approvals,
      failures,
      activeWork,
      blockers,
      suggestedFocus: cap(suggestedFocus(mission?.completeness, approvals, failures, blockers, activeWork), 260),
    },
    sourceHealth: dedupeHealth([...input.artistBrief.sourceHealth, ...input.campaign.sourceHealth]).slice(0, 8),
  };
  return finalizeBudget(brief);
}

export function renderCampaignManagerBriefPromptSection(brief: CampaignManagerBriefV1): string {
  const lines = [
    '## Campaign Manager Brief',
    '',
    `Revision: ${brief.revision}`,
    `Campaign: ${brief.campaign.name}`,
  ];
  if (brief.artist.artistName) lines.push(`Artist: ${brief.artist.artistName}`);
  if (brief.artist.mission) lines.push(`Artist mission: ${brief.artist.mission}`);
  if (brief.artist.sound) lines.push(`Sound: ${brief.artist.sound}`);
  if (brief.artist.audience) lines.push(`Audience: ${brief.artist.audience}`);

  const mission = brief.campaign.mission;
  if (mission) {
    if (mission.missionType) lines.push(`Release type: ${mission.missionType}`);
    if (mission.campaignStartDate) lines.push(`Campaign start: ${mission.campaignStartDate} (${mission.campaignDateStatuses?.start ?? 'target'})`);
    if (mission.releaseDate) lines.push(`Release date: ${mission.releaseDate} (${mission.campaignDateStatuses?.release ?? 'target'})`);
    else if (mission.timeline) lines.push(`Timeline: ${mission.timeline}`);
    if (mission.campaignFinishDate) lines.push(`Campaign finish: ${mission.campaignFinishDate} (${mission.campaignDateStatuses?.finish ?? 'target'})`);
    if (mission.goal) lines.push(`Campaign goal: ${mission.goal}`);
    if (mission.targetListener) lines.push(`Target listener: ${mission.targetListener}`);
    if (mission.mood) lines.push(`Mood: ${mission.mood}`);
    if (mission.visualWorld) lines.push(`Visual world: ${mission.visualWorld}`);
    if (mission.channels?.length) lines.push(`Channels: ${mission.channels.join(', ')}`);
    lines.push(`Mission completeness: ${mission.completeness}%`);
  }
  if (brief.campaign.readiness) {
    lines.push(`Release readiness: ${brief.campaign.readiness.done}/${brief.campaign.readiness.total}`);
    if (brief.campaign.readiness.nextMissing.length) lines.push(`Next missing: ${brief.campaign.readiness.nextMissing.join(', ')}`);
  }
  if (brief.campaign.essentialAssets.length) {
    lines.push(`Essential assets: ${brief.campaign.essentialAssets.map((item) => `${item.label} ${item.available ? 'ready' : 'missing'}`).join('; ')}`);
  }

  const state = brief.operatingState;
  if (state.suggestedFocus || state.blockers.length || state.approvals.length || state.activeWork.length) {
    lines.push('', '### Operating State');
    if (state.suggestedFocus) lines.push(`Suggested focus: ${state.suggestedFocus}`);
    if (state.blockers.length) lines.push(`Blockers: ${state.blockers.join(' | ')}`);
    if (state.approvals.length) lines.push(`Awaiting approval: ${state.approvals.join(' | ')}`);
    if (state.activeWork.length) lines.push(`Active work: ${state.activeWork.join(' | ')}`);
  }
  const upcomingCalendar = brief.campaign.calendarHighlights.filter((item) => item.timing !== 'overdue');
  const overdueCalendar = brief.campaign.calendarHighlights.filter((item) => item.timing === 'overdue');
  if (upcomingCalendar.length) {
    lines.push('', '### Upcoming Calendar');
    for (const item of upcomingCalendar) lines.push(`- ${item.date}: ${item.title} [${item.status}]`);
  }
  if (overdueCalendar.length) {
    lines.push('', '### Overdue Calendar');
    for (const item of overdueCalendar) lines.push(`- ${item.date}: ${item.title} [${item.status}]`);
  }
  const upcomingWork = brief.campaign.workHighlights.filter((item) => item.timing !== 'overdue');
  const overdueWork = brief.campaign.workHighlights.filter((item) => item.timing === 'overdue');
  if (upcomingWork.length) {
    lines.push('', '### Upcoming Work');
    for (const item of upcomingWork) lines.push(`- ${item.startAt}: ${item.title} [${item.status}]`);
  }
  if (overdueWork.length) {
    lines.push('', '### Overdue Work');
    for (const item of overdueWork) lines.push(`- ${item.startAt}: ${item.title} [${item.status}]`);
  }
  if (brief.artist.trajectory.length) {
    lines.push('', '### Artist Horizon');
    for (const item of brief.artist.trajectory) lines.push(`- ${item.month}: ${item.title} [${item.event}]`);
  }
  if (brief.artist.intelligence.length) {
    lines.push('', '### Relevant Intelligence');
    for (const item of brief.artist.intelligence) lines.push(`- ${item.title}: ${item.summary}`);
  }
  const warnings = brief.sourceHealth.filter((item) => item.status !== 'fresh');
  if (warnings.length) {
    lines.push('', '### Source Health');
    for (const item of warnings) lines.push(`- ${item.source}: ${item.status}${item.message ? ` — ${item.message}` : ''}`);
  }
  return lines.join('\n').trim();
}

export function serializeCampaignManagerBrief(brief: CampaignManagerBriefV1): string {
  return `\`\`\`${CAMPAIGN_STATE_CONTEXT_FENCE}\n${JSON.stringify(brief, null, 2)}\n\`\`\``;
}

export function parseCampaignManagerBrief(body: string): CampaignManagerBriefV1 | null {
  const match = body.match(new RegExp(`\\\`\\\`\\\`${CAMPAIGN_STATE_CONTEXT_FENCE}\\s*([\\s\\S]*?)\\\`\\\`\\\``, 'i'));
  if (!match?.[1]) return null;
  try {
    const value: unknown = JSON.parse(match[1]);
    if (!isCampaignManagerBrief(value)) return null;
    const rendered = renderCampaignManagerBriefPromptSection(value);
    // actualChars is persisted diagnostics, not an integrity boundary. Renderer
    // wording can evolve while an otherwise valid cached v1 brief remains usable.
    if (value.budget.actualChars > value.budget.maxChars || rendered.length > value.budget.maxChars) return null;
    if (revision(value) !== value.revision) return null;
    return value;
  } catch {
    return null;
  }
}

function isCampaignManagerBrief(value: unknown): value is CampaignManagerBriefV1 {
  if (!isRecord(value)) return false;
  if (
    value.version !== 1
    || !isNonEmptyString(value.workspaceId)
    || !isNonEmptyString(value.artistWorkspaceId)
    || !/^campaign-manager-v1:fnv1a:[0-9a-f]{8}$/.test(asString(value.revision))
    || !isValidTimestamp(value.generatedAt)
    || !isRecord(value.budget)
    || value.budget.maxChars !== CAMPAIGN_MANAGER_BRIEF_MAX_CHARS
    || !isNonNegativeFiniteNumber(value.budget.actualChars)
    || typeof value.budget.truncated !== 'boolean'
  ) return false;

  if (!isRecord(value.artist)) return false;
  if (!areOptionalStrings(value.artist, ['artistName', 'mission', 'sound', 'audience'])) return false;
  if (!Array.isArray(value.artist.trajectory) || !value.artist.trajectory.every(isTrajectoryItem)) return false;
  if (!isRecord(value.artist.growth) || !isOptionalGrowthSignal(value.artist.growth.spotify) || !isOptionalGrowthSignal(value.artist.growth.instagram)) return false;
  if (!Array.isArray(value.artist.intelligence) || !value.artist.intelligence.every(isIntelligenceItem)) return false;

  if (!isRecord(value.campaign) || !isNonEmptyString(value.campaign.name)) return false;
  if (value.campaign.mission !== undefined && !isMissionBrief(value.campaign.mission)) return false;
  if (value.campaign.readiness !== undefined && !isReadiness(value.campaign.readiness)) return false;
  for (const key of ['calendar', 'work', 'assets', 'outputs'] as const) {
    if (value.campaign[key] !== undefined && !isCollectionSummary(value.campaign[key])) return false;
  }
  if (!isArrayOf(value.campaign.calendarHighlights, isCalendarHighlight)) return false;
  if (!isArrayOf(value.campaign.workHighlights, isWorkHighlight)) return false;
  if (!isArrayOf(value.campaign.essentialAssets, isEssentialAsset)) return false;
  if (!isArrayOf(value.campaign.outputHighlights, isOutputHighlight)) return false;

  if (!isRecord(value.operatingState)) return false;
  if (!isStringArray(value.operatingState.approvals)
    || !isStringArray(value.operatingState.failures)
    || !isStringArray(value.operatingState.activeWork)
    || !isStringArray(value.operatingState.blockers)
    || !isOptionalString(value.operatingState.suggestedFocus)) return false;

  return isArrayOf(value.sourceHealth, isSourceHealth);
}

function isTrajectoryItem(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.month)
    && isNonEmptyString(value.title)
    && ['release', 'promotion', 'live', 'creation', 'business'].includes(asString(value.event))
    && isOptionalString(value.keyGoal)
    && isSourceRef(value.source);
}

function isGrowthSignal(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.asOf)
    && isNonEmptyString(value.primaryMetric)
    && isOptionalFiniteNumber(value.windowDays)
    && isOptionalFiniteNumber(value.value)
    && isOptionalFiniteNumber(value.delta)
    && isStringArray(value.highlights)
    && typeof value.partial === 'boolean'
    && isSourceRef(value.source);
}

function isOptionalGrowthSignal(value: unknown): boolean {
  return value === undefined || isGrowthSignal(value);
}

function isIntelligenceItem(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.summary)
    && isOptionalString(value.whyItMatters)
    && ['high', 'medium', 'low'].includes(asString(value.confidence))
    && isSourceRef(value.source);
}

function isSourceRef(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.workspaceId)
    && areOptionalStrings(value, ['contextSlug', 'entityType', 'entityId', 'updatedAt']);
}

function isMissionBrief(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.workspaceId) || !isNonEmptyString(value.status)) return false;
  if (!isNonNegativeFiniteNumber(value.completeness)) return false;
  if (!areOptionalStrings(value, ['missionType', 'title', 'goal', 'timeline', 'releaseDate', 'promoBudget', 'mood', 'visualWorld', 'targetListener', 'updatedAt'])) return false;
  if (value.channels !== undefined && !isStringArray(value.channels)) return false;
  if (value.openQuestions !== undefined && !isStringArray(value.openQuestions)) return false;
  return value.references === undefined || isArrayOf(value.references, (item) => (
    isRecord(item) && isNonEmptyString(item.type) && isNonEmptyString(item.value)
  ));
}

function isReadiness(value: unknown): boolean {
  return isRecord(value)
    && isNonNegativeFiniteNumber(value.done)
    && isNonNegativeFiniteNumber(value.total)
    && isStringArray(value.nextMissing);
}

function isCollectionSummary(value: unknown): boolean {
  return isRecord(value)
    && isNonNegativeFiniteNumber(value.total)
    && isOptionalFiniteNumber(value.active)
    && isOptionalFiniteNumber(value.blocked)
    && isOptionalFiniteNumber(value.completed)
    && isOptionalString(value.updatedAt);
}

function isCalendarHighlight(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.date)
    && isNonEmptyString(value.status)
    && (value.timing === undefined || ['upcoming', 'overdue'].includes(asString(value.timing)));
}

function isWorkHighlight(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.startAt)
    && isNonEmptyString(value.status)
    && (value.timing === undefined || ['upcoming', 'overdue'].includes(asString(value.timing)));
}

function isEssentialAsset(value: unknown): boolean {
  return isRecord(value) && isNonEmptyString(value.label) && typeof value.available === 'boolean';
}

function isOutputHighlight(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.title)
    && isNonEmptyString(value.status)
    && isNonEmptyString(value.updatedAt);
}

function isSourceHealth(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.source)
    && ['fresh', 'stale', 'partial', 'malformed', 'unavailable'].includes(asString(value.status))
    && isOptionalString(value.observedAt)
    && isOptionalString(value.staleAfter)
    && isOptionalString(value.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOf(value: unknown, predicate: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.every(predicate);
}

function isStringArray(value: unknown): value is string[] {
  return isArrayOf(value, isNonEmptyString);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function areOptionalStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => isOptionalString(value[key]));
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function isValidTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finalizeBudget(source: CampaignManagerBriefV1): CampaignManagerBriefV1 {
  const brief = structuredClone(source);
  const remove = (): boolean => {
    if (brief.campaign.outputHighlights.length) return Boolean(brief.campaign.outputHighlights.pop());
    if (brief.campaign.workHighlights.length) return Boolean(brief.campaign.workHighlights.pop());
    if (brief.campaign.calendarHighlights.length) return Boolean(brief.campaign.calendarHighlights.pop());
    if (brief.artist.intelligence.length) return Boolean(brief.artist.intelligence.pop());
    if (brief.artist.trajectory.length) return Boolean(brief.artist.trajectory.pop());
    if (brief.operatingState.activeWork.length) return Boolean(brief.operatingState.activeWork.pop());
    if (brief.sourceHealth.length > 4) return Boolean(brief.sourceHealth.pop());
    if (brief.operatingState.blockers.length > 2) return Boolean(brief.operatingState.blockers.pop());
    if (brief.operatingState.approvals.length > 2) return Boolean(brief.operatingState.approvals.pop());
    if (brief.operatingState.failures.length > 1) return Boolean(brief.operatingState.failures.pop());
    if (brief.campaign.essentialAssets.length > 3) return Boolean(brief.campaign.essentialAssets.pop());
    if (brief.sourceHealth.length > 2) return Boolean(brief.sourceHealth.pop());
    if (brief.operatingState.blockers.length > 1) return Boolean(brief.operatingState.blockers.pop());
    if (brief.artist.audience) { brief.artist.audience = undefined; return true; }
    if (brief.artist.sound) { brief.artist.sound = undefined; return true; }
    if (brief.campaign.mission?.visualWorld) { brief.campaign.mission.visualWorld = undefined; return true; }
    if (brief.campaign.mission?.mood) { brief.campaign.mission.mood = undefined; return true; }
    if (brief.campaign.mission?.targetListener) { brief.campaign.mission.targetListener = undefined; return true; }
    return false;
  };
  brief.revision = revision(brief);
  let rendered = renderCampaignManagerBriefPromptSection(brief);
  while (rendered.length > CAMPAIGN_MANAGER_BRIEF_MAX_CHARS && remove()) {
    brief.budget.truncated = true;
    brief.revision = revision(brief);
    rendered = renderCampaignManagerBriefPromptSection(brief);
  }
  brief.budget.actualChars = rendered.length;
  return brief;
}

function suggestedFocus(completeness: number | undefined, approvals: string[], failures: string[], blockers: string[], active: string[]): string | undefined {
  if (failures.length) return 'Resolve failed work before creating more dependencies.';
  if (approvals.length) return 'Clear pending approvals that are holding up the campaign.';
  if ((completeness ?? 0) < 70) return 'Clarify the campaign mission, date, audience, and creative world.';
  if (blockers.length) return blockers[0];
  if (active.length) return `Protect the current execution path: ${active[0]}`;
  return 'Choose the highest-leverage missing release-board item and assign it.';
}

function compactMission(mission: MissionBrief): MissionBrief {
  return {
    id: mission.id,
    workspaceId: mission.workspaceId,
    status: mission.status,
    completeness: mission.completeness,
    missionType: mission.missionType,
    title: cap(mission.title, 120),
    goal: cap(mission.goal, 500),
    timeline: cap(mission.timeline, 160),
    campaignStartDate: cap(mission.campaignStartDate, 40),
    releaseDate: cap(mission.releaseDate, 40),
    campaignFinishDate: cap(mission.campaignFinishDate, 40),
    campaignDateStatuses: mission.campaignDateStatuses,
    promoBudget: cap(mission.promoBudget, 100),
    mood: cap(mission.mood, 240),
    visualWorld: cap(mission.visualWorld, 360),
    references: mission.references?.slice(0, 5).map((item) => ({ type: item.type, value: cap(item.value, 140) ?? 'Reference' })),
    targetListener: cap(mission.targetListener, 300),
    channels: mission.channels?.map((item) => cap(item, 40)).filter(isString).slice(0, 8),
    openQuestions: mission.openQuestions?.map((item) => cap(item, 180)).filter(isString).slice(0, 4),
    updatedAt: mission.updatedAt,
  };
}

function formatOperational(item: { title: string; status: string }): string {
  return cap(`${item.title} — ${item.status}`, 220) ?? item.status;
}

function revision(brief: CampaignManagerBriefV1): string {
  const stable = JSON.stringify({ artist: brief.artist, campaign: brief.campaign, operatingState: brief.operatingState, sourceHealth: brief.sourceHealth });
  let hash = 0x811c9dc5;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `campaign-manager-v1:fnv1a:${hash.toString(16).padStart(8, '0')}`;
}

function dedupeHealth(items: ManagerSourceHealth[]): ManagerSourceHealth[] {
  const bySource = new Map<string, ManagerSourceHealth>();
  for (const item of items) {
    const normalized = { ...item, source: cap(item.source, 120) ?? 'unknown', message: cap(item.message, 220) };
    if (!bySource.has(normalized.source) || normalized.status !== 'fresh') bySource.set(normalized.source, normalized);
  }
  return [...bySource.values()];
}

function cap(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text || undefined;
}

function isString(value: string | undefined): value is string {
  return Boolean(value);
}
