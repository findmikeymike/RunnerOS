/** Deep links carry selection intent; the host resolves actual capabilities. */
export function parseAgentDeepLinkSelection(params: Record<string, string>): { agentSlug: string; taskModeId?: string } | undefined {
  if (!params.agentSlug) {
    if (params.taskModeId) throw new Error('A task-mode deep link must name its agent.')
    return undefined
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(params.agentSlug)
    || (params.taskModeId && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(params.taskModeId))) {
    throw new Error('Invalid agent or task mode in deep link.')
  }
  return { agentSlug: params.agentSlug, ...(params.taskModeId ? { taskModeId: params.taskModeId } : {}) }
}
