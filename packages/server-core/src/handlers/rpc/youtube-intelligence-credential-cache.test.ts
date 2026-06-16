import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'

const sandboxHome = mkdtempSync(join(os.tmpdir(), 'youtube-intelligence-cache-home-'))

mock.module('node:os', () => ({
  ...os,
  homedir: () => sandboxHome,
}))

const cache = await import(`./youtube-intelligence-credential-cache.ts?test=${process.pid}-${Date.now()}`)

afterEach(async () => {
  await cache.clearYouTubeIntelligenceCredentialCache()
})

afterAll(() => {
  rmSync(sandboxHome, { recursive: true, force: true })
})

describe('YouTube Intelligence credential cache', () => {
  test('writes Supadata key to CLI-readable cache file', async () => {
    await cache.writeYouTubeIntelligenceCredentialCache('supadata-test-key')

    const path = cache.getYouTubeIntelligenceCredentialCachePath()
    expect(path).toBe(join(sandboxHome, '.config', 'runneros', 'youtube-intelligence', 'credentials.json'))
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      supadataApiKey: 'supadata-test-key',
    })
  })

  test('clears CLI-readable cache file', async () => {
    await cache.writeYouTubeIntelligenceCredentialCache('supadata-test-key')
    const path = cache.getYouTubeIntelligenceCredentialCachePath()
    expect(existsSync(path)).toBe(true)

    await cache.clearYouTubeIntelligenceCredentialCache()

    expect(existsSync(path)).toBe(false)
  })
})
