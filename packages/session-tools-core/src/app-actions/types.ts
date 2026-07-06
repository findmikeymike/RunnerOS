import type { CreateOutputToolInput, CreateOutputResult } from '../handlers/outputs.ts';

export type JsonSchema = Record<string, unknown>;

export type AppActionSurface =
  | 'calendar'
  | 'kanban'
  | 'network'
  | 'fans'
  | 'vault'
  | 'outputs'
  | 'work_products'
  | 'campaigns'
  | 'approvals'
  | 'workflows'
  | 'messages'
  | 'publishing'
  | 'settings';

export type AppActionKind =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'external_send'
  | 'publish'
  | 'purchase'
  | 'credential';

export type AppActionRisk =
  | 'read'
  | 'internal_safe'
  | 'internal_write'
  | 'external_write'
  | 'destructive'
  | 'credential';

export type AppActionStatus =
  | 'succeeded'
  | 'approval_required'
  | 'queued'
  | 'duplicate'
  | 'failed';

export type AppActionErrorCode =
  | 'ACTION_NOT_FOUND'
  | 'ACTION_UNAVAILABLE'
  | 'VALIDATION_FAILED'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_STALE'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'SOURCE_AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'EXTERNAL_API_FAILED'
  | 'INTERNAL_ERROR';

export interface AppActionError {
  code: AppActionErrorCode;
  message: string;
  fieldPath?: string;
  repairHint?: string;
  retryAfterSeconds?: number;
}

export interface AppActionAvailability {
  available: boolean;
  reason?: string;
  repairHint?: string;
}

export interface AppActionExpectedChange {
  summary: string;
  target?: {
    surface: AppActionSurface;
    entityType?: string;
    entityId?: string;
  };
}

export interface AppActionPreview {
  ok: boolean;
  actionId: string;
  normalizedInput?: unknown;
  risk?: AppActionRisk;
  approvalRequired?: boolean;
  approvalReason?: string;
  idempotencyKey?: string;
  duplicateOfReceiptId?: string;
  expectedChange?: AppActionExpectedChange;
  warnings?: string[];
  errors?: AppActionError[];
}

export interface AppActionDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  version: number;
  title: string;
  description: string;
  surface: AppActionSurface;
  kind: AppActionKind;
  risk: AppActionRisk;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  idempotency: {
    required: boolean;
    keyFields: string[];
    duplicateWindowSeconds: number;
    duplicateBehavior: 'return_prior' | 'merge' | 'reject';
  };
  approvalPolicy: {
    mode: 'never' | 'risk_based' | 'always';
    reason?: string;
    summaryFields: string[];
    snapshotFields: string[];
  };
  capability: {
    defaultGrant: 'none' | 'hnic' | 'specialist' | 'all';
    minPermissionMode?: string;
    requiredActionGrants?: string[];
    requiredSourceSlugs?: string[];
    requiredOAuthScopes?: string[];
    allowedBackground?: boolean;
    requiresExplicitUserIntent?: boolean;
  };
  audit: {
    redactInputFields: string[];
    redactOutputFields: string[];
    piiFields: string[];
  };
  uiEvents: Array<{ type: string; target?: string }>;
  validate: (input: unknown) => { ok: true; input: TInput } | { ok: false; errors: AppActionError[] };
  availability?: (ctx: AppActionRuntimeContext) => AppActionAvailability;
  preview?: (ctx: AppActionRuntimeContext, input: TInput) => AppActionExpectedChange | Promise<AppActionExpectedChange>;
  execute?: (ctx: AppActionRuntimeContext, input: TInput) => Promise<AppActionAdapterResult<TOutput>>;
}

