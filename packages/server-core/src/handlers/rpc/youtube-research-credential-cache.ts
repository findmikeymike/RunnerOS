import { join } from 'node:path'
import { getSourceCredentialManager, type LoadedSource } from '@craft-agent/shared/sources'
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity'

import { syncCredentialCache } from './credential-cache-publication'

const YOUTUBE_RESEARCH_SOURCE_SLUG = 'youtube-research'

export function getYouTubeResearchCredentialCachePath(): string {
  return join(RUNTIME_IDENTITY.integrationCacheRoot, 'youtube-research', 'credentials.json')
}

export async function syncYouTubeResearchCredentialCache(source: LoadedSource): Promise<void> {
  if (source.config.slug !== YOUTUBE_RESEARCH_SOURCE_SLUG) return

  await syncCredentialCache(getYouTubeResearchCredentialCachePath(), async () => {
    const cred = await getSourceCredentialManager().loadEffective(source)
    if (!cred?.value) return null
    // The wrapper reads this shared cache when preparing the CLI environment.
    return { apiKey: cred.value, updatedAt: Date.now() }
  })
}
