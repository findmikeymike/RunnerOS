import { enableContentCompanions, groupContentSpecialists, loadGlobalAgent, readActivatedAgents, STARTER_AGENTS, type AgentStorageOptions } from '@craft-agent/shared/agent-definitions'
import { loadActiveAgentsForWorkspace } from './agent-registration'

type Workspace = { rootPath: string; artistWorkspaceScope?: 'hq' | 'campaign' | 'lab' | 'general' }

/** Hide only unchanged built-ins; retain customized workers as the artist arranged them. */
function eligibleCompanions(options?: AgentStorageOptions) {
  return ['scroll-stopper', 'anticipation-director'].filter(slug => {
    const installed = loadGlobalAgent(slug, options)
    const stock = STARTER_AGENTS.find(agent => agent.slug === slug)
    return installed && stock && installed.systemPrompt.trim() === stock.systemPrompt.trim()
      && installed.metadata.name === stock.metadata.name
      && JSON.stringify(installed.metadata.skills?.map(skill => skill.replace(/^legacy:/, ''))) === JSON.stringify(stock.metadata.skills)
  })
}

export function groupWorkspaceContentSpecialists(workspace: Workspace, options?: AgentStorageOptions) {
  return groupContentSpecialists(workspace.rootPath, workspace.artistWorkspaceScope, eligibleCompanions(options), Boolean(loadGlobalAgent('content-genius', options)))
}

/** UI membership only: runtime callers continue using loadActiveAgentsForWorkspace. */
export function loadVisibleAgentSlugs(workspace: Workspace, options?: AgentStorageOptions): string[] {
  const hidden = new Set(['hq', 'campaign'].includes(workspace.artistWorkspaceScope ?? '')
    ? readActivatedAgents(workspace.rootPath).libraryOnly ?? [] : [])
  return loadActiveAgentsForWorkspace(workspace, options).filter(agent => !hidden.has(agent.slug)).map(agent => agent.slug)
}

export function enableWorkspaceContentCompanions(workspace: Workspace, options?: AgentStorageOptions) {
  return enableContentCompanions(workspace.rootPath, workspace.artistWorkspaceScope, eligibleCompanions(options))
}
