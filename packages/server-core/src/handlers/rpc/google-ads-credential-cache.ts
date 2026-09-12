import { join } from 'node:path'
import { getSourceCredentialManager, readGoogleAdsCredentialValue, type LoadedSource } from '@craft-agent/shared/sources'
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity'

import { syncCredentialCache } from './credential-cache-publication'

const GOOGLE_ADS_SOURCE_SLUG = 'google-ads'

export function getGoogleAdsCredentialCachePath(): string {
  return join(RUNTIME_IDENTITY.integrationCacheRoot, 'google-ads', 'credentials.json')
}

export async function syncGoogleAdsCredentialCache(source: LoadedSource): Promise<void> {
  if (source.config.slug !== GOOGLE_ADS_SOURCE_SLUG) return

  await syncCredentialCache(getGoogleAdsCredentialCachePath(), async () => {
    const cred = await getSourceCredentialManager().loadEffective(source)
    if (!cred?.value) return null
    const parsed = readGoogleAdsCredentialValue(cred.value)
    return {
      accessToken: parsed.accessToken,
      developerToken: parsed.developerToken,
      loginCustomerId: parsed.loginCustomerId,
      expiresAt: cred.expiresAt,
      updatedAt: Date.now(),
    }
  })
}
