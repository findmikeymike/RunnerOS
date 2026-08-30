/**
 * Sessions Module
 *
 * Public exports for workspace-scoped session management.
 *
 * Sessions are stored in JSONL format:
 * - Line 1: SessionHeader (metadata for fast list loading)
 * - Lines 2+: StoredMessage (one message per line)
 */

// Types
export type {
  SessionStatus,
  SessionTokenUsage,
  StoredMessage,
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionHeader,
  SessionPersistentField,
  SessionLaunchReceipt,
} from './types.ts';

// Field constants
export { SESSION_PERSISTENT_FIELDS } from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSessionsDir,
  ensureSessionDir,
  getSessionPath,
  getSessionFilePath,
  getSessionAttachmentsPath,
  getSessionPlansPath,
  ensureAttachmentsDir,
  // ID generation
  generateSessionId,
  // Session CRUD
  createSession,
  getOrCreateSessionById,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  clearSessionMessages,
  getOrCreateLatestSession,
  // Metadata updates
  updateSessionSdkId,
  updateSessionMetadata,
  canUpdateSdkCwd,
  flagSession,
  unflagSession,
  setSessionStatus,
  // Pending plan execution (Accept & Compact flow)
  setPendingPlanExecution,
  markCompactionComplete,
  markPendingPlanExecutionDispatched,
  clearPendingPlanExecution,
  getPendingPlanExecution,
  // Session filtering
  listFlaggedSessions,
  listCompletedSessions,
  listInboxSessions,
  // Archive management
  archiveSession,
  unarchiveSession,
  listArchivedSessions,
  listActiveSessions,
  deleteOldArchivedSessions,
  // Plan storage
  formatPlanAsMarkdown,
  parsePlanFromMarkdown,
  savePlanToFile,
  loadPlanFromFile,
  loadPlanFromPath,
  listPlanFiles,
  deletePlanFile,
  getMostRecentPlanFile,
  // Async persistence queue
  sessionPersistenceQueue,
  // Header metadata signature (for self-triggered event suppression)
  getHeaderMetadataSignature,
} from './storage.ts';

// JSONL helpers (for direct access if needed)
export {
  readSessionHeader,
  readSessionJsonl,
  writeSessionJsonl,
  createSessionHeader,
} from './jsonl.ts';

// Field utilities
export { pickSessionFields } from './utils.ts';

// Chat-native Goal Mode
export type {
  ChatGoalStatus,
  ChatGoalStopCode,
  ChatGoalCompletion,
  ChatGoalStop,
  ChatGoalBlockerAudit,
  ChatGoalState,
  ChatGoalEventType,
  ChatGoalEvent,
  CreateChatGoalInput,
  EditChatGoalInput,
} from './chat-goal.ts';
export {
  CHAT_GOAL_SCHEMA_VERSION,
  CHAT_GOAL_DEFAULT_MAX_ROUNDS,
  CHAT_GOAL_MIN_ROUNDS,
  CHAT_GOAL_MAX_ROUNDS,
  ChatGoalValidationError,
  ChatGoalConflictError,
  isChatGoalTerminal,
  createChatGoalState,
  parseChatGoalState,
  assertChatGoalRevision,
  editChatGoalState,
  pauseChatGoalState,
  resumeChatGoalState,
  admitChatGoalRound,
  completeChatGoalState,
  limitChatGoalByBudget,
  recordChatGoalBlocker,
  disarmChatGoalAfterRestart,
  cancelChatGoalState,
  makeChatGoalEvent,
} from './chat-goal.ts';

// Slug generator utilities
export {
  generateDatePrefix,
  generateHumanSlug,
  generateUniqueSessionId,
  parseSessionId,
  isHumanReadableId,
} from './slug-generator.ts';

// Word lists (for customization if needed)
export { ADJECTIVES, NOUNS } from './word-lists.ts';

// Session ID validation (security)
export {
  validateSessionId,
  sanitizeSessionId,
} from './validation.ts';

// Session bundle (export/import/dispatch)
export type {
  SessionBundle,
  BundleFile,
  BundleBranchInfo,
  DispatchMode,
} from './bundle.ts';
export {
  serializeSession,
  validateBundle,
  MAX_BUNDLE_SIZE_BYTES,
} from './bundle.ts';
