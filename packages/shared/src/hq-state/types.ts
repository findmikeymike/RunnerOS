import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import type { MissionBrief } from '../artist-context/mission-brief.ts';
import type { TimelineEntry, TimelineWarning } from './timeline.ts';

export const HQ_STATE_CONTEXT_SLUG = 'hq-state-of-play';
export const HQ_STATE_CONTEXT_FENCE = 'json hq-state-of-play';
export const CAMPAIGN_STATE_CONTEXT_SLUG = 'campaign-state-of-play';
export const CAMPAIGN_STATE_CONTEXT_FENCE = 'json campaign-state-of-play';

export const HQ_SOURCE_CONTEXT_SLUGS = {
  profile: 'artist-profile',
  spotify: 'artist-spotify-snapshot',
  network: 'artist-network',
  calendar: 'artist-calendar',
  community: 'artist-community',
  vault: 'artist-vault',
} as const;

export type HqStateAction =
  | 'draft'
  | 'review'
  | 'schedule'
  | 'research'
  | 'outreach'
  | 'refresh'
  | 'organize';

export interface HqStateRouteHint {
  target: 'agent' | 'manual';
  action: HqStateAction;
  prompt: string;
  confidence: 'high' | 'medium' | 'low';
  agentSlug?: string;
  contextDocSlugs: string[];
  blockedReason?: string;
}

export interface HqStateNextMove {
  recommendationId?: string;
  recommendationStatus?: HqRecommendationStatus;
  snoozedUntil?: string;
  title: string;
  why: string;
  worker?: string;
  action?: HqStateAction;
  oneClick?: boolean;
  route?: HqStateRouteHint;
  entityRef?: HqStateEntityRef;
  semanticIntentId?: string;
  /** True only when this move needs a user decision or intervention now. */
  attentionRequired?: boolean;
}

export type HqRecommendationStatus =
  | 'proposed'
  | 'viewed'
  | 'accepted'
  | 'launched'
  | 'in_progress'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'dismissed'
  | 'snoozed'
  | 'expired'
  | 'superseded';

export interface HqStateEntityRef {
  kind: HqOperationalItemKind;
  id: string;
  source: string;
  scope: HqOperationalScope;
}

export interface HqStateAttentionItem {
  kind: string;
  text: string;
  source: string;
}

export interface HqStateGoalProgress {
  goal: string;
  status: string;
  note: string;
  priority?: string;
  deadline?: string;
}

export type HqOperationalItemKind = 'output' | 'scheduled-work' | 'workflow-run' | 'automation-run';

export type HqOperationalScope =
  | { type: 'hq' }
  | { type: 'campaign'; campaignId: string };

export interface HqOperationalSourceHealth {
  source: 'outputs' | 'scheduled-work' | 'workflow-runs' | 'automation-history';
  status: 'fresh' | 'degraded' | 'unavailable';
  checkedAt: string;
  latestDataAt?: string;
  itemCount: number;
  message?: string;
}

export interface HqOperationalItem {
  id: string;
  kind: HqOperationalItemKind;
  title: string;
  status: string;
  updatedAt: string;
  expiresAt?: string;
  /** Scheduled start, when the item is scheduled work. Lets the brief render dated active work. */
  startAt?: string;
  dueAt?: string;
  scope: HqOperationalScope;
  fingerprint: string;
  semanticIntentId?: string;
  worker?: string;
  intent?: string;
  source: string;
}

export interface HqOperationalSnapshot {
  generatedAt: string;
  scope: HqOperationalScope;
  active: HqOperationalItem[];
  approvals: HqOperationalItem[];
  failures: HqOperationalItem[];
  recentOutputs: HqOperationalItem[];
  sourceHealth: HqOperationalSourceHealth[];
}

export interface ManagerSourceRef {
  workspaceId: string;
  contextSlug?: string;
  entityType?: string;
  entityId?: string;
  updatedAt?: string;
}

