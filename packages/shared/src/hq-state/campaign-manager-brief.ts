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
    if (mission.releaseDate) lines.push(`Release date: ${mission.releaseDate}`);
    else if (mission.timeline) lines.push(`Timeline: ${mission.timeline}`);
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
  if (brief.campaign.calendarHighlights.length) {
    lines.push('', '### Upcoming Calendar');
    for (const item of brief.campaign.calendarHighlights) lines.push(`- ${item.date}: ${item.title} [${item.status}]`);
  }
  if (brief.campaign.workHighlights.length) {
    lines.push('', '### Scheduled Work');
    for (const item of brief.campaign.workHighlights) lines.push(`- ${item.startAt}: ${item.title} [${item.status}]`);
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
    const value = JSON.parse(match[1]) as Partial<CampaignManagerBriefV1>;
    if (value.version !== 1 || !value.workspaceId || !value.artistWorkspaceId || !value.revision || !value.campaign) return null;
    return value as CampaignManagerBriefV1;
  } catch {
    return null;
  }
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
    releaseDate: cap(mission.releaseDate, 40),
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
