import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

// The proxy getter uses loadStoredConfig, which creates registered roots. Calling
// it first turns a recoverable rename into a source/staging collision.
test('campaign recovery precedes config-reading startup after single-instance admission', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
  const lock = source.indexOf('const gotTheLock = app.requestSingleInstanceLock()')
  const recovery = source.indexOf('campaignRecoveryWarnings = recoverCampaignCleanupTransactions()')
  const firstProxyRead = source.indexOf('applyConfiguredProxySettings()')
  const ready = source.indexOf('app.whenReady().then(')
  expect(lock).toBeGreaterThan(-1)
  expect(recovery).toBeGreaterThan(lock)
  expect(firstProxyRead).toBeGreaterThan(recovery)
  expect(ready).toBeGreaterThan(firstProxyRead)
  expect(source.slice(lock, recovery)).toContain("if (gotTheLock && RUNTIME_IDENTITY.variant === 'artist-os')")
})
