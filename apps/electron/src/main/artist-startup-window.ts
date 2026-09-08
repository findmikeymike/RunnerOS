import type { CreateWindowOptions } from './window-manager'

/** Ordinary app opens land in HQ; explicit window/deep-link requests bypass this policy. */
export function artistStartupWindow(
  variant: string,
  workspaces: ReadonlyArray<{ id: string; artistWorkspaceScope?: string }>,
): CreateWindowOptions | null {
  if (variant !== 'artist-os') return null
  const hq = workspaces.find(workspace => workspace.artistWorkspaceScope === 'hq')
  return hq ? { workspaceId: hq.id, initialPage: 'hq-overview' } : null
}
