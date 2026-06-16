import { mkdir, rm, writeFile, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { getSourceCredentialManager, type LoadedSource } from '@craft-agent/shared/sources'

const YOUTUBE_INTELLIGENCE_SOURCE_SLUG = 'youtube-intelligence'

export function getYouTubeIntelligenceCredentialCachePath(): string {
  return join(homedir(), '.config', 'runneros', 'youtube-intelligence', 'credentials.json')
}

export async function writeYouTubeIntelligenceCredentialCache(supadataApiKey: string): Promise<void> {
  const cachePath = getYouTubeIntelligenceCredentialCachePath()
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify({
    supadataApiKey,
    updatedAt: Date.now(),
  }, null, 2), 'utf8')
  await chmod(cachePath, 0o600).catch(() => undefined)
}

export async function clearYouTubeIntelligenceCredentialCache(): Promise<void> {
  await rm(getYouTubeIntelligenceCredentialCachePath(), { force: true })
}

export async function syncYouTubeIntelligenceCredentialCache(source: LoadedSource): Promise<void> {
  if (source.config.slug !== YOUTUBE_INTELLIGENCE_SOURCE_SLUG) return

  const cred = await getSourceCredentialManager().loadEffective(source)
  if (!cred?.value) {
    await clearYouTubeIntelligenceCredentialCache()
    return
  }

  await writeYouTubeIntelligenceCredentialCache(cred.value)
}
