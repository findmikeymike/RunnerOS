import { parseRouteToNavigationState } from '../../shared/route-parser'
export type WorkspaceHomeKind = 'hq' | 'campaign' | 'lab' | 'general'

function routeBelongsToWorkspace(route: string, kind: WorkspaceHomeKind): boolean {
  const state = parseRouteToNavigationState(route)
  if (state?.navigator === 'campaign') return kind === 'campaign' || kind === 'general'
  if (state?.navigator === 'lab') return kind === 'lab' || kind === 'general'
  return true
}

/** Only the query/hash belong to a workspace; never restore an origin or file path. */
export function workspaceLocation(search: string, hash: string): string {
  return `${search}${hash}`
}

export function restoreWorkspaceLocation(currentHref: string, saved: string, slug: string, kind: WorkspaceHomeKind): URL {
  const url = new URL(currentHref)
  url.search = ''
  url.hash = ''
  if (saved.startsWith('?')) {
    const hashIndex = saved.indexOf('#')
    url.search = hashIndex < 0 ? saved : saved.slice(0, hashIndex)
    url.hash = hashIndex < 0 ? '' : saved.slice(hashIndex)
  }
  // Main-process bootstrap IDs and one-shot launch flags must not cross workspaces.
  for (const key of ['workspaceId', 'sessionId', 'focused']) url.searchParams.delete(key)
  url.searchParams.set('ws', slug)
  // Older creation flows could save the new campaign's route under the outgoing
  // HQ. A syntactically valid route still has to belong to this workspace.
  const route = url.searchParams.get('route') ?? ''
  const panels = url.searchParams.get('panels')
  const hasForeignRoute = !routeBelongsToWorkspace(route, kind)
    || Boolean(panels?.split(',').some(entry => {
      const colon = entry.lastIndexOf(':')
      return !routeBelongsToWorkspace(colon > 0 ? entry.slice(0, colon) : entry, kind)
    }))
  if (hasForeignRoute || (!panels && !parseRouteToNavigationState(route))) {
    url.searchParams.delete('panels')
    url.searchParams.delete('fi')
    url.hash = ''
    url.searchParams.set('route', kind === 'campaign' ? 'campaign' : kind === 'lab' ? 'lab' : 'allSessions')
    if (kind === 'hq') url.hash = '#artist-hq/home'
  }
  if (kind !== 'hq' && url.hash.startsWith('#artist-hq/')) url.hash = ''
  return url
}

export function canPersistWorkspaceLocation(url: URL, workspaceSlug: string | null, restoringSlug: string | null): boolean {
  return Boolean(workspaceSlug && url.searchParams.get('ws') === workspaceSlug
    && (!restoringSlug || restoringSlug === workspaceSlug))
}
