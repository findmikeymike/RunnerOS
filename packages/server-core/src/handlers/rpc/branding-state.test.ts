import { expect, test } from 'bun:test'
import { join } from 'node:path'
test('Branding approval persistence, conflicts, permissions and removals', async () => {
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, 'branding-state.isolated.ts')], {stdout:'pipe',stderr:'pipe'})
  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0)
}, 30000)
