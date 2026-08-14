import { mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { getSourceCredentialManager, readGoogleAdsCredentialValue, type LoadedSource } from '@craft-agent/shared/sources'
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity'

const GOOGLE_ADS_SOURCE_SLUG = 'google-ads'

export function getGoogleAdsCredentialCachePath(): string {
  return join(RUNTIME_IDENTITY.integrationCacheRoot, 'google-ads', 'credentials.json')
}

export async function syncGoogleAdsCredentialCache(source: LoadedSource): Promise<void> {
  if (source.config.slug !== GOOGLE_ADS_SOURCE_SLUG) return

  const cachePath = getGoogleAdsCredentialCachePath()
  const cred = await getSourceCredentialManager().loadEffective(source)
  if (!cred?.value) {
    await rm(cachePath, { force: true })
    return
  }

  const parsed = readGoogleAdsCredentialValue(cred.value)
  const payload = {
    accessToken: parsed.accessToken,
    developerToken: parsed.developerToken,
    loginCustomerId: parsed.loginCustomerId,
    expiresAt: cred.expiresAt,
    updatedAt: Date.now(),
  }

  await mkdir(join(RUNTIME_IDENTITY.integrationCacheRoot, 'google-ads'), { recursive: true })
  await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8')
  await chmod(cachePath, 0o600).catch(() => undefined)
}
