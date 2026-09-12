import { afterAll, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LoadedSource } from '@craft-agent/shared/sources'

const cacheRoot = mkdtempSync(join(tmpdir(), 'credential-cache-test-'))
let load: () => Promise<{ value: string } | null> = async () => null
mock.module('@craft-agent/shared/config/runtime-identity', () => ({ RUNTIME_IDENTITY: { integrationCacheRoot: cacheRoot } }))
mock.module('@craft-agent/shared/sources', () => ({
  getSourceCredentialManager: () => ({ loadEffective: () => load() }),
  readGoogleAdsCredentialValue: (value: string) => ({ accessToken: value }),
}))
const google = await import('./google-ads-credential-cache')
const youtube = await import('./youtube-research-credential-cache')
afterAll(() => rmSync(cacheRoot, { recursive: true, force: true }))

for (const [slug, sync, path, field] of [
  ['google-ads', google.syncGoogleAdsCredentialCache, google.getGoogleAdsCredentialCachePath, 'accessToken'],
  ['youtube-research', youtube.syncYouTubeResearchCredentialCache, youtube.getYouTubeResearchCredentialCachePath, 'apiKey'],
] as const) {
  for (const old of ['old-account', null]) {
    test(`${slug}: late ${old ? 'old credential' : 'disconnect'} cannot replace the newer cache`, async () => {
      let release!: (value: { value: string } | null) => void
      const source = { config: { slug } } as LoadedSource
      load = () => new Promise(resolve => { release = resolve })
      const first = sync(source)
      await new Promise<void>(resolve => setImmediate(resolve))
      let secondLoaded = false
      load = async () => { secondLoaded = true; return { value: 'new-account' } }
      const second = sync(source)
      await new Promise<void>(resolve => setImmediate(resolve))
      // On the unfenced implementation, let the already-started newer write finish.
      if (secondLoaded) await second
      release(old ? { value: old } : null)
      await Promise.all([first, second])
      expect(existsSync(path())).toBe(true)
      expect(JSON.parse(readFileSync(path(), 'utf8'))[field]).toBe('new-account')
      expect(statSync(path()).mode & 0o777).toBe(0o600)
    })
  }
}


const { syncCredentialCache } = await import('./credential-cache-publication')

test('failed publication preserves a good cache and does not poison later syncs', async () => {
  const path = join(cacheRoot, 'failure', 'credentials.json')
  await syncCredentialCache(path, async () => ({ token: 'good' }))
  await expect(syncCredentialCache(path, async () => ({ token: 1n }))).rejects.toThrow()
  expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe('good')
  await syncCredentialCache(path, async () => ({ token: 'recovered' }))
  expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe('recovered')
})

test('rename failure cleans staging files and later publication recovers', async () => {
  const path = join(cacheRoot, 'rename-failure', 'credentials.json')
  mkdirSync(path, { recursive: true })
  await expect(syncCredentialCache(path, async () => ({ token: 'unpublished' }))).rejects.toThrow()
  expect(readdirSync(join(cacheRoot, 'rename-failure'))).toEqual(['credentials.json'])
  rmSync(path, { recursive: true })
  await syncCredentialCache(path, async () => ({ token: 'recovered' }))
  expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe('recovered')
})

test('readers keep the previous complete cache while resolution is pending; latest disconnect clears it', async () => {
  const path = join(cacheRoot, 'reader', 'credentials.json')
  await syncCredentialCache(path, async () => ({ token: 'previous' }))
  let release!: (value: Record<string, unknown>) => void
  const pending = syncCredentialCache(path, () => new Promise(resolve => { release = resolve }))
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(JSON.parse(readFileSync(path, 'utf8')).token).toBe('previous')
  release({ token: 'x'.repeat(2 * 1024 * 1024) })
  await pending
  expect(JSON.parse(readFileSync(path, 'utf8')).token.length).toBe(2 * 1024 * 1024)
  await syncCredentialCache(path, async () => null)
  expect(existsSync(path)).toBe(false)
})
