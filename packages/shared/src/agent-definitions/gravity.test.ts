import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GRAVITY_AGENT } from './gravity.ts'
import { STARTER_AGENTS } from './starter-templates.ts'
import { REQUIRED_BUILTIN_AGENT_SLUGS, defaultWorkerSlugs } from './registration.ts'
import { initialAgentSlugsForWorkspace, isAgentAllowedInArtistWorkspace } from './defaults.ts'
import { resolveAgentTaskMode, resolveAgentSessionTaskMode } from './task-modes.ts'
import { resolveAgentReferences } from './references.ts'
import { deleteGlobalAgent, ensureRequiredAgents, loadGlobalAgent, parseAgentFile, serializeAgent } from './storage.ts'
import { BUNDLED_STARTER_SKILLS } from '../skills/bundled.generated.ts'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('GRAVITY integration', () => {
  test('HQ roster and new defaults contain one GRAVITY without changing saved activation or other scopes', () => {
    expect(STARTER_AGENTS.filter(agent => agent.slug === 'gravity')).toHaveLength(1)
    expect(REQUIRED_BUILTIN_AGENT_SLUGS).toContain('gravity')
    expect(defaultWorkerSlugs(false).filter(slug => slug === 'gravity')).toHaveLength(1)
    expect(initialAgentSlugsForWorkspace('hq', false).filter(slug => slug === 'gravity')).toHaveLength(1)
    for (const scope of ['hq', 'campaign', 'lab', 'general'] as const) {
      expect(initialAgentSlugsForWorkspace(scope, true)).not.toContain('gravity')
      expect(isAgentAllowedInArtistWorkspace('gravity', scope)).toBe(scope === 'hq')
    }
    expect(defaultWorkerSlugs(true)).not.toContain('gravity')
    expect(initialAgentSlugsForWorkspace('campaign', false)).not.toContain('gravity')
  })

  test('saved definition round-trips and both focused and ordinary sessions resolve the bundled recipe', () => {
    const parsed = parseAgentFile(serializeAgent(GRAVITY_AGENT.metadata, GRAVITY_AGENT.systemPrompt))!
    expect(parsed.metadata).toMatchObject(GRAVITY_AGENT.metadata)
    const agent = { ...parsed, slug: 'gravity' }
    const focused = resolveAgentTaskMode(agent, 'find-gravity')!
    expect(focused.primarySkillSlugs).toEqual(['gravity'])
    expect(focused.context?.preloadTopics).toEqual(['artist-profile', 'artist-voice', 'artist-branding'])
    expect(resolveAgentSessionTaskMode(agent, undefined)).toBeDefined()
    const installed = BUNDLED_STARTER_SKILLS.map(skill => ({ slug: skill.slug }))
    expect(resolveAgentReferences(agent, installed, [])).toMatchObject({ resolvedSkills: ['gravity'], missingSkills: [], missingSources: [], resolvedSources: [] })
    expect(resolveAgentReferences(agent, [], []).missingSkills).toEqual(['gravity'])
    expect(parsed.metadata.permissionMode).toBe('ask')
    expect(parsed.metadata.trustedWorkerTools).toEqual(['create_output'])
  })

  test('bundled recipe and every relative reference are shipped exactly from source', () => {
    const skill = BUNDLED_STARTER_SKILLS.find(entry => entry.slug === 'gravity')!
    expect(skill).toBeDefined()
    const main = skill.files.find(file => file.path === 'SKILL.md')!.content
    const links = [...main.matchAll(/\]\((references\/[^)]+)\)/g)].map(match => match[1]!)
    expect(links.length).toBeGreaterThan(0)
    for (const path of ['SKILL.md', ...links]) {
      const shipped = skill.files.find(file => file.path === path)
      expect(shipped).toBeDefined()
      const source = readFileSync(new URL(`../skills/bundled/gravity/${path}`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '')
      expect(shipped!.content).toBe(source)
    }
  })

  test('definition recovery is idempotent and preserves customization and deliberate deletion', () => {
    const globalAgentsDir = mkdtempSync(join(tmpdir(), 'gravity-registration-'))
    directories.push(globalAgentsDir)
    const options = { globalAgentsDir }
    expect(ensureRequiredAgents([GRAVITY_AGENT], options).ensured).toBe(1)
    expect(loadGlobalAgent('gravity', options)?.metadata.name).toBe('GRAVITY')
    const path = join(globalAgentsDir, 'gravity', 'AGENT.md')
    const custom = readFileSync(path, 'utf8') + '\nKeep my personal creative preference.\n'
    writeFileSync(path, custom)
    expect(ensureRequiredAgents([GRAVITY_AGENT], options).ensured).toBe(0)
    expect(readFileSync(path, 'utf8')).toBe(custom)
    deleteGlobalAgent('gravity', [], options)
    expect(ensureRequiredAgents([GRAVITY_AGENT], options).ensured).toBe(0)
    expect(loadGlobalAgent('gravity', options)).toBeNull()
  })
})
