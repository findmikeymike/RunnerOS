import type { ContextDocMetadata, LoadedContextDoc } from '../workspace-context/types.ts';
import type { MissionBrief } from '../artist-context/mission-brief.ts';

export const HQ_STATE_CONTEXT_SLUG = 'hq-state-of-play';
export const HQ_STATE_CONTEXT_FENCE = 'json hq-state-of-play';

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
  sourceHealth: ManagerSourceHealth[];
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
  campaignFocus?: {
    workspaceId: string;
    name: string;
    label: 'Current campaign' | 'Next campaign' | 'Latest campaign' | 'Release date needed';
    releaseDate?: string;
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
  now?: Date;
}

export interface HqStateOfPlay {
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
