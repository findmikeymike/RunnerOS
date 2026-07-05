export interface ArtistWorkspaceLike {
  id: string
  name: string
  slug?: string
}

export function isArtistHQWorkspace(
  workspace: ArtistWorkspaceLike | undefined,
  _workspaces: ArtistWorkspaceLike[],
): boolean {
  if (!workspace) return false
  const text = `${workspace.name} ${workspace.slug ?? ''}`.toLowerCase()
  return /\b(m|master|artist hq|global|hq|my workspace|my-workspace)\b/.test(text)
}

export function findArtistHQWorkspace(workspaces: ArtistWorkspaceLike[]): ArtistWorkspaceLike | undefined {
  return workspaces.find((workspace) => isArtistHQWorkspace(workspace, workspaces))
}

export function findPrimaryCampaignWorkspace(workspaces: ArtistWorkspaceLike[]): ArtistWorkspaceLike | undefined {
  const campaignWorkspaces = workspaces.filter((workspace) => !isArtistHQWorkspace(workspace, workspaces))
  return campaignWorkspaces.find((workspace) => {
    const text = `${workspace.name} ${workspace.slug ?? ''}`.toLowerCase()
    return /\b(campaign|release|rollout|single|album|ep)\b/.test(text)
  }) ?? campaignWorkspaces[0]
}
