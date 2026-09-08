import { parseRouteToNavigationState } from '../../shared/route-parser'
export type WorkspaceHomeKind = 'hq' | 'campaign' | 'lab' | 'general'

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
  if (!url.searchParams.get('panels') && !parseRouteToNavigationState(url.searchParams.get('route') ?? '')) {
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
