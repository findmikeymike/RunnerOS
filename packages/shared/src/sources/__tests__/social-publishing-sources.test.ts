import { describe, expect, test } from 'bun:test'
import { getBuiltinSources, getPostizSource, getTryPostSource, isBuiltinSource } from '../builtin-sources.ts'

describe('built-in provider social publishing sources', () => {
  test('TryPost uses the official hosted MCP with bearer auth', () => {
    const source = getTryPostSource('workspace', '/tmp/workspace')
    expect(source.config.slug).toBe('trypost')
    expect(source.config.type).toBe('mcp')
    expect(source.config.mcp?.url).toBe('https://app.trypost.it/mcp/trypost')
    expect(source.config.mcp?.authType).toBe('bearer')
    expect(source.guide?.raw).toContain('list connected social accounts')
    expect(source.guide?.raw).toContain('explicit user approval')
  })

  test('Postiz uses the official hosted MCP and states its reply boundary', () => {
    const source = getPostizSource('workspace', '/tmp/workspace')
    expect(source.config.slug).toBe('postiz')
    expect(source.config.type).toBe('mcp')
    expect(source.config.mcp?.url).toBe('https://api.postiz.com/mcp')
    expect(source.config.mcp?.authType).toBe('bearer')
    expect(source.guide?.raw).toContain('integrationList')
    expect(source.guide?.raw).toContain('integrationSchema')
    expect(source.guide?.raw).toContain('does not currently read or reply to comments or DMs')
  })

  test('both provider sources are bundled and reserved', () => {
    const slugs = getBuiltinSources('workspace', '/tmp/workspace').map(source => source.config.slug)
    expect(slugs).toContain('trypost')
    expect(slugs).toContain('postiz')
    expect(isBuiltinSource('trypost')).toBe(true)
    expect(isBuiltinSource('postiz')).toBe(true)
  })
})
