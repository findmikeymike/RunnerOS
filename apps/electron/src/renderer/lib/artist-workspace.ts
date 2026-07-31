export interface ArtistWorkspaceLike {
  id: string
  name: string
  slug?: string
  artistWorkspaceScope?: 'hq' | 'campaign' | 'general'
}

export function isArtistHQWorkspace(
  workspace: ArtistWorkspaceLike | undefined,
  _workspaces: ArtistWorkspaceLike[],
): boolean {
  if (!workspace) return false
  if (workspace.artistWorkspaceScope) return workspace.artistWorkspaceScope === 'hq'
  const text = `${workspace.name} ${workspace.slug ?? ''}`.toLowerCase()
  return /\b(m|master|artist hq|global|hq|my workspace|my-workspace)\b/.test(text)
}

export function findArtistHQWorkspace(workspaces: ArtistWorkspaceLike[]): ArtistWorkspaceLike | undefined {
  return workspaces.find((workspace) => isArtistHQWorkspace(workspace, workspaces))
}

export function isArtistCampaignWorkspace(workspace: ArtistWorkspaceLike | undefined): boolean {
  if (!workspace) return false
  if (workspace.artistWorkspaceScope) return workspace.artistWorkspaceScope === 'campaign'
  const text = `${workspace.name} ${workspace.slug ?? ''}`.toLowerCase()
  return /\b(campaign|release|rollout|single|album|ep|mixtape|tour)\b/.test(text)
}

export function findPrimaryCampaignWorkspace(workspaces: ArtistWorkspaceLike[]): ArtistWorkspaceLike | undefined {
  return workspaces.find((workspace) => isArtistCampaignWorkspace(workspace))
}
