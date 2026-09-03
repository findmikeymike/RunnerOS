import type { SocialVariantSetManifest, SocialVariantSetSummary } from './social-variants.ts';

export type OutputKind =
  | 'report'
  | 'document'
  | 'image'
  | 'video'
  | 'audio'
  | 'dataset'
  | 'code'
  | 'model'
  | 'receipt'
  | 'external-action'
  | 'collection'
  | 'other';

export type OutputStatus = 'draft' | 'published' | 'failed' | 'cancelled';

export type OutputAssetRole = 'primary' | 'supporting' | 'source' | 'thumbnail' | 'attachment';

export interface OutputContext {
  scope: 'hq' | 'campaign';
  campaignId?: string;
}

export interface OutputApproval {
  state: 'none' | 'pending' | 'approved' | 'changes_requested';
  note?: string;
  updatedAt?: string;
}

export type OutputFinalScope = 'hq' | 'campaign';

export interface OutputFinalPointer {
  id: string;
  scope: OutputFinalScope;
  campaignId?: string;
  slot: string;
  outputId: string;
  assetId?: string;
  isPrimary: boolean;
  promotedAt: string;
  promotedBy: 'user' | 'agent';
  note?: string;
}

export interface PromoteOutputToFinalInput {
  outputId: string;
  scope: OutputFinalScope;
  campaignId?: string;
  slot: string;
  assetId?: string;
  makePrimary?: boolean;
  note?: string;
  promotedBy?: 'user' | 'agent';
}

export interface RemoveOutputFromFinalInput {
  outputId: string;
  scope?: OutputFinalScope;
  campaignId?: string;
  slot?: string;
  assetId?: string;
}

export interface OutputFinalsRegistry {
  schemaVersion: 1;
  updatedAt: string;
  finals: OutputFinalPointer[];
}

export type OutputPreviewMode =
  | 'markdown'
  | 'text'
  | 'json'
  | 'image'
  | 'video'
  | 'audio'
  | 'model'
  | 'pdf'
  | 'excalidraw'
  | 'presentation'
  | 'table'
  | 'chart'
  | 'workflow'
  | 'receipt'
  | 'external-link'
  | 'web';

export interface OutputAsset {
  id: string;
  label: string;
  role: OutputAssetRole;
  path: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface OutputLink {
  id: string;
  label: string;
  url: string;
  role?: 'primary' | 'source' | 'related' | 'external';
}

export interface OutputReceipt {
  id: string;
  provider: string;
  action: string;
  status: 'succeeded' | 'failed' | 'pending';
  occurredAt: string;
  externalId?: string;
  url?: string;
  displayText?: string;
  metadata?: Record<string, unknown>;
}

export interface OutputOrigin {
  source: 'workflow' | 'session' | 'automation' | 'manual' | 'deep-research';
  deepResearchRunId?: string;
  workflowRunId?: string;
  workflowSlug?: string;
  workflowName?: string;
  stepId?: string;
  sessionId?: string;
  workOrderId?: string;
  agentSlug?: string;
  agentName?: string;
  automationId?: string;
}

export interface OutputPreview {
  mode: OutputPreviewMode;
  assetId?: string;
  inlineText?: string;
}

export interface OutputManifest {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  kind: OutputKind;
  status: OutputStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  origin: OutputOrigin;
  primary?: OutputAsset;
  assets: OutputAsset[];
  receipts: OutputReceipt[];
  links: OutputLink[];
  preview?: OutputPreview;
  context?: OutputContext;
  approval?: OutputApproval;
  finals?: OutputFinalPointer[];
  tags?: string[];
  socialVariantSet?: SocialVariantSetManifest;
}

export interface OutputSummary {
  id: string;
  workspaceId: string;
  title: string;
  slug: string;
  kind: OutputKind;
  status: OutputStatus;
  summary: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  origin: OutputOrigin;
  preview?: OutputPreview;
  primaryAssetId?: string;
  previewMode?: OutputPreviewMode;
  context?: OutputContext;
  approval?: OutputApproval;
  finals?: OutputFinalPointer[];
  assetCount: number;
  receiptCount: number;
  linkCount: number;
  tags?: string[];
  socialVariantSet?: SocialVariantSetSummary;
}

export interface CreateOutputBundleInput {
  id?: string;
  workspaceId: string;
  title: string;
  kind: OutputKind;
  status?: OutputStatus;
  summary?: string;
  origin: OutputManifest['origin'];
  content?: string;
  contentMimeType?: 'text/markdown' | 'text/plain' | 'application/json';
  assets?: OutputAsset[];
  receipts?: OutputReceipt[];
  links?: OutputLink[];
  context?: OutputContext;
  approval?: OutputApproval;
  tags?: string[];
  /** Host-created only. Session tools do not expose this field to agents. */
  socialVariantSet?: SocialVariantSetManifest;
  createdAt?: string;
  completedAt?: string;
}
