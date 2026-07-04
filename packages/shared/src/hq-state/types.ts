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
  title: string;
  why: string;
  worker?: string;
  action?: HqStateAction;
  oneClick?: boolean;
  route?: HqStateRouteHint;
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

export interface HqStateOfPlay {
  version: 1;
  generatedAt: string;
  sources: Record<string, string>;
  headline: string;
  nextMove: HqStateNextMove;
  attention: HqStateAttentionItem[];
  momentum: {
    up: string[];
    down: string[];
  };
  missing: string[];
  goalProgress: HqStateGoalProgress[];
}

export interface BuiltHqStateContextDoc {
  slug: typeof HQ_STATE_CONTEXT_SLUG;
  metadata: ContextDocMetadata;
  body: string;
  state: HqStateOfPlay;
}
