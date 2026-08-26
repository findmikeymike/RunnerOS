import { expect, test } from 'bun:test'

import { PathProcessor } from './path-processor'

test('recognizes Trade God product configuration files', () => {
  const processor = new PathProcessor({ homeDir: '/Users/operator' })

  expect(processor.isConfigFile('/Users/operator/.trade-god/config.json')).toBe(true)
  expect(processor.isConfigFile('/Users/operator/.trade-god/preferences.json')).toBe(true)
  expect(processor.isConfigFile('/Users/operator/.trade-god/workspaces/trading/SKILL.md')).toBe(true)
})

test('does not classify sibling Runner product files as Trade God configuration', () => {
  const processor = new PathProcessor({ homeDir: '/Users/operator' })

  expect(processor.isConfigFile('/Users/operator/.craft-agent/config.json')).toBe(false)
  expect(processor.isConfigFile('/Users/operator/.craft-agent/preferences.json')).toBe(false)
})
