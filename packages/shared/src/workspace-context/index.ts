/**
 * @craft-agent/shared/workspace-context
 *
 * Per-workspace markdown docs that get injected into agent system prompts.
 * One file per topic; each routable to specific agents (default: broadcast).
 * The Concierge always sees every enabled doc.
 */

export type {
  ContextDocGoalPriority,
  ContextDocGoalStatus,
  ContextDocDelivery,
  ContextDocMetadata,
  ContextDocParseWarning,
  ContextDocParseWarningCode,
  ContextDocRouting,
  LoadedContextDoc,
} from './types.ts';

export {
  CONTEXT_DOC_GOAL_PRIORITIES,
  CONTEXT_DOC_GOAL_STATUSES,
  CONTEXT_DOC_SLUG_REGEX,
  CONTEXT_FILE,
} from './types.ts';

export {
  getWorkspaceContextDir,
  getContextDocDir,
  getContextDocFile,
  isValidContextDocSlug,
  parseContextFile,
  serializeContextDoc,
  loadAllContextDocs,
  loadContextDoc,
  loadActiveContextDocsForAgent,
  canAgentAccessContextDoc,
  shouldInjectContextDoc,
  loadAuthorizedContextDocsForAgent,
  loadPromptContextDocsForAgent,
  upsertContextDoc,
  deleteContextDoc,
  type UpsertContextDocInput,
} from './storage.ts';
