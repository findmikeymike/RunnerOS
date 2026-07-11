import type { ContextDocMetadata } from '../workspace-context/types.ts';

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
