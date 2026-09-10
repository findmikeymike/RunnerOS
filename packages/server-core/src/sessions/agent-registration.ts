import { loadActivatedAgents, isAgentAllowedInArtistWorkspace, type AgentStorageOptions } from '@craft-agent/shared/agent-definitions'

/** Artist OS defaults belong to workspace creation, never recurring startup. */
export function shouldBackfillLegacyAgentActivation(variant: string): boolean {
  return variant !== 'artist-os'
}

/** The common catalog/gate view: saved activation + a readable definition + scope. */
export function loadActiveAgentsForWorkspace(
  workspace: { rootPath: string; artistWorkspaceScope?: 'hq' | 'campaign' | 'lab' | 'general' },
  options?: AgentStorageOptions,
) {
  return loadActivatedAgents(workspace.rootPath, options)
    .filter(agent => isAgentAllowedInArtistWorkspace(agent.slug, workspace.artistWorkspaceScope))
}
