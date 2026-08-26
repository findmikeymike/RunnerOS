import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { resolveLogoutConfigPath } from './auth'

test('resolves logout deletion inside the owning product root', () => {
  const tradeGodRoot = '/Users/operator/.trade-god'
  expect(resolveLogoutConfigPath(tradeGodRoot)).toBe(join(tradeGodRoot, 'config.json'))
  expect(resolveLogoutConfigPath(tradeGodRoot)).not.toContain('.craft-agent')
})
