/**
 * Renderer view of agent system-prompt composition.
 *
 * The implementation lives in `@craft-agent/shared/agent-prompt` so the
 * renderer's chat launch and the server's workflow / pulse / agent-delegation
 * spawns compose identical prompts. Re-exported here to keep the `@/lib/...`
 * import convention.
 */
export {
  buildAgentBundleFooter,
  buildAgentCatalogSection,
  buildMemorySection,
  buildWorkspaceContextSection,
  composeAgentSystemPrompt,
  type AgentCatalogEntry,
  type AgentPromptMemoryOptions,
} from '@craft-agent/shared/agent-prompt'
