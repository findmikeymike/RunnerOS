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
  LoadedAgent,
  AgentParseWarning,
  ActivatedAgentsManifest,
} from './types.ts';

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
  dedupeBuiltInAgentPromptText,
  replaceBuiltInAgentPromptText,
  replaceBuiltInAgentPromptPattern,
  removeBuiltInAgentSkills,
  type AgentStorageOptions,
  type CreateAgentInput,
} from './storage.ts';

export { STARTER_AGENTS } from './starter-templates.ts';
export { RELEASE_MANAGER_AGENT_SLUG, RELEASE_MANAGER_SKILL_SLUGS, hasReleaseManagerIdentity, isReleaseManagerDefinition, DEFAULT_ACTIVATED_AGENT_SLUGS, CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS, LAB_DEFAULT_ACTIVATED_AGENT_SLUGS, initialAgentSlugsForWorkspace } from './defaults.ts';
export { CANVAS_GUIDANCE_HEADER, buildCanvasGuidanceSection } from './canvas-guidance.ts';
