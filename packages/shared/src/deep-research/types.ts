import type { AgentMessageStatus } from '../agent-messaging/types.ts';

export type DeepResearchPlanPolicy = 'approve' | 'auto';

export type DeepResearchRunState =
  | 'created'
  | 'awaiting_plan_approval'
  | 'running'
  | 'interrupted'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type DeepResearchStepKind = 'research' | 'analysis' | 'synthesis';

export type DeepResearchStepState = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type DeepResearchDepth = 'quick' | 'standard' | 'deep';

export type DeepResearchReportFormat = 'brief' | 'standard' | 'full';

export type DeepResearchSourceCapability = 'search' | 'browser' | 'mcp' | 'api' | 'local' | 'knowledge';

export interface DeepResearchLoopBudget {
  depth: DeepResearchDepth;
  maxSearchRounds: number;
  maxPagesToOpen: number;
  minFollowUpRounds: number;
}

export interface DeepResearchOwnerBinding {
  type: string;
  id: string;
  generation?: number;
}

export interface DeepResearchExecutionContract {
  overallTimeoutMs: number;
  maxSearchCalls: number;
  maxPageReads: number;
  maxConcurrentPageReads: number;
  maxRetriesPerPage: number;
  maxTotalResearchToolCalls: number;
  maxStructuredOutputRepairs: number;
  startedAt?: string;
  deadlineAt?: string;
}

export type DeepResearchToolKind = 'search' | 'page-read' | 'source-read';

export interface DeepResearchToolReceipt {
  id: string;
  toolUseId: string;
  toolName: string;
  kind: DeepResearchToolKind;
  sourceSlug?: string;
  status: 'succeeded' | 'failed';
  requestUrl?: string;
  responseUrl?: string;
  resultSha256?: string;
  resultChars: number;
  supportExcerpt?: string;
  observedAt: string;
}

export interface DeepResearchSourceProfile {
  slug: string;
  name: string;
  provider: string;
  type: string;
  capabilities: DeepResearchSourceCapability[];
  publicWebCertified?: boolean;
  tagline?: string;
}

export interface DeepResearchSourceReadiness {
  requested: string[];
  usable: string[];
  missing: string[];
  unusable: string[];
}

export interface DeepResearchPlanStep {
  id: string;
  kind: DeepResearchStepKind;
  title: string;
  instructions: string;
  requiredSourceSlugs: string[];
}

export interface DeepResearchStepAgentMessageReceipt {
  receiptId: string;
  childSessionId?: string;
  targetAgentSlug: string;
  status: AgentMessageStatus;
  summary?: string;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface DeepResearchPlan {
  id: string;
  title: string;
  objective: string;
  policy: DeepResearchPlanPolicy;
  depth: DeepResearchDepth;
  reportFormat: DeepResearchReportFormat;
  loopBudget: DeepResearchLoopBudget;
  sourceProfiles: DeepResearchSourceProfile[];
  steps: DeepResearchPlanStep[];
  requiredSourceSlugs: string[];
  assumptions: string[];
  riskNotes: string[];
  createdAt: string;
  approvedAt?: string;
  revisionNotes?: string[];
}

export interface DeepResearchStepRun {
  id: string;
  kind: DeepResearchStepKind;
  title: string;
  state: DeepResearchStepState;
  sessionId?: string;
  agentMessageReceipts?: DeepResearchStepAgentMessageReceipt[];
  toolReceipts?: DeepResearchToolReceipt[];
  output?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface DeepResearchRunEvent {
  ts: string;
  type:
    | 'created'
    | 'plan.created'
    | 'plan.revised'
    | 'plan.approved'
    | 'step.started'
    | 'step.completed'
    | 'step.failed'
    | 'report.created'
    | 'cancelled'
    | 'failed';
  message: string;
}

export interface DeepResearchRunSnapshot {
  schemaVersion: 1;
  id: string;
  workspaceId: string;
  title: string;
  topic: string;
  state: DeepResearchRunState;
  planPolicy: DeepResearchPlanPolicy;
  purpose?: string;
  publicWebSourcesOnly?: boolean;
  owner?: DeepResearchOwnerBinding;
  executionContract?: DeepResearchExecutionContract;
  sourceReadiness: DeepResearchSourceReadiness;
  plan: DeepResearchPlan;
  steps: DeepResearchStepRun[];
  events: DeepResearchRunEvent[];
  outputId?: string;
  outputSchema?: Record<string, unknown>;
  structuredOutput?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface StartDeepResearchRunInput {
  topic: string;
  title?: string;
  planPolicy?: DeepResearchPlanPolicy;
  sourceSlugs?: string[];
  depth?: DeepResearchDepth;
  reportFormat?: DeepResearchReportFormat;
}

export interface ReviseDeepResearchPlanInput {
  feedback: string;
}

export interface DeepResearchRunEventEnvelope {
  workspaceId: string;
  run: DeepResearchRunSnapshot;
  eventType: 'created' | 'updated' | 'completed';
}
