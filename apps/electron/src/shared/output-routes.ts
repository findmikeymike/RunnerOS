/** Library scope and selected output ownership are independent. */
export interface OutputRouteFields {
  outputScope?: 'all' | 'workspace'
  outputScopeWorkspaceId?: string
  outputWorkspaceId?: string
  outputId?: string
}

export function buildOutputRoute(state: OutputRouteFields): string {
  if (!state.outputScope) return state.outputId ? `outputs/${state.outputId}` : 'outputs'
  const base = state.outputScope === 'all'
    ? 'outputs/library/all'
    : `outputs/library/workspace/${encodeURIComponent(state.outputScopeWorkspaceId ?? '')}`
  return state.outputId && state.outputWorkspaceId
    ? `${base}/output/${encodeURIComponent(state.outputWorkspaceId)}/${encodeURIComponent(state.outputId)}`
    : base
}

export function parseOutputLibraryRoute(route: string): OutputRouteFields | null {
  const parts = route.split('/')
  if (parts[0] !== 'outputs' || parts[1] !== 'library') return null
  try {
    let state: OutputRouteFields
    let offset: number
    if (parts[2] === 'all') {
      state = { outputScope: 'all' }
      offset = 3
    } else if (parts[2] === 'workspace' && parts[3]) {
      state = { outputScope: 'workspace', outputScopeWorkspaceId: decodeURIComponent(parts[3]) }
      offset = 4
    } else return null
    if (parts.length === offset) return state
    if (parts.length !== offset + 3 || parts[offset] !== 'output' || !parts[offset + 1] || !parts[offset + 2]) return null
    return { ...state, outputWorkspaceId: decodeURIComponent(parts[offset + 1]), outputId: decodeURIComponent(parts[offset + 2]) }
  } catch {
    return null
  }
}
