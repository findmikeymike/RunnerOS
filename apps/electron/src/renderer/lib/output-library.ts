import type { OutputSummaryDTO } from '../hooks/useOutputs'
import type { ReleaseKitItem } from '@craft-agent/shared/release-kit'
import { isArtistCampaignWorkspace } from './artist-workspace'

export interface OutputLibraryWorkspace {
  id: string
  name: string
  artistWorkspaceScope?: 'hq' | 'campaign' | 'lab' | 'general'
  slug?: string
  remoteServer?: unknown
}

export function outputLibraryPlan(workspaces: OutputLibraryWorkspace[], activeWorkspaceId: string | null, scopeWorkspaceId?: string, remoteActive = false) {
  const permitted = outputLibraryTargets(workspaces, activeWorkspaceId, undefined, remoteActive)
  return {
    activeWorkspaceId,
    remoteActive,
    transport: (() => { const server = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.remoteServer as { url?: string; remoteWorkspaceId?: string } | undefined; return server ? [server.url, server.remoteWorkspaceId] : null })(),
    outputs: permitted.filter((workspace) => !scopeWorkspaceId || workspace.id === scopeWorkspaceId).map(({id,name}) => ({id,name})),
    kits: permitted.filter(isArtistCampaignWorkspace).map(({id,name}) => ({id,name})),
  }
}

/** Superseded loads must never publish state, including after transport changes. */
export function createOutputLibraryLoadGate() {
  let generation = 0
  return {
    invalidate: () => { generation++ },
    async run<T>(load: () => Promise<T>, publish: (result: T) => void): Promise<void> {
      const request = ++generation
      const result = await load()
      if (request === generation) publish(result)
    },
  }
}

export function outputLibraryKey(workspaceId: string, outputId: string): string {
  return JSON.stringify([workspaceId, outputId])
}

export function isVisibleLibraryOutput(output: OutputSummaryDTO): boolean {
  // Only the automatic session-board producer owns this pair of markers.
  return !(output.origin?.source === 'session' && output.origin.sessionId
    && output.tags?.includes('visual-board') && output.tags.includes('session-board'))
}

export function outputLibraryStatus(output: OutputSummaryDTO, isFinal = Boolean(output.finals?.length)): string | null {
  if (output.status === 'failed') return 'Failed'
  if (output.status === 'cancelled') return 'Cancelled'
  if (isFinal) return 'Final'
  if (output.approval?.state === 'changes_requested') return 'Changes requested'
  return null
}

export function outputLibraryTargets(workspaces: OutputLibraryWorkspace[], activeWorkspaceId: string | null, scopeWorkspaceId?: string, remoteActive = false): OutputLibraryWorkspace[] {
  if (!activeWorkspaceId) return []
  const activeIsRemote = remoteActive || Boolean(workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.remoteServer)
  return workspaces.filter((workspace, index) => workspaces.findIndex((entry) => entry.id === workspace.id) === index
    && (!scopeWorkspaceId || workspace.id === scopeWorkspaceId)
    && (activeIsRemote ? workspace.id === activeWorkspaceId : !workspace.remoteServer))
}

export function releaseKitOutputKeys(campaignId: string, items: ReleaseKitItem[]): string[] {
  return items.flatMap((item) => {
    if (item.campaignId !== campaignId || item.status !== 'ready') return []
    if (item.source.type === 'output') return [outputLibraryKey(item.source.sourceWorkspaceId ?? campaignId, item.source.outputId)]
    if (item.source.type === 'legacy-final') return [outputLibraryKey(campaignId, item.source.outputId)]
    return []
  })
}