export interface ManagerSourceHealth {
  source: string;
  status: 'fresh' | 'stale' | 'partial' | 'malformed' | 'unavailable';
  observedAt?: string;
  staleAfter?: string;
  message?: string;
}

export interface ManagerCollectionSummary {
  total: number;
  active?: number;
  blocked?: number;
  completed?: number;
  updatedAt?: string;
}

export interface ManagerCampaignSnapshot {
  workspaceId: string;
  name: string;
  primary: boolean;
  mission?: MissionBrief;
  readiness?: { done: number; total: number; nextMissing: string[] };
  calendar?: ManagerCollectionSummary;
  work?: ManagerCollectionSummary;
  assets?: ManagerCollectionSummary;
  outputs?: ManagerCollectionSummary;
  calendarHighlights?: Array<{ title: string; date: string; status: string; timing?: 'upcoming' | 'overdue' }>;
  workHighlights?: Array<{ title: string; startAt: string; status: string; timing?: 'upcoming' | 'overdue' }>;
  essentialAssets?: Array<{ label: string; available: boolean }>;
  outputHighlights?: Array<{ title: string; status: string; updatedAt: string }>;
  /** Normalized, payload-free campaign dates used by the HQ timeline and brief. */
  timelineEntries?: TimelineEntry[];
  timelineWarnings?: TimelineWarning[];
  sourceHealth: ManagerSourceHealth[];
}

export interface CampaignManagerBriefV1 {
  version: 1;
  workspaceId: string;
  artistWorkspaceId: string;
  revision: string;
  generatedAt: string;
  budget: { maxChars: 6000; actualChars: number; truncated: boolean };
  artist: {
    artistName?: string;
    mission?: string;
    sound?: string;
    audience?: string;
    trajectory: ManagerBriefV1['trajectory'];
    growth: ManagerBriefV1['growth'];
    intelligence: ManagerBriefV1['intelligence'];
  };
  campaign: {
    name: string;
    mission?: MissionBrief;
    readiness?: ManagerCampaignSnapshot['readiness'];
    calendar?: ManagerCollectionSummary;
    work?: ManagerCollectionSummary;
    assets?: ManagerCollectionSummary;
    outputs?: ManagerCollectionSummary;
    calendarHighlights: NonNullable<ManagerCampaignSnapshot['calendarHighlights']>;
    workHighlights: NonNullable<ManagerCampaignSnapshot['workHighlights']>;
    essentialAssets: NonNullable<ManagerCampaignSnapshot['essentialAssets']>;
    outputHighlights: NonNullable<ManagerCampaignSnapshot['outputHighlights']>;
  };
  operatingState: {
    approvals: string[];
    failures: string[];
    activeWork: string[];
    blockers: string[];
    suggestedFocus?: string;
  };
  sourceHealth: ManagerSourceHealth[];
}

export interface BuildCampaignManagerBriefInput {
  artistWorkspaceId: string;
  artistBrief: ManagerBriefV1;
  campaign: ManagerCampaignSnapshot;
  operational?: HqOperationalSnapshot;
  now?: Date;
}

export interface ManagerGrowthSignal {
  asOf: string;
  windowDays?: number;
  primaryMetric: string;
  value?: number;
  delta?: number;
  highlights: string[];
  partial: boolean;
  source: ManagerSourceRef;
}

