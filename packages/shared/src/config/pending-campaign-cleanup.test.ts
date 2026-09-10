import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isWorkspaceInitializationBlockedByCampaignCleanup, readPendingCampaignCleanup } from './pending-campaign-cleanup'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pending-campaign-')))
  roots.push(root)
  return { root, directory: join(root, 'campaign-cleanup-transactions') }
}
test('without pending transactions normal initialization stays enabled', () => {
  const { root } = fixture()
  expect(isWorkspaceInitializationBlockedByCampaignCleanup(join(root, 'workspace'), readPendingCampaignCleanup(root))).toBe(false)
})
test.each(['corrupt', 'unknown', 'linked-journal-directory'] as const)('ambiguous %s journal suppresses recreation conservatively', scenario => {
  const { root, directory } = fixture()
  if (scenario === 'linked-journal-directory') symlinkSync(join(root, 'missing'), directory)
  else {
    mkdirSync(directory)
    writeFileSync(join(directory, scenario === 'corrupt' ? '11111111-1111-4111-8111-111111111111.json' : 'partial.tmp'), '{bad')
  }
  const pending = readPendingCampaignCleanup(root)
  expect(pending.blockAllWorkspaceInitialization).toBe(true)
  expect(isWorkspaceInitializationBlockedByCampaignCleanup(join(root, 'workspace'), pending)).toBe(true)
})
