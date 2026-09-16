import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { matter, stringifyFrontmatter } from '../config/frontmatter'
import { STOCK_BUILDER_ROLE_BASELINES, applyArtistBuilderResponsibility } from './starter-templates'
import { LEGACY_MANAGER_TASK_MODES } from './task-mode-recipes/manager'
import { migrateBuilderResponsibility } from './builder-transition'

test.each(['current', 'older-routing', 'pre-input-supply'])('stock transition preserves fields and is idempotent (%s)', (variant) => {
  const root = mkdtempSync(join(tmpdir(), 'builder-transition-'))
  try {
    const prior = STOCK_BUILDER_ROLE_BASELINES.find(a => a.slug === 'concierge')!
    mkdirSync(join(root, prior.slug))
    const file = join(root, prior.slug, 'AGENT.md')
    const body = variant !== 'current' ? prior.systemPrompt.split('\n').map(line => {
      if (line.includes('If the job is repeatable,')) return '  - If the job is repeatable, design it as an automation; after confirmation, call `schedule_work`.'
      if (line.includes('If no native worker fits,')) return '  - If no worker fits, say so and propose the missing worker/skill.'
      return line
    }).filter(line => variant !== 'pre-input-supply' || !line.startsWith('  - When the artist answers a visible tracked-work input request')).join('\n') : prior.systemPrompt
    const original = stringifyFrontmatter(body, { ...prior.metadata, skills: prior.metadata.skills!.map(s => `legacy:${s}`), taskModes: LEGACY_MANAGER_TASK_MODES, custom: 'keep', model: 'saved-model' })
    writeFileSync(file, original)
    expect(migrateBuilderResponsibility({ globalAgentsDir: root }).updated).toEqual(['concierge'])
    const next = matter(readFileSync(file, 'utf8'))
    expect(next.data.custom).toBe('keep')
    expect(next.data.model).toBe('saved-model')
    expect(next.data.skills).toEqual(applyArtistBuilderResponsibility(prior, true).metadata.skills)
    expect(next.data.taskModes.some((m: { id: string }) => m.id === 'build-automate')).toBe(false)
    expect(readFileSync(join(root, '.builder-transition-backup/concierge.md'), 'utf8')).toBe(original)
    expect(migrateBuilderResponsibility({ globalAgentsDir: root }).updated).toEqual([])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('customized body is preserved verbatim and reported instead of overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-custom-'))
  try {
    const prior = STOCK_BUILDER_ROLE_BASELINES.find(a => a.slug === 'orchestrator')!
    mkdirSync(join(root, prior.slug))
    const file = join(root, prior.slug, 'AGENT.md')
    const original = stringifyFrontmatter(prior.systemPrompt + '\nMy custom instructions.', prior.metadata)
    writeFileSync(file, original)
    expect(migrateBuilderResponsibility({ globalAgentsDir: root }).customized).toEqual(['orchestrator'])
    expect(readFileSync(file, 'utf8')).toBe(original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('old routing with additional custom instructions remains untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-old-custom-'))
  try {
    const prior = STOCK_BUILDER_ROLE_BASELINES.find(a => a.slug === 'concierge')!
    mkdirSync(join(root, prior.slug))
    const file = join(root, prior.slug, 'AGENT.md')
    const body = prior.systemPrompt.split('\n').map(line => {
      if (line.includes('If the job is repeatable,')) return '  - If the job is repeatable, design it as an automation; after confirmation, call `schedule_work`.'
      if (line.includes('If no native worker fits,')) return '  - If no worker fits, say so and propose the missing worker/skill.'
      return line
    }).filter(line => !line.startsWith('  - When the artist answers a visible tracked-work input request')).join('\n') + '\nPreserve this custom direction.'
    const original = stringifyFrontmatter(body, prior.metadata)
    writeFileSync(file, original)
    expect(migrateBuilderResponsibility({ globalAgentsDir: root }).customized).toEqual(['concierge'])
    expect(readFileSync(file, 'utf8')).toBe(original)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
