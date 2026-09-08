import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import type { ISessionManager } from '../handlers/session-manager-interface'

/** A renderer focus is selection intent; the host supplies its actual prompt and capabilities. */
export async function resolveFocusedSessionCreateOptions(
  workspaceId: string,
  options: CreateSessionOptions | undefined,
  resolve: ISessionManager['resolveAgentSessionOptions'],
): Promise<CreateSessionOptions | undefined> {
  if (!options?.launchReceipt?.taskMode || options.branchFromSessionId) return options
  const agentSlug = options.spawnedFromAgent?.agentSlug ?? options.launchReceipt.agent?.slug
  if (!agentSlug || (options.launchReceipt.agent?.slug && options.launchReceipt.agent.slug !== agentSlug)) {
    throw new Error('Choose a valid worker for this focus.')
  }
  const focused = await resolve(workspaceId, agentSlug, {
    taskModeId: options.launchReceipt.taskMode.id, taskModeSelectionSource: 'user', referenceMode: 'strict',
  })
  if (!focused.launchReceipt?.taskMode) throw new Error('The selected focus is unavailable. Choose it again.')
  return {
    ...options,
    customSystemPrompt: focused.customSystemPrompt,
    agentSkillSlugs: focused.agentSkillSlugs ?? [],
    enabledSourceSlugs: focused.enabledSourceSlugs ?? [],
    trustedWorkerTools: focused.trustedWorkerTools ?? [],
    spawnedFromAgent: focused.spawnedFromAgent,
    launchReceipt: focused.launchReceipt,
  }
}
