import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BUILTIN_AGENT_REGISTRATIONS, REQUIRED_BUILTIN_AGENT_SLUGS, defaultWorkerSlugs } from './registration.ts'
import { initialAgentSlugsForWorkspace, isAgentAllowedInArtistWorkspace, LAB_DEFAULT_ACTIVATED_AGENT_SLUGS } from './defaults.ts'
import { STARTER_AGENTS } from './starter-templates.ts'
import { deleteGlobalAgent, ensureRequiredAgents, loadGlobalAgent } from './storage.ts'

const temporaryDirectories: string[] = []
afterEach(() => { for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('built-in registration policy', () => {
  test('every bundled definition has exactly one registration and all visible defaults can recover', () => {
    const registered = BUILTIN_AGENT_REGISTRATIONS.map(entry => entry.slug)
    expect(new Set(registered).size).toBe(registered.length)
    expect([...registered].sort()).toEqual(STARTER_AGENTS.map(agent => agent.slug).sort())
    for (const slug of [...defaultWorkerSlugs(false), ...defaultWorkerSlugs(true), ...LAB_DEFAULT_ACTIVATED_AGENT_SLUGS]) {
      expect(REQUIRED_BUILTIN_AGENT_SLUGS).toContain(slug)
    }
    for (const slug of ['raw-video-editor', 'youtube-research-agent', 'persona-agent', 'community-agent']) {
      expect(REQUIRED_BUILTIN_AGENT_SLUGS).toContain(slug)
    }
    expect(registered).not.toContain('gaygent-master')
  })

  test('Lab admits its creative team and runtime helpers, excludes other built-ins, and preserves custom workers', () => {
    const allowed = new Set([...LAB_DEFAULT_ACTIVATED_AGENT_SLUGS, 'song-director', 'concierge', 'setup-concierge', 'orchestrator'])
    for (const { slug } of BUILTIN_AGENT_REGISTRATIONS) {
      expect(isAgentAllowedInArtistWorkspace(slug, 'lab')).toBe(allowed.has(slug))
    }
    expect(isAgentAllowedInArtistWorkspace('my-custom-writer', 'lab')).toBe(true)
    expect(isAgentAllowedInArtistWorkspace('gaygent-master', 'lab')).toBe(true)
    expect(isAgentAllowedInArtistWorkspace('legal-agent', 'campaign')).toBe(false)
    expect(isAgentAllowedInArtistWorkspace('artist-os-release-manager', 'hq')).toBe(false)
    expect(isAgentAllowedInArtistWorkspace('catalog-royalty-agent', 'campaign')).toBe(true)
  })

  test('existing roots never receive implicit default activation', () => {
    for (const scope of ['hq', 'campaign', 'lab', 'general', undefined] as const) {
      expect(initialAgentSlugsForWorkspace(scope, true)).toEqual([])
    }
    expect(initialAgentSlugsForWorkspace('hq', false)).toHaveLength(6)
    expect(initialAgentSlugsForWorkspace('campaign', false)).toHaveLength(6)
    expect(initialAgentSlugsForWorkspace('lab', false)).toHaveLength(6)
  })

  test('recovery restores missing and corrupt definitions, preserves edits and deletion tombstones', () => {
    const globalAgentsDir = mkdtempSync(join(tmpdir(), 'registration-recovery-'))
    temporaryDirectories.push(globalAgentsDir)
    const options = { globalAgentsDir }
    const required = STARTER_AGENTS.filter(agent => REQUIRED_BUILTIN_AGENT_SLUGS.includes(agent.slug))
    expect(ensureRequiredAgents(required, options).ensured).toBe(required.length)
    const missingFile = join(globalAgentsDir, 'raw-video-editor', 'AGENT.md')
    rmSync(missingFile)
    const corruptFile = join(globalAgentsDir, 'community-agent', 'AGENT.md')
    writeFileSync(corruptFile, '---\nname: [broken')
    deleteGlobalAgent('persona-agent', [], options)
    const editedFile = join(globalAgentsDir, 'youtube-research-agent', 'AGENT.md')
    const edited = readFileSync(editedFile, 'utf8') + '\nCustom instruction preserved.\n'
    writeFileSync(editedFile, edited)
    expect(ensureRequiredAgents(required, options).ensured).toBe(2)
    expect(loadGlobalAgent('raw-video-editor', options)).not.toBeNull()
    expect(loadGlobalAgent('community-agent', options)).not.toBeNull()
    expect(loadGlobalAgent('persona-agent', options)).toBeNull()
    expect(readFileSync(editedFile, 'utf8')).toBe(edited)
    expect(ensureRequiredAgents(required, options).ensured).toBe(0)
  })
})
