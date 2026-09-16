import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matter, stringifyFrontmatter } from '../config/frontmatter'
import { writeGlobalAgentToolRevision } from './storage'

test('agent tool edit retains unexposed focuses, routing, custom metadata and omitted options', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-revision-'))
  try {
    const file = join(root, 'example', 'AGENT.md'); mkdirSync(join(root, 'example'))
    const modes = [{ id: 'research', kind: 'focus', label: 'Research', description: 'Research well', primarySkillSlugs: ['research'] }]
    writeFileSync(file, stringifyFrontmatter('Original prompt', { name: 'Example', description: 'Original', skills: ['research'], model: 'saved-model', taskModes: modes, routing: { bestFor: ['research'] }, custom: { retain: true } }))
    const result = writeGlobalAgentToolRevision({ slug: 'example', metadata: { name: 'Example', description: 'Revised' }, systemPrompt: 'Revised prompt' }, { globalAgentsDir: root })
    const raw = matter(readFileSync(file, 'utf8'))
    expect(result.metadata.description).toBe('Revised')
    expect(raw.data.taskModes).toEqual(modes)
    expect(raw.data.routing).toEqual({ bestFor: ['research'] })
    expect(raw.data.custom).toEqual({ retain: true })
    expect(result.metadata.model).toBe('saved-model')
    const before = readFileSync(file, 'utf8')
    expect(() => writeGlobalAgentToolRevision({ slug: 'example', metadata: { name: 'Example', description: 'Bad', skills: [] }, systemPrompt: 'Bad prompt' }, { globalAgentsDir: root })).toThrow('invalidate saved focus cards')
    expect(readFileSync(file, 'utf8')).toBe(before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
