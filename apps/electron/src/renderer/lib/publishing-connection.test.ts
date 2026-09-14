import { describe, expect, it, mock } from 'bun:test'
import type { ElectronAPI, LoadedSource, SourceCredentialScopeResult } from '../../shared/types'
import { preparePublishingConnection } from './publishing-connection'

function setup(slug: 'trypost' | 'postiz', tier: LoadedSource['tier'] = 'workspace') {
  const source = { config: { slug }, tier } as LoadedSource
  const scope = { canAuthenticate: true, canOverride: false } as SourceCredentialScopeResult
  const api = {
    getSources: mock(async () => [source]),
    getSourceCredentialScope: mock(async () => scope),
    setGlobalSourceEnabled: mock(async () => [slug]),
  } satisfies Pick<ElectronAPI, 'getSources' | 'getSourceCredentialScope' | 'setGlobalSourceEnabled'>
  return { api, source, scope }
}

describe('publishing connection credential flow', () => {
  for (const slug of ['trypost', 'postiz'] as const) {
    it(`opens ${slug} workspace credentials without navigating to Tools`, async () => {
      const { api, source, scope } = setup(slug)
      expect(await preparePublishingConnection(api, 'artist', slug)).toEqual({ source, sourceSlug: slug, workspaceId: 'artist', credentialScope: scope, mode: 'workspace' })
      expect(api.getSourceCredentialScope).toHaveBeenCalledWith('artist', slug)
      expect(api.setGlobalSourceEnabled).not.toHaveBeenCalled()
    })
  }
  it('preserves a workspace override for shared global connections', async () => {
    const { api, scope } = setup('postiz', 'global')
    scope.canOverride = true
    expect((await preparePublishingConnection(api, 'artist', 'postiz')).mode).toBe('override')
  })
  it('activates a dormant global connection before opening credentials', async () => {
    const { api, source } = setup('trypost', 'global-dormant')
    api.setGlobalSourceEnabled.mockImplementation(async () => { source.tier = 'global'; return ['trypost'] })
    expect((await preparePublishingConnection(api, 'artist', 'trypost')).mode).toBe('global')
    expect(api.setGlobalSourceEnabled).toHaveBeenCalledWith('artist', 'trypost', true)
    expect(api.getSources).toHaveBeenCalledTimes(2)
  })
  it('blocks an unavailable service and a missing workspace', async () => {
    const { api } = setup('postiz')
    await expect(preparePublishingConnection(api, null, 'postiz')).rejects.toThrow('Select a workspace')
    expect(api.getSources).not.toHaveBeenCalled()
    api.getSources.mockResolvedValue([])
    await expect(preparePublishingConnection(api, 'artist', 'postiz')).rejects.toThrow('unavailable')
    expect(api.getSourceCredentialScope).not.toHaveBeenCalled()
  })
  it('respects denied credential access', async () => {
    const { api, scope } = setup('postiz')
    scope.canAuthenticate = false
    await expect(preparePublishingConnection(api, 'artist', 'postiz')).rejects.toThrow('current access')
  })
})
