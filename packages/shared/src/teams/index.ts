/**
 * @craft-agent/shared/teams
 *
 * Global library of durable agent teams. One TEAM.md per team.
 */

export type {
  LoadedTeam,
  TeamDefinitionSource,
  TeamMemberDefinition,
  TeamMetadata,
  TeamParseWarning,
  TeamParseWarningCode,
  TeamRiskAction,
  TeamVerificationMode,
  TeamVerificationPolicy,
} from './types.ts';

export type {
  CreateTeamTaskInput,
  ClaimTeamTaskInput,
  CompleteTeamRunInput,
  HeartbeatTeamTaskInput,
  RunTeamRunTickInput,
  SendTeamMessageInput,
  StartTeamRunInput,
  TeamMessage,
  TeamMessageActor,
  TeamMessageKind,
  TeamMessageTarget,
  TeamRunDetail,
  TeamRunEvent,
  TeamRunEventKind,
  TeamRunSnapshot,
  TeamRunState,
  TeamRunSwarmPolicy,
  TeamRunTick,
  TeamRunTickAction,
  TeamRunTickActionType,
  TeamRunTickReason,
  TeamTask,
  TeamTaskEvidence,
  TeamTaskPriority,
  TeamTaskStatus,
  TeamRunControlInput,
  UpdateTeamTaskInput,
} from './run-types.ts';

export { TEAM_FILE, TEAM_SLUG_REGEX } from './types.ts';

export {
  parseTeamFile,
  serializeTeam,
} from './parser.ts';

export {
  GLOBAL_TEAMS_DIR,
  getGlobalTeamDir,
  getGlobalTeamFile,
  isValidTeamSlug,
  loadAllGlobalTeams,
  loadGlobalTeam,
  writeGlobalTeam,
  deleteGlobalTeam,
  seedGlobalTeamLibraryIfEmpty,
  type CreateTeamInput,
  type TeamStorageOptions,
} from './storage.ts';

export {
  appendTeamRunEvent,
  appendTeamRunTick,
  assertValidTeamRunId,
  claimTeamTask,
  completeTeamRun,
  controlTeamRun,
  createTeamTask,
  deleteTeamRun,
  expireStaleTeamTaskLeases,
  getTeamRunDir,
  getTeamRunFile,
  getTeamRunsDir,
  heartbeatTeamTask,
  isValidTeamRunId,
  linkTeamRunMemberSession,
  listTeamMessages,
  listTeamRunEvents,
  listTeamRunTicks,
  listTeamRuns,
  listTeamTasks,
  markTeamMessagesRead,
  readTeamRun,
  readTeamRunDetail,
  runTeamRunTick,
  sendTeamMessage,
  normalizeTeamRunSwarmPolicy,
  touchTeamRun,
  updateTeamTask,
  writeTeamRun,
} from './run-storage.ts';

export {
  COMMERCE_LAUNCH_TEAM_SLUG,
  ENGINEERING_SHIP_TEAM_SLUG,
  HEAD_OF_BIZ_TEAM_SLUG,
  REVIEW_AND_QA_TEAM_SLUG,
  STARTER_TEAM_SLUGS,
  STARTER_TEAMS,
} from './starter-templates.ts';
