import { getWorkspaces } from '@craft-agent/shared/config'
import { loadAllContextDocs, type LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import { refreshArtistManagerStateForWorkspaceBestEffort } from './refresh'

/** Publish every affected brief, including HQ when a campaign changed. */
export function refreshAndBroadcastArtistManagerState(
  changedRootPath: string,
  broadcast: (workspaceId: string, docs: LoadedContextDoc[]) => void,
): void {
  refreshArtistManagerStateForWorkspaceBestEffort(changedRootPath)
  const workspaces = getWorkspaces()
  const changed = workspaces.find(workspace => workspace.rootPath === changedRootPath)
  for (const workspace of workspaces) {
    if (workspace.rootPath !== changedRootPath
      && workspace.artistWorkspaceScope !== 'hq'
      && !(changed?.artistWorkspaceScope === 'hq' && workspace.artistWorkspaceScope === 'campaign')) continue
    try {
      broadcast(workspace.id, loadAllContextDocs(workspace.rootPath))
    } catch (error) {
      // A renderer notification must not turn a committed mutation into a reported failure.
      console.warn('[hq-state] Failed to broadcast refreshed workspace context:', error)
    }
  }
}