export interface AppActionRuntimeContext {
  sessionId: string;
  workspacePath: string;
  workspaceId?: string;
  activeAgentSlug?: string;
  parentAgentSlug?: string;
  listAgents?: (options?: { activeOnly?: boolean; search?: string; tags?: string[] }) => {
    agents: Array<{ slug: string; actionGrants?: string[]; permissionMode?: string; tags?: string[] }>;
  };
  listSources?: (options?: { activeOnly?: boolean; search?: string; tags?: string[]; type?: 'mcp' | 'api' | 'local' }) => {
    sources: Array<{ slug: string; enabled: boolean; authStatus?: string }>;
  };
  getSessionInfo?: (sessionId?: string) => { permissionMode?: string } | null;
  createOutput?: (input: CreateOutputToolInput) => Promise<CreateOutputResult>;
  startWorkflow?: (slug: string, triggerInputs: Record<string, unknown>) => Promise<unknown>;
  addVaultFiles?: (input: AppActionVaultAddFilesInput) => Promise<AppActionVaultResult>;
  addOutputToVault?: (input: AppActionVaultAddFromOutputInput) => Promise<AppActionVaultResult>;
  verifyAppActionApproval?: (input: AppActionApprovalVerificationInput) => Promise<AppActionApprovalVerificationResult> | AppActionApprovalVerificationResult;
}

export interface AppActionApprovalVerificationInput {
  approvalId: string;
  actionId: string;
  actionVersion: number;
  idempotencyKey: string;
  approvalSnapshotHash: string;
  requestId: string;
  redactedInput: unknown;
}

export interface AppActionApprovalVerificationResult {
  approved: boolean;
  reason?: string;
}

export interface AppActionAdapterResult<TOutput = unknown> {
  output: TOutput;
  target?: AppActionReceipt['target'];
  outputId?: string;
  workProductId?: string;
  uiEvents?: AppActionReceipt['uiEvents'];
}

export interface AppActionCallInput {
  actionId: string;
  input: unknown;
  requestId: string;
  intendedSurface?: string;
  approvalToken?: string;
  dryRun?: boolean;
}

export interface AppActionListInput {
  surface?: AppActionSurface;
  includeUnavailable?: boolean;
}

export interface AppActionPreviewInput {
  actionId: string;
  input: unknown;
  requestId?: string;
  intendedSurface?: string;
}

export interface AppActionGetReceiptInput {
  receiptId: string;
}

export interface AppActionListItem {
  id: string;
  title: string;
  description: string;
  surface: AppActionSurface;
  kind: AppActionKind;
  risk: AppActionRisk;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  approval: {
    mode: AppActionDefinition['approvalPolicy']['mode'];
    reason?: string;
  };
  availability: AppActionAvailability;
}

export interface AppActionListResult {
  actions: AppActionListItem[];
}

export interface AppActionExecuteResult {
  status: AppActionStatus;
  receipt?: AppActionReceipt;
  approval?: {
    approvalId: string;
    summary: {
      title: string;
      actionId: string;
      risk: AppActionRisk;
      reason: string;
      input: unknown;
    };
    requiredBy: string;
  };
  duplicateOfReceiptId?: string;
  errors?: AppActionError[];
}

export interface AppActionReceipt {
  schemaVersion: 1;
  id: string;
  actionId: string;
  actionVersion: number;
  requestId: string;
  idempotencyKey: string;
  workspaceId: string;
  sessionId: string;
  actor: {
    type: 'user' | 'agent' | 'workflow' | 'automation';
    userId?: string;
    agentSlug?: string;
    parentAgentSlug?: string;
    permissionMode?: string;
  };
  status: AppActionStatus;
  risk: AppActionRisk;
  approvalId?: string;
  approvalSnapshotHash?: string;
  target?: {
    surface: AppActionSurface;
    entityType?: string;
    entityId?: string;
    externalProvider?: string;
    externalId?: string;
    url?: string;
  };
  redactedInput: unknown;
  redactedOutput?: unknown;
  error?: AppActionError;
  outputId?: string;
  workProductId?: string;
  uiEvents: Array<{ type: string; payload: unknown }>;
  createdAt: string;
  completedAt?: string;
}

export interface AppActionVaultAddFilesInput {
  paths: string[];
  kindHint?: AppActionVaultKindHint;
}

export interface AppActionVaultAddFromOutputInput {
  outputId: string;
  assetId?: string;
  kindHint?: AppActionVaultKindHint;
}

export interface AppActionVaultResult {
  imported?: Array<{ id?: string; label?: string; relativePath?: string }>;
  manifest?: unknown;
}

export type AppActionVaultKindHint =
  | 'master-final'
  | 'demo'
  | 'raw-footage'
  | 'cover-art'
  | 'artist-photo'
  | 'contract'
  | 'any';