export interface ManagerBriefV1 {
  version: 1;
  workspaceId: string;
  revision: string;
  generatedAt: string;
  budget: {
    maxChars: 8000;
    actualChars: number;
    truncated: boolean;
  };
  identity: {
    artistName?: string;
    mission?: string;
    sound?: string;
    audience?: string;
    operatingRules?: string[];
  };
  trajectory: Array<{
    month: string;
    title: string;
    event: 'release' | 'promotion' | 'live' | 'creation' | 'business';
    keyGoal?: string;
    source: ManagerSourceRef;
  }>;
  /**
   * Unified timeline (spec 20 §9): strategic dated entries for the window plus
   * per-campaign operational roll-ups and a beyond-window synopsis. Optional so
   * persisted pre-timeline briefs keep parsing.
   */
  timeline?: {
    from: string;
    to: string;
    entries: Array<{
      date: string;
      time?: string;
      title: string;
      category: string;
      workspaceId: string;
      stale?: boolean;
    }>;
    rollups: Array<{ label: string; scheduled: number; needsAttention: number }>;
    beyond: { strategic: number; nextDate?: string };
  };
  campaignFocus?: {
    workspaceId: string;
    name: string;
    label: 'Current campaign' | 'Next campaign' | 'Latest campaign' | 'Release date needed';
    startDate?: string;
    releaseDate?: string;
    finishDate?: string;
    dateStatuses?: { start?: 'target' | 'locked'; release?: 'target' | 'locked'; finish?: 'target' | 'locked' };
    goal?: string;
    readiness?: { done: number; total: number };
    nextMissing?: string[];
    source: ManagerSourceRef;
  };
  growth: {
    spotify?: ManagerGrowthSignal;
    instagram?: ManagerGrowthSignal;
  };
  intelligence: Array<{
    id: string;
    title: string;
    summary: string;
    whyItMatters?: string;
    confidence: 'high' | 'medium' | 'low';
    source: ManagerSourceRef;
  }>;
  operatingState: {
    nextMove?: { title: string; why: string; worker?: string };
    attention: string[];
    blockers: string[];
    activeWork: string[];
  };
  sourceHealth: ManagerSourceHealth[];
}

export interface BuildManagerBriefInput {
  workspaceId: string;
  docs: LoadedContextDoc[];
  relatedCampaigns: ManagerCampaignSnapshot[];
  operatingState?: {
    nextMove?: HqStateNextMove;
    attention?: HqStateAttentionItem[];
    blockers?: string[];
  };
  operational?: HqOperationalSnapshot;
  /** Reference timezone for the timeline window (spec 20 §13.1). Defaults to UTC. */
  timezone?: string;
  now?: Date;
}

export interface HqStateOfPlayV1 {
  version: 1;
  generatedAt: string;
  sources: Record<string, string>;
  sourceHealth: HqOperationalSourceHealth[];
  recentOutcome?: HqStateRecentOutcome;
  headline: string;
  nextMove: HqStateNextMove;
  alternatives: HqStateNextMove[];
  attention: HqStateAttentionItem[];
  momentum: {
    up: string[];
    down: string[];
  };
  missing: string[];
  goalProgress: HqStateGoalProgress[];
}

export interface HqStateOfPlayV2 extends Omit<HqStateOfPlayV1, 'version'> {
  version: 2;
  managerBrief: ManagerBriefV1;
}

export type HqStateOfPlay = HqStateOfPlayV1 | HqStateOfPlayV2;

export interface BuildHqStateInput {
  workspaceId: string;
  docs: LoadedContextDoc[];
  relatedCampaigns: ManagerCampaignSnapshot[];
  operational?: HqOperationalSnapshot;
  /** Reference timezone for the timeline window (spec 20 §13.1). Defaults to UTC. */
  timezone?: string;
  now?: Date;
}

export interface HqStateRecentOutcome {
  recommendationId: string;
  title: string;
  recommendationStatus: Extract<HqRecommendationStatus, 'completed' | 'failed' | 'superseded'>;
  outcomeStatus: 'successful' | 'partial' | 'unsuccessful' | 'unknown';
  evaluatedAt: string;
  userUsefulness?: 'useful' | 'neutral' | 'not_useful';
}

export interface BuiltHqStateContextDoc {
  slug: typeof HQ_STATE_CONTEXT_SLUG;
  metadata: ContextDocMetadata;
  body: string;
  state: HqStateOfPlay;
}
