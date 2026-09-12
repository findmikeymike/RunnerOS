/**
 * @craft-agent/shared/agent-definitions
 *
 * Saved agent personas (LLM + system prompt + skills + sources bundles).
 * Stored globally; activated per-workspace.
 *
 * NOT to be confused with the runtime agent classes in `../agent/`.
 */

export type {
  AgentDefinitionSource,
  AgentMetadata,
  AgentTaskModeDefinition,
  AgentTaskModeAdjacentSkill,
  AgentTaskModeContext,
  AgentTaskModeExpansion,
  LoadedAgent,
  AgentParseWarning,
  ActivatedAgentsManifest,
} from './types.ts';

export {
  resolveAgentTaskMode,
  selectTaskModeSourceSlugs,
  filterContextDocsForTaskMode,
  buildAgentTaskModePromptSection,
  type ResolvedAgentTaskMode,
} from './task-modes.ts';

export { AGENT_SLUG_REGEX, ORCHESTRATOR_SLUG, CONCIERGE_SLUG, SETUP_CONCIERGE_SLUG, SOCIAL_PUBLISHER_SLUG, SONG_DIRECTOR_SLUG } from './types.ts';

export {
  GLOBAL_AGENTS_DIR,
  AGENT_FILE,
  getGlobalAgentDir,
  getGlobalAgentFile,
  isValidAgentSlug,
  parseAgentFile,
  loadAllGlobalAgents,
  loadGlobalAgent,
  readActivatedAgents,
  writeActivatedAgents,
  setAgentActive,
  loadActivatedAgents,
  serializeAgent,
  writeGlobalAgent,
  deleteGlobalAgent,
  seedGlobalLibraryIfEmpty,
  ensureRequiredAgents,
  ensureBuiltInAgentSkills,
  ensureBuiltInAgentSkillsForSlug,
  ensureBuiltInAgentMetadataSlugs,
  replaceBuiltInAgentMetadata,
  migrateBuiltInAgentTaskModes,
  dedupeBuiltInAgentPromptText,
  replaceBuiltInAgentPromptText,
  replaceBuiltInAgentPromptPattern,
  removeBuiltInAgentSkills,
  type AgentStorageOptions,
  type CreateAgentInput,
} from './storage.ts';

export { STARTER_AGENTS } from './starter-templates.ts';
export { migrateYouTubeRouting } from './youtube-routing-migration.ts';
export { RELEASE_MANAGER_AGENT_SLUG, RELEASE_MANAGER_SKILL_SLUGS, ANYTHING_AGENT_SLUG, hasReleaseManagerIdentity, isReleaseManagerDefinition, DEFAULT_ACTIVATED_AGENT_SLUGS, CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS, HQ_DEFAULT_ACTIVATED_AGENT_SLUGS, HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS, LAB_DEFAULT_ACTIVATED_AGENT_SLUGS, initialAgentSlugsForWorkspace, isAgentAllowedInArtistWorkspace } from './defaults.ts';
export { CANVAS_GUIDANCE_HEADER, buildCanvasGuidanceSection } from './canvas-guidance.ts';
export { migrateMonidRouting } from './monid-routing-migration.ts';
export { migrateHelperGuide } from './helper-guide-migration.ts';

export { BUILTIN_AGENT_REGISTRATIONS, REQUIRED_BUILTIN_AGENT_SLUGS, BASE_DEFAULT_WORKER_SLUGS, HQ_DEFAULT_WORKER_SLUGS, CAMPAIGN_DEFAULT_WORKER_SLUGS, LAB_DEFAULT_WORKER_SLUGS, defaultWorkerSlugs, excludedWorkerSlugs, type BuiltinAgentRegistration, type ArtistWorkspaceScope } from './registration.ts';

export { SPOTIFY_ANALYST_LEGACY_PROMPTS } from './spotify-analyst-prompt-baselines.ts';
