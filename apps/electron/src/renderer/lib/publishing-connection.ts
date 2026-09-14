import type { ElectronAPI, LoadedSource, SourceCredentialScopeResult } from '../../shared/types'

export type PublishingConnection = {
  source: LoadedSource
  sourceSlug: string
  workspaceId: string
  credentialScope: SourceCredentialScopeResult
  mode: 'workspace' | 'override' | 'global'
}

/** Open the existing encrypted credential flow directly from social settings. */
export async function preparePublishingConnection(
  api: Pick<ElectronAPI, 'getSources' | 'getSourceCredentialScope' | 'setGlobalSourceEnabled'>,
  workspaceId: string | null | undefined,
  sourceSlug: 'trypost' | 'postiz',
): Promise<PublishingConnection> {
  if (!workspaceId) throw new Error('Select a workspace before connecting a publishing service.')
  let source = (await api.getSources(workspaceId)).find((item) => item.config.slug === sourceSlug)
  if (source?.tier === 'global-dormant') {
    await api.setGlobalSourceEnabled(workspaceId, sourceSlug, true)
    source = (await api.getSources(workspaceId)).find((item) => item.config.slug === sourceSlug)
  }
  if (!source) throw new Error('Publishing service is unavailable in this workspace. Refresh and try again.')
  const credentialScope = await api.getSourceCredentialScope(workspaceId, sourceSlug)
  if (!credentialScope.canAuthenticate && !credentialScope.canOverride) {
    throw new Error('This publishing connection cannot be changed with your current access.')
  }
  return {
    source,
    sourceSlug,
    workspaceId,
    credentialScope,
    mode: credentialScope.canOverride ? 'override' : source.tier === 'global' ? 'global' : 'workspace',
  }
}
