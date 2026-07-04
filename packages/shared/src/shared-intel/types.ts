import type { Message } from '@craft-agent/core/types';

export const SHARED_INTEL_CONTEXT_PREFIX = 'shared-intel-';
export const SHARED_INTEL_FENCE = 'json shared-intel';
export const SHARED_INTEL_PROMPT_HEADER = 'Shared Intel for this worker:';

export type SharedIntelConfidence = 'high' | 'medium' | 'low';
export type SharedIntelAction = 'created' | 'updated' | 'superseded';
export type ShareIntelStatus = 'shared' | 'updated' | 'no_durable_intel' | 'no_targets' | 'error';

export interface SharedIntelAgentCatalogEntry {
  slug: string;
  name: string;
  description?: string;
  inputs?: string;
  outputs?: string;
  tags?: string[];
  visualAgent?: boolean;
  active?: boolean;
}

export interface SharedIntelNote {
  version: 1;
  id: string;
  title: string;
  summary: string;
  whyItMatters: string;
  tags: string[];
  targetAgents: string[];
  sourceSessionId: string;
  sourceAgentSlug?: string;
  sourceAgentName?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  confidence: SharedIntelConfidence;
  evidence?: string;
  superseded?: boolean;
}

export interface SharedIntelCandidate {
  title: string;
  summary: string;
  whyItMatters: string;
  tags: string[];
  targetAgents: string[];
  confidence: SharedIntelConfidence;
  evidence?: string;
}

export interface ExistingSharedIntelDoc {
  slug: string;
  note: SharedIntelNote;
}

export interface ShareIntelRequest {
  workspaceId: string;
  sessionId: string;
  sourceAgentSlug?: string;
  sourceAgentName?: string;
  clickedAtTurnId?: string;
  forceNew?: boolean;
  /**
   * Renderer-provided snapshot of agents visible in the current workspace.
   * Server still validates against the source-of-truth global library.
   */
  agentCatalog?: SharedIntelAgentCatalogEntry[];
}

export interface ShareIntelResultNote {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  targetAgents: Array<{ slug: string; name: string }>;
  action: SharedIntelAction;
  contextDocSlug?: string;
}

export interface ShareIntelResult {
  ok: boolean;
  status: ShareIntelStatus;
  notes: ShareIntelResultNote[];
  toast: {
    title: string;
    description?: string;
  };
  error?: string;
}

export interface BuildSharedIntelInput {
  sessionId: string;
  sourceAgentSlug?: string;
  sourceAgentName?: string;
  messages: Message[];
  agentCatalog: SharedIntelAgentCatalogEntry[];
  existingNotes?: ExistingSharedIntelDoc[];
  forceNew?: boolean;
  now?: Date;
}

export interface BuiltSharedIntelDoc {
  slug: string;
  note: SharedIntelNote;
  body: string;
  targetAgents: SharedIntelAgentCatalogEntry[];
  action: Exclude<SharedIntelAction, 'superseded'>;
}
