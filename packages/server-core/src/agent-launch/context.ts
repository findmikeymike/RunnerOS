import { CONCIERGE_SLUG, filterContextDocsForTaskMode, type ResolvedAgentTaskMode } from '@craft-agent/shared/agent-definitions'
import { canAgentAccessContextDoc, loadAllContextDocs, shouldInjectContextDoc, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import { refreshCampaignStateContextDocBestEffort, refreshHqStateContextDocBestEffort } from '../hq-state/refresh'
import { withScriptwriterArtistContext } from '../hq-state/scriptwriter-context'
import { refreshVerifiedTrackContextForAgents } from '../track-intelligence/agent-visibility'
import { ReleaseKitService } from '../release-kit/ReleaseKitService'

/** A focus changes delivery, never authorization or the artist's disabled rules. */
export function selectContextDocsForAgentLaunch(
  docs: LoadedContextDoc[], agentSlug: string | null, taskMode?: ResolvedAgentTaskMode,
): LoadedContextDoc[] {
  const authorized = docs.filter(doc => canAgentAccessContextDoc(doc, agentSlug))
  return taskMode ? filterContextDocsForTaskMode(authorized, taskMode)
    : authorized.filter(doc => shouldInjectContextDoc(doc, agentSlug))
}

type LaunchWorkspace = { id: string; rootPath: string; artistWorkspaceScope?: string }
interface ContextPreparationDeps {
  refreshTracks: typeof refreshVerifiedTrackContextForAgents
  refreshReleaseKit: (workspaceId: string) => { contextPersisted: boolean }
  loadDocs: typeof loadAllContextDocs
  withScriptwriterContext: typeof withScriptwriterArtistContext
  refreshHq: typeof refreshHqStateContextDocBestEffort
  refreshCampaign: typeof refreshCampaignStateContextDocBestEffort
  warn: (message: string, details: Record<string, unknown>) => void
}

/** Shared by chat RPCs and server launches, including focus changes and Pulse.
 * Refresh verified canon before reading; a failed safe write must never revive
 * the stale persisted version. Runtime refreshes intentionally persist locally.
 */
export function prepareAgentLaunchContext(
  workspace: LaunchWorkspace,
  agentSlug: string | null,
  taskMode?: ResolvedAgentTaskMode,
  overrides: Partial<ContextPreparationDeps> = {},
): LoadedContextDoc[] {
  const deps: ContextPreparationDeps = {
    refreshTracks: refreshVerifiedTrackContextForAgents,
    refreshReleaseKit: id => new ReleaseKitService().refreshAgentContext(id),
    loadDocs: loadAllContextDocs,
    withScriptwriterContext: withScriptwriterArtistContext,
    refreshHq: refreshHqStateContextDocBestEffort,
    refreshCampaign: refreshCampaignStateContextDocBestEffort,
    warn: (message, details) => console.warn(message, details),
    ...overrides,
  }
  const scope = workspace.artistWorkspaceScope
  if (agentSlug?.trim().toLowerCase() === CONCIERGE_SLUG) {
    if (scope === 'hq') deps.refreshHq(workspace.rootPath)
    else if (scope === 'campaign') deps.refreshCampaign(workspace.rootPath)
  }
  const unsafe = new Set<string>()
  if (scope === 'hq' || scope === 'campaign') {
    const refresh = deps.refreshTracks(workspace.rootPath, workspace.id, scope)
    if (!refresh.ok) {
      if (refresh.unsafePersistedSlug) unsafe.add(refresh.unsafePersistedSlug)
      deps.warn('[track-intelligence] Could not refresh verified launch context', { workspaceId: workspace.id, error: refresh.error })
    }
  }
  if (scope === 'campaign') {
    try {
      if (!deps.refreshReleaseKit(workspace.id).contextPersisted) unsafe.add('release-kit')
    } catch (error) {
      unsafe.add('release-kit')
      deps.warn('[release-kit] Could not refresh verified launch context', { workspaceId: workspace.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const docs = selectContextDocsForAgentLaunch(
    deps.withScriptwriterContext(workspace.rootPath, agentSlug, deps.loadDocs(workspace.rootPath))
      .filter(doc => !unsafe.has(doc.slug)),
    agentSlug, taskMode,
  )
  if (scope !== 'hq' && scope !== 'campaign' && scope !== 'lab') return docs
  const marker: LoadedContextDoc = {
    slug: 'artist-os-workspace',
    metadata: { name: 'Artist OS Workspace', description: 'Compact product-scope marker used for shared Artist OS operating rules.', routing: { mode: 'broadcast' }, delivery: 'always', enabled: true },
    body: `Artist OS workspace scope: ${scope}.`, path: workspace.rootPath, workspaceRootPath: workspace.rootPath,
  }
  return filterContextDocsForTaskMode([marker, ...docs.filter(doc => doc.slug !== marker.slug)], taskMode)
}
