/**
 * @craft-agent/shared/workflows
 *
 * Global library of reusable agent pipelines. One WORKFLOW.md per workflow,
 * activated per-workspace via an activation manifest. Mirrors the
 * agent-definitions module's storage shape.
 */

export type {
  ActivatedWorkflowsManifest,
  JsonSchema,
  LoadedWorkflow,
  WorkflowDefinitionSource,
  WorkflowMetadata,
  WorkflowParseWarning,
  WorkflowParseWarningCode,
  WorkflowOutputContract,
  WorkflowStep,
  WorkflowStepCompletionContract,
  WorkflowStepFailurePolicy,
  WorkflowTrigger,
  WorkflowTriggerInput,
  WorkflowTriggerType,
} from './types.ts';

export { WORKFLOW_FILE, WORKFLOW_SLUG_REGEX } from './types.ts';

export {
  parseWorkflowFile,
  serializeWorkflow,
} from './parser.ts';

export {
  GLOBAL_WORKFLOWS_DIR,
  getGlobalWorkflowDir,
  getGlobalWorkflowFile,
  isValidWorkflowSlug,
  loadAllGlobalWorkflows,
  loadGlobalWorkflow,
  readActivatedWorkflows,
  writeActivatedWorkflows,
  setWorkflowActive,
  ensureDefaultWorkflowActivations,
  loadActivatedWorkflows,
  writeGlobalWorkflow,
  deleteGlobalWorkflow,
  seedGlobalWorkflowLibraryIfEmpty,
  ensureRequiredWorkflows,
  type CreateWorkflowInput,
  type WorkflowStorageOptions,
} from './storage.ts';

export {
  resolveTemplate,
  validateTemplateReferences,
  type TemplateContext,
  type TemplateResolveResult,
} from './template.ts';

export {
  appendOutputSchemaInstruction,
  isValidWorkflowOutputSchema,
  parseStructuredStepOutput,
  type StructuredOutputParseResult,
} from './output-schema.ts';

export { normalizeWorkflowTriggerInputs } from './trigger-inputs.ts';

export type {
  WorkflowRunState,
  WorkflowRunStepState,
  WorkflowStepAgentMessageReceipt,
  WorkflowStepExecutionReceipt,
  WorkflowRunStep,
  WorkflowRunSnapshot,
} from './run-types.ts';

export {
  getRunsDir,
  getRunDir,
  getRunFile,
  attachAgentMessageReceipts,
  isValidWorkflowRunId,
  assertValidWorkflowRunId,
  writeRun,
  readRun,
  listRuns,
  markRunningRunsInterrupted,
  deleteRun,
} from './run-storage.ts';

export {
  STARTER_WORKFLOWS,
  STARTER_WORKFLOW_SLUGS,
  WEEKLY_CONTENT_PIPELINE_SLUG,
  EMAIL_TRIAGE_SLUG,
  CONTENT_MASTERMIND_SLUG,
  PAID_CAMPAIGN_BUILDER_SLUG,
  INDUSTRY_OUTREACH_PIPELINE_SLUG,
  COLLEGE_RADIO_CAMPAIGN_SLUG,
  MERCH_PRODUCT_BUILDER_SLUG,
  ENSURED_STARTER_WORKFLOW_SLUGS,
  HQ_DEFAULT_WORKFLOW_SLUGS,
  CAMPAIGN_DEFAULT_WORKFLOW_SLUGS,
} from './starter-templates.ts';
