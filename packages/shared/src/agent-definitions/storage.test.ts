import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseAgentFile,
  serializeAgent,
  isValidAgentSlug,
  readActivatedAgents,
  writeActivatedAgents,
  setAgentActive,
  loadActivatedAgents,
  loadAllGlobalAgents,
  loadGlobalAgent,
  writeGlobalAgent,
  deleteGlobalAgent,
  seedGlobalLibraryIfEmpty,
  ensureRequiredAgents,
  ensureBuiltInAgentMetadataSlugs,
  ensureBuiltInAgentSkills,
  ensureBuiltInAgentSkillsForSlug,
  dedupeBuiltInAgentPromptText,
  replaceBuiltInAgentMetadata,
  replaceBuiltInAgentPromptPattern,
  replaceBuiltInAgentPromptText,
  removeBuiltInAgentSkills,
} from './storage.ts'
import { STARTER_AGENTS } from './starter-templates.ts'
import { ANYTHING_AGENT_SLUG, RELEASE_MANAGER_AGENT_SLUG, DEFAULT_ACTIVATED_AGENT_SLUGS, CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS, HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS, LAB_DEFAULT_ACTIVATED_AGENT_SLUGS, initialAgentSlugsForWorkspace, isReleaseManagerDefinition } from './defaults.ts'
import { SOCIAL_PUBLISHER_SLUG } from './types.ts'
import { BUNDLED_STARTER_SKILLS, STARTER_SKILLS } from '../skills/index.ts'
import * as publicAgentDefinitions from './index.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-test-'))
}

function tmpGlobalAgentsDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-global-test-'))
}

describe('isValidAgentSlug', () => {
  test('exports prompt deduplication through the public agent-definitions API', () => {
    expect(typeof publicAgentDefinitions.dedupeBuiltInAgentPromptText).toBe('function')
  })

  test('accepts standard slugs', () => {
    expect(isValidAgentSlug('research')).toBe(true)
    expect(isValidAgentSlug('writer-2')).toBe(true)
    expect(isValidAgentSlug('a')).toBe(true)
    expect(isValidAgentSlug('a1b2c3')).toBe(true)
  })

  test('rejects invalid slugs', () => {
    expect(isValidAgentSlug('')).toBe(false)
    expect(isValidAgentSlug('Research')).toBe(false) // uppercase
    expect(isValidAgentSlug('-leading')).toBe(false)
    expect(isValidAgentSlug('trailing-')).toBe(false)
    expect(isValidAgentSlug('has space')).toBe(false)
    expect(isValidAgentSlug('has.dot')).toBe(false)
    expect(isValidAgentSlug('a'.repeat(65))).toBe(false) // too long
  })
})

describe('parseAgentFile', () => {
  test('parses a fully-populated agent', () => {
    const md = `---
name: Research Agent
description: Digs deep on topics with citations.
avatar: 🔬
llmConnection: anthropic-default
model: claude-opus-4-7
permissionMode: ask
thinkingLevel: high
skills:
  - web-research
  - cite-sources
sources:
  - tavily
visualAgent: true
greeting: Give me a question, I'll dig.
---
You are a research specialist.
Always cite your sources.
`
    const parsed = parseAgentFile(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata.name).toBe('Research Agent')
    expect(parsed!.metadata.description).toBe('Digs deep on topics with citations.')
    expect(parsed!.metadata.avatar).toBe('🔬')
    expect(parsed!.metadata.llmConnection).toBe('anthropic-default')
    expect(parsed!.metadata.permissionMode).toBe('ask')
    expect(parsed!.metadata.thinkingLevel).toBe('high')
    expect(parsed!.metadata.skills).toEqual(['web-research', 'cite-sources'])
    expect(parsed!.metadata.sources).toEqual(['tavily'])
    expect(parsed!.metadata.visualAgent).toBe(true)
    expect(parsed!.metadata.greeting).toBe(`Give me a question, I'll dig.`)
    expect(parsed!.systemPrompt).toContain('research specialist')
    expect(parsed!.systemPrompt).toContain('cite your sources')
  })

  test('rejects when name is missing', () => {
    const md = `---
description: missing name
---
body
`
    expect(parseAgentFile(md)).toBeNull()
  })

  test('rejects when description is missing', () => {
    const md = `---
name: Solo
---
body
`
    expect(parseAgentFile(md)).toBeNull()
  })

  test('coerces invalid permissionMode to undefined and returns a warning', () => {
    const md = `---
name: x
description: y
permissionMode: GOD_MODE
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.permissionMode).toBeUndefined()
    expect(parsed!.warnings).toContainEqual({
      field: 'permissionMode',
      code: 'invalid-permission-mode',
      message: 'permissionMode must be one of: safe, ask, allow-all.',
    })
  })

  test('coerces invalid thinkingLevel to undefined and returns a warning', () => {
    const md = `---
name: x
description: y
thinkingLevel: galaxy-brain
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.thinkingLevel).toBeUndefined()
    expect(parsed!.warnings[0]?.field).toBe('thinkingLevel')
    expect(parsed!.warnings[0]?.code).toBe('invalid-thinking-level')
  })

  test('warns when skills and sources have invalid shapes', () => {
    const md = `---
name: x
description: y
skills:
  nested: nope
sources:
  - github
  - 123
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.skills).toBeUndefined()
    expect(parsed!.metadata.sources).toEqual(['github'])
    expect(parsed!.warnings.map((w) => w.field)).toEqual(['skills', 'sources'])
  })

  test('handles single-string skill / source as array', () => {
    const md = `---
name: x
description: y
skills: solo-skill
sources: solo-src
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.skills).toEqual(['solo-skill'])
    expect(parsed!.metadata.sources).toEqual(['solo-src'])
  })

  test('handles optional sources separately from required sources', () => {
    const md = `---
name: x
description: y
sources: zero
optionalSources:
  - gmail
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.sources).toEqual(['zero'])
    expect(parsed!.metadata.optionalSources).toEqual(['gmail'])
  })

  test('returns null on completely malformed YAML rather than throwing', () => {
    const md = `---
this is not: valid yaml: !!!! 😱
  - mixed: indent
   - bad
---
body
`
    // gray-matter is forgiving so this might still parse — the contract is
    // "never throw". Either null or an empty-required-fields rejection is OK.
    const parsed = parseAgentFile(md)
    expect(parsed === null || (!parsed.metadata.name)).toBe(true)
  })

  test('parses capability fields (inputs, outputs, tags)', () => {
    const md = `---
name: x
description: y
inputs: A topic and the depth.
outputs: A cited summary.
tags:
  - research
  - summarize
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.inputs).toBe('A topic and the depth.')
    expect(parsed!.metadata.outputs).toBe('A cited summary.')
    expect(parsed!.metadata.tags).toEqual(['research', 'summarize'])
  })

  test('accepts comma-separated tags string', () => {
    const md = `---
name: x
description: y
tags: research, summarize, cite
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.tags).toEqual(['research', 'summarize', 'cite'])
  })

  test('drops malformed tags with a warning', () => {
    const md = `---
name: x
description: y
tags:
  - research
  - "Bad Tag With Spaces"
  - SHOUTING
---
body
`
    const parsed = parseAgentFile(md)
    // SHOUTING normalizes to 'shouting' (valid); the spaces tag is dropped.
    expect(parsed!.metadata.tags).toEqual(['research', 'shouting'])
    expect(parsed!.warnings.some((w) => w.code === 'invalid-tags')).toBe(true)
  })

  test('caps tags at 8', () => {
    const md = `---
name: x
description: y
tags:
  - a
  - b
  - c
  - d
  - e
  - f
  - g
  - h
  - i
  - j
---
body
`
    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.tags).toHaveLength(8)
    expect(parsed!.warnings.some((w) => w.code === 'invalid-tags')).toBe(true)
  })
})

describe('serializeAgent', () => {
  test('round-trips through parse without losing fields', () => {
    const original = serializeAgent(
      {
        name: 'Round Trip',
        description: 'Tests serialization.',
        avatar: '🔄',
        llmConnection: 'anthropic-default',
        permissionMode: 'safe',
        skills: ['a', 'b'],
        sources: ['s1'],
        optionalSources: ['gmail'],
        trustedWorkerTools: ['start_deep_research'],
        visualAgent: true,
        inputs: 'A topic.',
        outputs: 'A summary.',
        tags: ['research', 'summarize'],
      },
      'You are a test agent.',
    )

    const parsed = parseAgentFile(original)
    expect(parsed!.metadata.name).toBe('Round Trip')
    expect(parsed!.metadata.avatar).toBe('🔄')
    expect(parsed!.metadata.permissionMode).toBe('safe')
    expect(parsed!.metadata.skills).toEqual(['a', 'b'])
    expect(parsed!.metadata.sources).toEqual(['s1'])
    expect(parsed!.metadata.optionalSources).toEqual(['gmail'])
    expect(parsed!.metadata.trustedWorkerTools).toEqual(['start_deep_research'])
    expect(parsed!.metadata.visualAgent).toBe(true)
    expect(parsed!.metadata.inputs).toBe('A topic.')
    expect(parsed!.metadata.outputs).toBe('A summary.')
    expect(parsed!.metadata.tags).toEqual(['research', 'summarize'])
    expect(parsed!.systemPrompt).toBe('You are a test agent.')
  })

  test('omits empty arrays and undefined fields from frontmatter', () => {
    const out = serializeAgent(
      { name: 'minimal', description: 'just enough' },
      'system prompt',
    )
    // No empty `skills: []` or `sources: []` in the YAML.
    expect(out).not.toContain('skills:')
    expect(out).not.toContain('sources:')
    expect(out).not.toContain('visualAgent:')
    expect(out).not.toContain('avatar:')
  })
})

describe('activation manifest', () => {
  let workspace: string

  beforeEach(() => {
    workspace = tmpWorkspace()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  test('returns empty manifest when file does not exist', () => {
    const manifest = readActivatedAgents(workspace)
    expect(manifest.version).toBe(1)
    expect(manifest.active).toEqual([])
  })

  test('writes and reads back', () => {
    const written = writeActivatedAgents(workspace, ['research', 'writer'])
    expect(written.active).toEqual(['research', 'writer'])
    const read = readActivatedAgents(workspace)
    expect(read.active).toEqual(['research', 'writer'])
  })

  test('dedups + filters invalid slugs on write', () => {
    const written = writeActivatedAgents(workspace, ['research', 'research', 'BAD-SLUG', 'writer'])
    expect(written.active).toEqual(['research', 'writer'])
  })

  test('setAgentActive(true) adds, setAgentActive(false) removes', () => {
    setAgentActive(workspace, 'research', true)
    setAgentActive(workspace, 'writer', true)
    expect(readActivatedAgents(workspace).active).toEqual(['research', 'writer'])

    setAgentActive(workspace, 'research', false)
    expect(readActivatedAgents(workspace).active).toEqual(['writer'])
  })

  test('setAgentActive is idempotent', () => {
    setAgentActive(workspace, 'research', true)
    setAgentActive(workspace, 'research', true)
    expect(readActivatedAgents(workspace).active).toEqual(['research'])

    setAgentActive(workspace, 'research', false)
    setAgentActive(workspace, 'research', false)
    expect(readActivatedAgents(workspace).active).toEqual([])
  })

  test('survives a malformed manifest by returning empty', () => {
    const path = join(workspace, 'activated-agents.json')
    writeFileSync(path, '{not valid json', 'utf-8')
    const manifest = readActivatedAgents(workspace)
    expect(manifest.active).toEqual([])
  })
})

describe('library + activation interplay (using a fake global dir)', () => {
  let workspace: string
  let globalAgentsDir: string

  beforeEach(() => {
    workspace = tmpWorkspace()
    globalAgentsDir = tmpGlobalAgentsDir()
  })

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true })
    rmSync(globalAgentsDir, { recursive: true, force: true })
  })

  test('writeGlobalAgent writes to the injected global dir and can reload', () => {
    const loaded = writeGlobalAgent(
      {
        slug: 'researcher',
        metadata: {
          name: 'Researcher',
          description: 'Investigates topics.',
          skills: ['web-research'],
        },
        systemPrompt: 'You are a researcher.\nReturn structured findings.',
      },
      { globalAgentsDir },
    )

    expect(loaded.slug).toBe('researcher')
    expect(loaded.path).toBe(join(globalAgentsDir, 'researcher'))
    expect(existsSync(join(globalAgentsDir, 'researcher', 'AGENT.md'))).toBe(true)

    const reloaded = loadGlobalAgent('researcher', { globalAgentsDir })
    expect(reloaded!.metadata.name).toBe('Researcher')
    expect(reloaded!.metadata.skills).toEqual(['web-research'])
    expect(reloaded!.systemPrompt).toContain('structured findings')
  })

  test('loadAllGlobalAgents includes non-fatal parse warnings', () => {
    const dir = join(globalAgentsDir, 'warns')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'AGENT.md'), `---
name: Warns
description: Has bad optional fields.
permissionMode: nope
sources: 42
---
body
`, 'utf-8')

    const agents = loadAllGlobalAgents({ globalAgentsDir })
    expect(agents).toHaveLength(1)
    expect(agents[0]!.parseWarnings?.map((w) => w.field)).toEqual(['permissionMode', 'sources'])
  })

  test('deleteGlobalAgent removes the agent and cleans workspace manifests', () => {
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: { name: 'Writer', description: 'Writes.' },
        systemPrompt: 'Write.',
      },
      { globalAgentsDir },
    )
    writeActivatedAgents(workspace, ['writer', 'researcher'])

    expect(deleteGlobalAgent('writer', [workspace], { globalAgentsDir })).toBe(true)
    expect(existsSync(join(globalAgentsDir, 'writer'))).toBe(false)
    expect(readActivatedAgents(workspace).active).toEqual(['researcher'])
  })

  test('loadActivatedAgents preserves shared activation entries that are missing only on this machine', () => {
    writeGlobalAgent(
      {
        slug: 'present',
        metadata: { name: 'Present', description: 'Still exists.' },
        systemPrompt: 'Present.',
      },
      { globalAgentsDir },
    )
    writeActivatedAgents(workspace, ['missing', 'present'])

    const loaded = loadActivatedAgents(workspace, { globalAgentsDir })
    expect(loaded.map((a) => a.slug)).toEqual(['present'])
    expect(readActivatedAgents(workspace).active).toEqual(['missing', 'present'])
  })

  test('seedGlobalLibraryIfEmpty writes starters once to the injected global dir', () => {
    const starters = [
      {
        slug: 'starter',
        metadata: { name: 'Starter', description: 'Seeded.' },
        systemPrompt: 'Seed.',
      },
    ]

    expect(seedGlobalLibraryIfEmpty(starters, { globalAgentsDir }).seeded).toBe(1)
    expect(loadGlobalAgent('starter', { globalAgentsDir })!.metadata.name).toBe('Starter')

    rmSync(join(globalAgentsDir, 'starter'), { recursive: true, force: true })
    expect(seedGlobalLibraryIfEmpty(starters, { globalAgentsDir }).seeded).toBe(0)
    expect(loadGlobalAgent('starter', { globalAgentsDir })).toBeNull()
  })

  test('ensureRequiredAgents can be tested against the injected global dir', () => {
    const required = [
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Coordinates.' },
        systemPrompt: 'Coordinate.',
      },
    ]

    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(1)
    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(0)
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.name).toBe('Orchestrator')
  })

  test('ensureRequiredAgents repairs a required agent truncated by a crash', () => {
    const required = [
      {
        slug: 'concierge',
        metadata: { name: 'HNIC', description: 'Routes work.' },
        systemPrompt: 'Route work.',
      },
    ]

    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(1)

    // Simulate a crash during a non-atomic write: the file exists but holds
    // nothing parseable. A bare existence check would skip it forever and
    // leave the user with no Concierge.
    const file = join(globalAgentsDir, 'concierge', 'AGENT.md')
    writeFileSync(file, '', 'utf-8')
    expect(loadGlobalAgent('concierge', { globalAgentsDir })).toBeNull()

    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(1)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.metadata.name).toBe('HNIC')
  })

  test('starter library includes Artist Manager as workflow-aware work router', () => {
    const hnic = STARTER_AGENTS.find((agent) => agent.slug === 'concierge')

    expect(hnic).toBeDefined()
    expect(hnic?.metadata.name).toBe('Artist Manager')
    expect(hnic?.metadata.tags).toContain('routing')
    expect(hnic?.metadata.tags).toContain('workflows')
    expect(hnic?.metadata.skills).toContain('workflow-creator')
    expect(hnic?.metadata.skills).toContain('automation-creator')
    expect(hnic?.metadata.skills).toContain('skill-scout')
    expect(hnic?.metadata.skills).toContain('artist-manager-operating-system')
    expect(hnic?.systemPrompt).toContain('current active-agent capability catalog')
    expect(hnic?.systemPrompt).toContain('@setup-concierge')
    expect(hnic?.systemPrompt).toContain('design it as an automation')
    expect(hnic?.systemPrompt).toContain('suggest a workflow')
    expect(hnic?.systemPrompt).toContain('Handoff target')
    expect(hnic?.systemPrompt).toContain('compact Manager Brief')
    expect(hnic?.systemPrompt).toContain('one recommendation')
    expect(hnic?.systemPrompt).toContain('search_artist_network')
    expect(hnic?.systemPrompt).toContain('A saved email is not permission to send')
    expect(hnic?.systemPrompt).not.toContain('EVERY workspace-context doc')
  })

  test('starter library includes Setup Concierge for app setup and help', () => {
    const setupConcierge = STARTER_AGENTS.find((agent) => agent.slug === 'setup-concierge')

    expect(setupConcierge).toBeDefined()
    expect(setupConcierge?.metadata.name).toBe('Setup Concierge')
    expect(setupConcierge?.metadata.skills).toContain('artist-os-guide')
    expect(setupConcierge?.metadata.skills).toContain('source-recipe')
    expect(setupConcierge?.metadata.tags).toContain('setup')
    expect(setupConcierge?.systemPrompt).toContain('Save credentials')
    expect(setupConcierge?.systemPrompt).toContain('Never ask for account passwords')
  })

  test('every starter agent skill reference resolves to a shipped starter skill', () => {
    const skillSlugs = new Set([
      ...STARTER_SKILLS.map((skill) => skill.slug),
      ...BUNDLED_STARTER_SKILLS.map((skill) => skill.slug),
    ])

    const missing = STARTER_AGENTS.flatMap((agent) =>
      (agent.metadata.skills ?? [])
        .filter((skill) => !skillSlugs.has(skill))
        .map((skill) => `${agent.slug}:${skill}`)
    )

    expect(missing).toEqual([])
  })

  test('starter library includes the social publisher as the Release Kit-aware posting front door', () => {
    const socialPublisher = STARTER_AGENTS.find((agent) => agent.slug === SOCIAL_PUBLISHER_SLUG)

    expect(socialPublisher?.metadata.skills).toEqual(['social-publishing', 'instagram-growth-snapshot'])
    expect(socialPublisher?.metadata.sources).toEqual(['printing-press-social'])
    expect(socialPublisher?.metadata.optionalSources).toEqual(['postiz', 'trypost'])
    expect(socialPublisher?.systemPrompt).toContain('browser_tool')
    expect(socialPublisher?.systemPrompt).toContain('chrome-cdp')
    expect(socialPublisher?.systemPrompt).toContain('browserPlan.accountVerification')
    expect(socialPublisher?.systemPrompt).toContain('social.mjs execute')
    expect(socialPublisher?.systemPrompt).toContain('bounded engagement mandate')
    expect(socialPublisher?.systemPrompt).toContain('without asking again for every item')
    expect(socialPublisher?.systemPrompt).toContain('list_release_kit')
    expect(socialPublisher?.systemPrompt).toContain('item ID and SHA-256 checksum')
    expect(socialPublisher?.systemPrompt).toContain('Do not ask the user to choose a delivery route')
    expect(socialPublisher?.systemPrompt).toContain('TryPost exact account first, Postiz exact account second')
    expect(socialPublisher?.systemPrompt).not.toContain('first ask which connected route the user wants')
    expect(socialPublisher?.systemPrompt).toContain('A launch announcement is part of the rollout plan')
  })

  test('starter library includes the TryPost social publisher as approval-gated', () => {
    const tryPost = STARTER_AGENTS.find((agent) => agent.slug === 'trypost-agent')

    expect(tryPost).toBeDefined()
    expect(tryPost?.metadata.name).toBe('TryPost')
    expect(tryPost?.metadata.tags).toContain('socials')
    expect(tryPost?.metadata.tags).toContain('trypost')
    expect(tryPost?.metadata.permissionMode).toBe('ask')
    expect(tryPost?.systemPrompt).toContain('TryPost API/MCP')
    expect(tryPost?.systemPrompt).toContain('explicit approval')
    expect(tryPost?.systemPrompt).toContain('unsupported platform/media combinations')
    expect(tryPost?.metadata.outputs).not.toContain('once wired')
  })

  test('starter library includes Postiz with schema-first guarded publishing', () => {
    const postiz = STARTER_AGENTS.find((agent) => agent.slug === 'postiz-agent')

    expect(postiz).toBeDefined()
    expect(postiz?.metadata.name).toBe('Postiz')
    expect(postiz?.metadata.sources).toContain('postiz')
    expect(postiz?.metadata.permissionMode).toBe('ask')
    expect(postiz?.systemPrompt).toContain('integrationList')
    expect(postiz?.systemPrompt).toContain('integrationSchema')
    expect(postiz?.systemPrompt).toContain('explicit approval')
    expect(postiz?.systemPrompt).toContain('does not expose comment tools')
  })

  test('starter library includes the Ads Agent with paid ads source routing', () => {
    const adsAgent = STARTER_AGENTS.find((agent) => agent.slug === 'ads-agent')

    expect(adsAgent?.metadata.name).toBe('Ad Runner')
    expect(adsAgent?.metadata.description).toBe('Plan, review, and run Meta, Google, Spotify ads.')
    expect(adsAgent?.metadata.skills).not.toContain('ad-creative')
    expect(adsAgent?.metadata.skills).toContain('meta-ads')
    expect(adsAgent?.metadata.skills).toContain('google-ads')
    expect(adsAgent?.metadata.skills).toContain('spotify-ads-manager')
    expect(adsAgent?.metadata.skills).toContain('paid-ads-browser-operator')
    expect(adsAgent?.metadata.skills).toContain('music-ad-conversion-protocol')
    expect(adsAgent?.metadata.sources).toContain('meta-ads')
    expect(adsAgent?.metadata.sources).toContain('google-ads')
    expect(adsAgent?.metadata.sources).toContain('ads-operator')
    expect(adsAgent?.metadata.optionalSources).toBeUndefined()
    expect(adsAgent?.systemPrompt).toContain('node bin/google-ads.mjs')
    expect(adsAgent?.systemPrompt).toContain('browser dashboard/export mode')
    expect(adsAgent?.systemPrompt).toContain('tools/ads-operator')
    expect(adsAgent?.systemPrompt).toContain('ads-operator --platform meta')
    expect(adsAgent?.systemPrompt).toContain('setup-plan --platform meta')
    expect(adsAgent?.systemPrompt).toContain('Spotify Ads Manager')
    expect(adsAgent?.systemPrompt).toContain('Spotify for Artists')
    expect(adsAgent?.systemPrompt).toContain('packet create --platform meta|google|spotify')
    expect(adsAgent?.systemPrompt).toContain('setup-plan --platform meta|google|spotify')
    expect(adsAgent?.systemPrompt).toContain('Ads Strategy Packet')
    expect(adsAgent?.systemPrompt).toContain('Ad Creative Packet')
    expect(adsAgent?.systemPrompt).toContain('Routing decision tree')
    expect(adsAgent?.systemPrompt).toContain('approval packet')
    expect(adsAgent?.systemPrompt).toContain('explicit user approval')
  })

  test('starter library includes separated ads strategy and creative workers', () => {
    const strategist = STARTER_AGENTS.find((agent) => agent.slug === 'ads-strategist')
    const creative = STARTER_AGENTS.find((agent) => agent.slug === 'ad-creative-agent')

    expect(creative?.metadata.name).toBe('Ad Creative')
    expect(strategist?.metadata.name).toBe('Ad Strategy')
    expect(strategist?.metadata.skills).toEqual(['artist-ad-dna', 'ad-library-intel', 'ads-strategy', 'music-ad-conversion-protocol'])
    expect(strategist?.metadata.sources).toBeUndefined()
    expect(strategist?.systemPrompt).toContain('You plan; you do not operate ad accounts.')
    expect(strategist?.systemPrompt).toContain('ad-library-intel')
    expect(strategist?.systemPrompt).toContain('music-ad-conversion-protocol')
    expect(strategist?.systemPrompt).toContain('Spotify for Artists')
    expect(strategist?.systemPrompt).toContain('Ad Runner handoff fields')

    expect(creative?.metadata.skills).toEqual(['artist-ad-dna', 'ad-library-intel', 'music-ad-visual-hooks', 'ads-creative-development', 'ad-creative', 'artist-campaign-angle-builder'])
    expect(creative?.metadata.sources).toBeUndefined()
    expect(creative?.systemPrompt).toContain('ad-library-intel')
    expect(creative?.systemPrompt).toContain('music-ad-visual-hooks')
    expect(creative?.systemPrompt).toContain('you do not operate ad accounts')
    expect(creative?.systemPrompt).toContain('Ad Runner handoff fields')
  })

  test('starter library includes draft-only Power Up handoff agents', () => {
    const igTrending = STARTER_AGENTS.find((agent) => agent.slug === 'ig-trending-power-up')
    const influencer = STARTER_AGENTS.find((agent) => agent.slug === 'influencer-campaign-power-up')
    const playlisting = STARTER_AGENTS.find((agent) => agent.slug === 'playlisting-power-up')

    expect(igTrending?.metadata.name).toBe('IG Music Trending')
    expect(igTrending?.metadata.description).toBe('Draft an inquiry to a vetted IG music trending provider.')
    expect(influencer?.metadata.name).toBe('Influencer Campaign')
    expect(influencer?.metadata.description).toBe('Draft an inquiry to a vetted influencer campaign provider.')
    expect(playlisting?.metadata.name).toBe('Playlisting')
    expect(playlisting?.metadata.description).toBe('Draft an inquiry to a vetted playlisting provider.')

    for (const agent of [igTrending, influencer, playlisting]) {
      expect(agent).toBeDefined()
      expect(agent?.metadata.permissionMode).toBe('ask')
      expect(agent?.metadata.tags).toContain('power-up')
      expect(agent?.metadata.tags).toContain('service-handoff')
      expect(agent?.systemPrompt).toContain('Do not send email yet')
      expect(agent?.systemPrompt).toContain('Approve this draft before sending')
    }
    expect(igTrending?.systemPrompt).toContain('Instagram Trending Campaign')
    expect(influencer?.systemPrompt).toContain('Influencer Campaign')
    expect(playlisting?.systemPrompt).toContain('Playlisting Campaign')
  })

  test('starter library includes the Spotify Playlist Creator with the curator skill', () => {
    const spotifyPlaylistCreator = STARTER_AGENTS.find((agent) => agent.slug === 'spotify-playlist-creator')

    expect(spotifyPlaylistCreator).toBeDefined()
    expect(spotifyPlaylistCreator?.metadata.name).toBe('Spotify Playlist Creator')
    expect(spotifyPlaylistCreator?.metadata.skills).toContain('spotify-playlist-curator')
    expect(spotifyPlaylistCreator?.metadata.skills).toContain('playlist-builder')
    expect(spotifyPlaylistCreator?.metadata.sources).toContain('printing-press-social')
    expect(spotifyPlaylistCreator?.metadata.tags).toContain('promotion')
    expect(spotifyPlaylistCreator?.metadata.permissionMode).toBe('ask')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('Strategy and deterministic plan')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('playlist spotify discover')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('browser_tool profile spotify <id>')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('Settings > Spotify')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('open.spotify.com')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('cached 25-track shortlist')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('approval digest')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('playlist spotify receipt')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('explicit approval')
  })

  test('starter library includes the Spotify Analyst with analytics skills', () => {
    const spotifyAnalyst = STARTER_AGENTS.find((agent) => agent.slug === 'spotify-analyst')

    expect(spotifyAnalyst).toBeDefined()
    expect(spotifyAnalyst?.metadata.name).toBe('Spotify Analyst')
    expect(spotifyAnalyst?.metadata.greeting).toContain('Settings > Spotify')
    expect(spotifyAnalyst?.metadata.greeting).not.toContain('Settings > Social Accounts')
    expect(spotifyAnalyst?.metadata.skills).toContain('spotify-analytics-snapshot')
    expect(spotifyAnalyst?.metadata.skills).toContain('spotify-anomaly-watch')
    expect(spotifyAnalyst?.metadata.skills).not.toContain('spotify-playlist-curator')
    expect(spotifyAnalyst?.metadata.sources).toContain('printing-press-social')
    expect(spotifyAnalyst?.metadata.tags).toContain('analytics')
    expect(spotifyAnalyst?.systemPrompt).toContain('snapshot spotify')
    expect(spotifyAnalyst?.systemPrompt).toContain('browser_tool profile spotify <id>')
    expect(spotifyAnalyst?.systemPrompt).toContain('absolute Local path shown in that source context')
    expect(spotifyAnalyst?.systemPrompt).toContain('Never assume another RunnerOS checkout')
    expect(spotifyAnalyst?.systemPrompt).not.toContain('From the RunnerOS repository')
    expect(spotifyAnalyst?.systemPrompt).toContain('confirm the saved Spotify Web Player account identity first')
    expect(spotifyAnalyst?.systemPrompt).not.toContain('Open the exact returned browser partition')
    expect(spotifyAnalyst?.systemPrompt).toContain('Never claim that no Spotify source is connected before running the catalog and live profile-status checks')
    expect(spotifyAnalyst?.systemPrompt).toContain('same data source and reporting window')
    expect(spotifyAnalyst?.systemPrompt).toContain('artist-spotify-snapshot')
  })

  test('Ad Runner uses the same exact saved Spotify profile for browser work', () => {
    const adRunner = STARTER_AGENTS.find((agent) => agent.slug === 'ads-agent')

    expect(adRunner?.metadata.sources).toContain('printing-press-social')
    expect(adRunner?.systemPrompt).toContain('browser_tool profile spotify <id>')
    expect(adRunner?.systemPrompt).toContain('Never use a generic browser session for a configured Spotify account')
  })

  test('built-in migrations can update Spotify Analyst saved-profile routing', () => {
    writeGlobalAgent({
      slug: 'spotify-analyst',
      metadata: {
        name: 'Spotify Analyst',
        description: 'Spotify intelligence.',
      },
      systemPrompt: 'old saved-profile routing',
    }, { globalAgentsDir })

    expect(replaceBuiltInAgentPromptText(
      'spotify-analyst',
      'old saved-profile routing',
      'browser_tool profile spotify <id>',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(loadGlobalAgent('spotify-analyst', { globalAgentsDir })?.systemPrompt)
      .toContain('browser_tool profile spotify <id>')
  })

  test('starter library includes the YouTube Research Agent as read-only', () => {
    const youtubeAgent = STARTER_AGENTS.find((agent) => agent.slug === 'youtube-research-agent')

    expect(youtubeAgent?.metadata.skills).toContain('youtube-research')
    expect(youtubeAgent?.metadata.skills).toContain('zero')
    expect(youtubeAgent?.metadata.sources).toBeUndefined()
    expect(youtubeAgent?.metadata.optionalSources).toEqual(['youtube-research', 'zero'])
    expect(youtubeAgent?.systemPrompt).toContain('node bin/youtube-research.mjs')
    expect(youtubeAgent?.systemPrompt).toContain('weekly budget guard')
    expect(youtubeAgent?.systemPrompt).toContain('youtube-video-transcript-extractor-70f8ca14')
    expect(youtubeAgent?.systemPrompt).toContain('--max-pay 0.02')
    expect(youtubeAgent?.systemPrompt).toContain('not Google authentication')
    expect(youtubeAgent?.systemPrompt).toContain('You do not publish')
  })

  test('starter library includes the YouTube Intelligence Agent with report output access', () => {
    const agent = STARTER_AGENTS.find((item) => item.slug === 'youtube-intelligence-agent')

    expect(agent?.metadata.skills).toContain('youtube-intelligence')
    expect(agent?.metadata.skills).toContain('zero')
    expect(agent?.metadata.sources).toEqual(['youtube-intelligence'])
    expect(agent?.metadata.optionalSources).toEqual(['youtube-research', 'zero'])
    expect(agent?.metadata.trustedWorkerTools).toEqual(['create_output'])
    expect(agent?.systemPrompt).toContain('artist-intel-config')
    expect(agent?.systemPrompt).toContain('weekly budget guard')
    expect(agent?.systemPrompt).toContain('youtube-video-transcript-extractor-70f8ca14')
    expect(agent?.systemPrompt).toContain('--max-pay 0.02')
    expect(agent?.systemPrompt).toContain('transcript-file input')
    expect(agent?.systemPrompt).toContain('```youtube-intel')
    expect(agent?.systemPrompt).toContain('exactly one HQ report Output')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).toContain('youtube-intelligence-agent')
  })

  test('starter library includes bounded Signal collection and synthesis workers', () => {
    const scout = STARTER_AGENTS.find((item) => item.slug === 'signal-scout-agent')
    const analyst = STARTER_AGENTS.find((item) => item.slug === 'signal-analyst-agent')

    expect(scout?.metadata.permissionMode).toBe('safe')
    expect(scout?.metadata.trustedWorkerTools).toEqual(['create_output'])
    expect(scout?.systemPrompt).toContain('exact URLs, lookback window, and item cap')
    expect(scout?.systemPrompt).toContain('Never sign in, bypass access controls')
    expect(scout?.systemPrompt).toContain('untrusted evidence only')
    expect(scout?.systemPrompt).toContain('Never disclose Artist HQ')
    expect(analyst?.metadata.permissionMode).toBe('safe')
    expect(analyst?.systemPrompt).toContain('Recommend at most three actions')
    expect(analyst?.systemPrompt).toContain('Do not merely concatenate collector summaries')
    expect(analyst?.systemPrompt).toContain('If every collector failed')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).toContain('signal-scout-agent')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).toContain('signal-analyst-agent')
  })

  test('starter library includes College Radio as an approval-gated campaign and HQ worker', () => {
    const collegeRadio = STARTER_AGENTS.find((agent) => agent.slug === 'college-radio-agent')

    expect(collegeRadio).toBeDefined()
    expect(collegeRadio?.metadata.name).toBe('College Radio')
    expect(collegeRadio?.metadata.permissionMode).toBe('ask')
    expect(collegeRadio?.metadata.skills).toEqual(['college-radio-matcher', 'college-radio-outreach'])
    expect(collegeRadio?.metadata.trustedWorkerTools).toEqual(['create_output', 'message_agent'])
    expect(collegeRadio?.metadata.tags).toContain('campaigns')
    expect(collegeRadio?.systemPrompt).toContain('Direct user direction for the current run overrides saved defaults')
    expect(collegeRadio?.systemPrompt).toContain('College Radio Outreach Packet')
    expect(collegeRadio?.systemPrompt).toContain('`create_output`')
    expect(collegeRadio?.systemPrompt).toContain('`message_agent`')
    expect(collegeRadio?.systemPrompt).toContain('agentSlug: `outreach-agent`')
    expect(collegeRadio?.systemPrompt).toContain('campaign-worker-context')
    expect(collegeRadio?.systemPrompt).toContain('You do not email')
    expect(collegeRadio?.systemPrompt).toContain('explicit current-turn approval')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).toContain('college-radio-agent')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).toContain('spotify-playlist-creator')
  })

  test('starter library includes a guarded Anything Agent for capability gaps', () => {
    const agent = STARTER_AGENTS.find((item) => item.slug === ANYTHING_AGENT_SLUG)

    expect(agent).toBeDefined()
    expect(agent?.metadata.name).toBe('Anything Agent')
    expect(agent?.metadata.description).toBe('Connects to thousands of tools, apps, and services to help you do almost anything — a Swiss Army knife for workflows.')
    expect(agent?.metadata.permissionMode).toBe('ask')
    expect(agent?.metadata.skills).toEqual(['zero'])
    expect(agent?.metadata.sources).toEqual(['zero'])
    expect(agent?.metadata.tags).toContain('fallback')
    expect(agent?.systemPrompt).toContain('no healthy native connector')
    expect(agent?.systemPrompt).toContain('weekly Zero allowance')
    expect(agent?.systemPrompt).toContain('Do not ask before each small call')
    expect(agent?.systemPrompt).toContain('Never bypass either guard')
    expect(agent?.systemPrompt).toContain('bounded job authorization')
  })

  test('Creative Lab defaults are bounded and Anything Agent stays in HQ and campaigns', () => {
    expect(LAB_DEFAULT_ACTIVATED_AGENT_SLUGS).toEqual([
      'the-excavator',
      'reverse-magic',
      'hooker',
      'legendary-writer',
      'reference-master',
      'record-doctor',
    ])
    expect(initialAgentSlugsForWorkspace('lab', false)).toEqual(LAB_DEFAULT_ACTIVATED_AGENT_SLUGS)
    expect(initialAgentSlugsForWorkspace('lab', true)).toEqual([])
    expect(CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS).toEqual(['anticipation-director'])
    expect(HQ_CAMPAIGN_DEFAULT_ACTIVATED_AGENT_SLUGS).toEqual([ANYTHING_AGENT_SLUG])
    expect(initialAgentSlugsForWorkspace('campaign', false)).toEqual([
      RELEASE_MANAGER_AGENT_SLUG,
      ANYTHING_AGENT_SLUG,
      'anticipation-director',
    ])
    expect(initialAgentSlugsForWorkspace('hq', false)).toEqual([RELEASE_MANAGER_AGENT_SLUG, ANYTHING_AGENT_SLUG])
    expect(initialAgentSlugsForWorkspace('general', false)).toEqual([])
  })

  test('Outreach Agent accepts a verified College Radio packet and keeps send approval exact', () => {
    const outreach = STARTER_AGENTS.find((agent) => agent.slug === 'outreach-agent')

    expect(outreach?.systemPrompt).toContain('College Radio Outreach Packet')
    expect(outreach?.systemPrompt).toContain('Do not redo verified station research')
    expect(outreach?.systemPrompt).toContain('verbatim approval')
    expect(outreach?.systemPrompt).toContain('Gmail draft')
  })

  test('starter library includes the Hypermotion Agent with bundled motion source', () => {
    const hypermotionAgent = STARTER_AGENTS.find((agent) => agent.slug === 'hypermotion-agent')

    expect(hypermotionAgent).toBeDefined()
    expect(hypermotionAgent?.metadata.visualAgent).toBe(true)
    expect(hypermotionAgent?.metadata.skills).toContain('hyperframes')
    expect(hypermotionAgent?.metadata.skills).toContain('spotify-canvas-video')
    expect(hypermotionAgent?.metadata.skills).not.toContain('remotion-production')
    expect(hypermotionAgent?.metadata.sources).toContain('hypermotion')
    expect(hypermotionAgent?.metadata.optionalSources).toContain('media-generation')
    expect(hypermotionAgent?.systemPrompt).toContain('node bin/hypermotion.mjs doctor')
    expect(hypermotionAgent?.systemPrompt).toContain('Spotify Canvas')
    expect(hypermotionAgent?.systemPrompt).toContain('Do not require OpenAI')
    expect(hypermotionAgent?.systemPrompt).toContain('showInCanvas')
  })

  test('starter library includes Video Director with the bundled Squad lane', () => {
    const videoDirector = STARTER_AGENTS.find((agent) => agent.slug === 'video-director')

    expect(videoDirector).toBeDefined()
    expect(videoDirector?.metadata.name).toBe('Video Director')
    expect(videoDirector?.metadata.visualAgent).toBe(true)
    expect(videoDirector?.metadata.permissionMode).toBe('ask')
    expect(videoDirector?.metadata.skills).toContain('squad')
    expect(videoDirector?.metadata.sources).toContain('squad')
    expect(videoDirector?.metadata.optionalSources).toContain('media-generation')
    expect(videoDirector?.systemPrompt).toContain('storyboard')
    expect(videoDirector?.systemPrompt).toContain('create_output')
    expect(videoDirector?.systemPrompt).toContain('not a finished video')
    expect(videoDirector?.systemPrompt).toContain('Never spend credits')
  })

  test('starter library includes the Lyric Video Agent with Genesis lyric source', () => {
    const lyricVideoAgent = STARTER_AGENTS.find((agent) => agent.slug === 'lyric-video-agent')

    expect(lyricVideoAgent).toBeDefined()
    expect(lyricVideoAgent?.metadata.name).toBe('Lyric Video')
    expect(lyricVideoAgent?.systemPrompt).toContain('artist-marked `hook` and `chorus` lines')
    expect(lyricVideoAgent?.metadata.visualAgent).toBe(true)
    expect(lyricVideoAgent?.metadata.skills).toContain('lyric-video-genesis')
    expect(lyricVideoAgent?.metadata.sources).toContain('genesis-lyric')
    expect(lyricVideoAgent?.metadata.optionalSources).toContain('media-generation')
    expect(lyricVideoAgent?.systemPrompt).toContain('single song lyric clips')
    expect(lyricVideoAgent?.systemPrompt).toContain('Campaign Assets / mission-assets `Master:` path as `audio_file`')
    expect(lyricVideoAgent?.systemPrompt).toContain('User-provided audio overrides the stored master')
    expect(lyricVideoAgent?.systemPrompt).toContain('node bin/genesis-lyric.mjs storyboard')
    expect(lyricVideoAgent?.systemPrompt).toContain('Genesis Creative Director asset stack plus Motion Director compiler output')
    expect(lyricVideoAgent?.systemPrompt).toContain('side-by-side/linear storyboard board')
    expect(lyricVideoAgent?.systemPrompt).toContain('showInCanvas: true` so it becomes the visible Canvas card')
    expect(lyricVideoAgent?.systemPrompt).toContain('node bin/genesis-lyric.mjs doctor')
    expect(lyricVideoAgent?.systemPrompt).toContain('Do not claim success until')
  })

  test('starter library includes the Lottie Animation Agent with official player workflow', () => {
    const lottieAgent = STARTER_AGENTS.find((agent) => agent.slug === 'lottie-animation-agent')

    expect(lottieAgent).toBeDefined()
    expect(lottieAgent?.metadata.description).toContain('production-ready Lottie JSON animations')
    expect(lottieAgent?.metadata.visualAgent).toBe(true)
    expect(lottieAgent?.metadata.permissionMode).toBe('ask')
    expect(lottieAgent?.metadata.tags).toContain('lottie')
    expect(lottieAgent?.metadata.sources).toContain('lottie')
    expect(lottieAgent?.systemPrompt).toContain('node bin/lottie.mjs doctor')
    expect(lottieAgent?.systemPrompt).toContain('node bin/lottie.mjs init')
    expect(lottieAgent?.systemPrompt).toContain('node bin/lottie.mjs validate')
    expect(lottieAgent?.systemPrompt).toContain('public/lottie.json')
    expect(lottieAgent?.systemPrompt).toContain('?frame=<n>&paused=1')
    expect(lottieAgent?.systemPrompt).toContain('Do not hand-roll a custom viewer')
  })

  test('starter library includes the Video Editor Agent with Video Studio tools', () => {
    const videoAgent = STARTER_AGENTS.find((agent) => agent.slug === 'video-editor-agent')

    expect(videoAgent).toBeDefined()
    expect(videoAgent?.metadata.visualAgent).toBe(true)
    expect(videoAgent?.metadata.permissionMode).toBe('ask')
    expect(videoAgent?.metadata.tags).toContain('video')
    expect(videoAgent?.metadata.sources).toContain('video-studio')
    expect(videoAgent?.systemPrompt).toContain('video_project_create')
    expect(videoAgent?.systemPrompt).toContain('video_media_import')
    expect(videoAgent?.systemPrompt).toContain('video_clip_add')
    expect(videoAgent?.systemPrompt).toContain('video_export')
    expect(videoAgent?.systemPrompt).toContain('placeholder')
  })

  test('starter library includes the Raw Video Editor for existing footage', () => {
    const rawVideoAgent = STARTER_AGENTS.find((agent) => agent.slug === 'raw-video-editor')

    expect(rawVideoAgent).toBeDefined()
    expect(rawVideoAgent?.metadata.name).toBe('Raw Video Editor')
    expect(rawVideoAgent?.metadata.visualAgent).toBe(true)
    expect(rawVideoAgent?.metadata.permissionMode).toBe('ask')
    expect(rawVideoAgent?.metadata.skills).toContain('raw-video-editor')
    expect(rawVideoAgent?.metadata.skills).toContain('raw-video-edit-direction')
    expect(rawVideoAgent?.metadata.skills).toContain('social-video-repurposing')
    expect(rawVideoAgent?.metadata.sources).toContain('raw-video-editor')
    expect(rawVideoAgent?.metadata.sources).toContain('video-studio')
    expect(rawVideoAgent?.metadata.tags).toContain('raw-footage')
    expect(rawVideoAgent?.systemPrompt).toContain('post-production, not AI video generation')
    expect(rawVideoAgent?.systemPrompt).toContain('Preserve originals')
    expect(rawVideoAgent?.systemPrompt).toContain('raw-video-editor')
    expect(rawVideoAgent?.systemPrompt).toContain('raw-video-edit-direction')
    expect(rawVideoAgent?.systemPrompt).toContain('takes_packed.md')
    expect(rawVideoAgent?.systemPrompt).toContain('edl.json')
    expect(rawVideoAgent?.systemPrompt).toContain('sync-master')
    expect(rawVideoAgent?.systemPrompt).toContain('confidence gate')
    expect(rawVideoAgent?.systemPrompt).toContain('Never pass `--force`')
    expect(rawVideoAgent?.systemPrompt).toContain('Create action already authorized the bounded render')
    expect(rawVideoAgent?.systemPrompt).toContain('render only inside its exact `renderIngressDir`')
    expect(rawVideoAgent?.systemPrompt).toContain('the `repurpose` workflow')
    expect(rawVideoAgent?.systemPrompt).toContain('partial success survives interruption')
    expect(rawVideoAgent?.systemPrompt).toContain('Trial Reels are only an optional destination')
  })

  test('starter library includes Content Genius with captions and overlays', () => {
    const contentGenius = STARTER_AGENTS.find((agent) => agent.slug === 'content-genius')

    expect(contentGenius).toBeDefined()
    expect(contentGenius?.metadata.name).toBe('Content Genius')
    expect(contentGenius?.metadata.permissionMode).toBe('ask')
    expect(contentGenius?.metadata.skills).toContain('contentgenuis')
    expect(contentGenius?.metadata.skills).toContain('captions-and-overlays')
    expect(contentGenius?.metadata.tags).toContain('content')
    expect(contentGenius?.metadata.tags).toContain('campaigns')
    expect(contentGenius?.systemPrompt).toContain('Own the idea layer first')
    expect(contentGenius?.systemPrompt).toContain('Once the idea, scene, or clip is locked')
    expect(contentGenius?.systemPrompt).toContain('Do not treat this as video editing or publishing')
  })

  test('starter library includes Scroll Stopper as a content concept worker', () => {
    const scrollStopper = STARTER_AGENTS.find((agent) => agent.slug === 'scroll-stopper')

    expect(scrollStopper).toBeDefined()
    expect(scrollStopper?.metadata.name).toBe('Scroll Stopper')
    expect(scrollStopper?.metadata.permissionMode).toBe('ask')
    expect(scrollStopper?.metadata.thinkingLevel).toBe('high')
    expect(scrollStopper?.metadata.skills).toEqual(['scroll-stopper'])
    expect(scrollStopper?.metadata.tags).toContain('content')
    expect(scrollStopper?.metadata.tags).toContain('ai-video')
    expect(scrollStopper?.metadata.tags).toContain('campaigns')
    expect(scrollStopper?.systemPrompt).toContain('absurd vertical AI-video concepts')
    expect(scrollStopper?.systemPrompt).toContain('cover frame is the main product')
    expect(scrollStopper?.systemPrompt).toContain('No real named people, deepfakes')
    expect(scrollStopper?.systemPrompt).toContain('hand off to the appropriate video, social, or ads worker')
  })

  test('starter library includes Anticipation Director with its dedicated engine', () => {
    const anticipationDirector = STARTER_AGENTS.find((agent) => agent.slug === 'anticipation-director')

    expect(anticipationDirector).toBeDefined()
    expect(anticipationDirector?.metadata.name).toBe('Anticipation Director')
    expect(anticipationDirector?.metadata.permissionMode).toBe('ask')
    expect(anticipationDirector?.metadata.thinkingLevel).toBe('high')
    expect(anticipationDirector?.metadata.skills).toEqual(['anticipation-engine'])
    expect(anticipationDirector?.metadata.tags).toContain('anticipation')
    expect(anticipationDirector?.systemPrompt).toContain('Originate, Integrate, or Inject/Morph')
    expect(anticipationDirector?.systemPrompt).toContain('kinetic visible clock')
    expect(anticipationDirector?.systemPrompt).toContain('one fearless reconceived version')
  })

  test('starter library includes Content Director as the portfolio finalizer', () => {
    const contentDirector = STARTER_AGENTS.find((agent) => agent.slug === 'content-director')

    expect(contentDirector).toBeDefined()
    expect(contentDirector?.metadata.name).toBe('Content Director')
    expect(contentDirector?.metadata.permissionMode).toBe('ask')
    expect(contentDirector?.metadata.thinkingLevel).toBe('high')
    expect(contentDirector?.metadata.skills).toBeUndefined()
    expect(contentDirector?.metadata.trustedWorkerTools).toBeUndefined()
    expect(contentDirector?.systemPrompt).toContain('A powerful unrelated concept beats a weaker on-theme concept')
    expect(contentDirector?.systemPrompt).toContain('one Big Swing')
    expect(contentDirector?.systemPrompt).toContain('Start Now, Build Next, and Invest for Impact')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).not.toContain('anticipation-director')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).not.toContain('content-director')
  })

  test('built-in migration removes only the shipped Content Director persona and output tool wiring', () => {
    const contentDirector = STARTER_AGENTS.find((agent) => agent.slug === 'content-director')!
    writeGlobalAgent({
      ...contentDirector,
      metadata: {
        ...contentDirector.metadata,
        skills: ['mrbeast-perspective'],
        trustedWorkerTools: ['create_output'],
      },
      systemPrompt: 'prefix\nUse the MrBeast perspective for ruthless concept, packaging, clarity, and retention judgment. Judge ideas by immediate stopping power, instant comprehension, need-to-see payoff, retellability, execution clarity, production reality, repeatability, and whether the song or campaign receives meaningful presence and attention.\nsuffix',
    }, { globalAgentsDir })

    expect(replaceBuiltInAgentMetadata('content-director', {
      skills: { from: ['mrbeast-perspective'], to: undefined },
      trustedWorkerTools: { from: ['create_output'], to: undefined },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'content-director',
      'Use the MrBeast perspective for ruthless concept, packaging, clarity, and retention judgment. Judge ideas by immediate stopping power, instant comprehension, need-to-see payoff, retellability, execution clarity, production reality, repeatability, and whether the song or campaign receives meaningful presence and attention.',
      'Apply the compact audience-first rubric.',
      { globalAgentsDir },
    ).updated).toBe(true)

    const migrated = loadGlobalAgent('content-director', { globalAgentsDir })
    expect(migrated?.metadata.skills).toBeUndefined()
    expect(migrated?.metadata.trustedWorkerTools).toBeUndefined()
    expect(migrated?.systemPrompt).toBe('prefix\nApply the compact audience-first rubric.\nsuffix')
  })

  test('starter library includes the Shopify Agent with bundled Shopify source', () => {
    const shopifyAgent = STARTER_AGENTS.find((agent) => agent.slug === 'shopify-agent')

    expect(shopifyAgent).toBeDefined()
    expect(shopifyAgent?.metadata.permissionMode).toBe('ask')
    expect(shopifyAgent?.metadata.skills).toContain('shopify-commerce')
    expect(shopifyAgent?.metadata.sources).toContain('shopify')
    expect(shopifyAgent?.systemPrompt).toContain('node bin/shopify.mjs doctor')
    expect(shopifyAgent?.systemPrompt).toContain('explicitly approves')
  })

  test('starter library includes the Print Agent with print asset workflow skills', () => {
    const printAgent = STARTER_AGENTS.find((agent) => agent.slug === 'print-agent')

    expect(STARTER_AGENTS.find((agent) => agent.slug === 'printify-agent')).toBeUndefined()
    expect(printAgent).toBeDefined()
    expect(printAgent?.metadata.permissionMode).toBe('ask')
    expect(printAgent?.metadata.skills).toContain('printify-commerce')
    expect(printAgent?.metadata.skills).toContain('print-product-assets')
    expect(printAgent?.metadata.skills).toContain('pod-product-strategy')
    expect(printAgent?.metadata.skills).toContain('pod-pricing-margin')
    expect(printAgent?.metadata.skills).toContain('pod-listing-copy')
    expect(printAgent?.metadata.sources).toContain('printify')
    expect(printAgent?.metadata.optionalSources).toContain('shopify')
    expect(printAgent?.metadata.visualAgent).toBe(true)
    expect(printAgent?.systemPrompt).toContain('turn local image assets into real print-on-demand products')
    expect(printAgent?.systemPrompt).toContain('Contact `shopify-agent` exactly once only when Shopify doctor validates')
    expect(printAgent?.systemPrompt).toContain('contact `art-director` exactly once')
    expect(printAgent?.systemPrompt).toContain('--confirm-runner')
  })

  test('starter library includes the Branding Agent with artist branding skills', () => {
    const brandingAgent = STARTER_AGENTS.find((agent) => agent.slug === 'branding-agent')

    expect(brandingAgent).toBeDefined()
    expect(brandingAgent?.metadata.name).toBe('Branding Agent')
    expect(brandingAgent?.metadata.permissionMode).toBe('ask')
    expect(brandingAgent?.metadata.skills).toContain('artist-brand-dna-audit')
    expect(brandingAgent?.metadata.skills).toContain('artist-brand-expression-strategist')
    expect(brandingAgent?.metadata.tags).toContain('branding')
    expect(brandingAgent?.systemPrompt).toContain('artist-profile')
    expect(brandingAgent?.systemPrompt).toContain('artist-voice')
    expect(brandingAgent?.systemPrompt).toContain('artist-branding')
    expect(brandingAgent?.systemPrompt).toContain('artist-intel-report')
  })

  test('starter library includes World Builder with world immersion skill', () => {
    const worldBuilder = STARTER_AGENTS.find((agent) => agent.slug === 'world-builder')

    expect(worldBuilder).toBeDefined()
    expect(worldBuilder?.metadata.name).toBe('World Builder')
    expect(worldBuilder?.metadata.permissionMode).toBe('ask')
    expect(worldBuilder?.metadata.skills).toContain('world-immersion')
    expect(worldBuilder?.metadata.skills).toContain('artist-narrative-universe')
    expect(worldBuilder?.metadata.skills).toContain('artist-campaign-angle-builder')
    expect(worldBuilder?.metadata.tags).toContain('worldbuilding')
    expect(worldBuilder?.systemPrompt).toContain('campaign-worker-context')
    expect(worldBuilder?.systemPrompt).toContain('one central immersive mechanic')
    expect(worldBuilder?.systemPrompt).toContain('The artist builds; fans enter')
  })

  test('starter library includes the Comms Agent with artist comms skill', () => {
    const commsAgent = STARTER_AGENTS.find((agent) => agent.slug === 'comms-agent')

    expect(commsAgent).toBeDefined()
    expect(commsAgent?.metadata.name).toBe('Comms Agent')
    expect(commsAgent?.metadata.permissionMode).toBe('ask')
    expect(commsAgent?.metadata.skills).toContain('artist-comms-strategist')
    expect(commsAgent?.metadata.tags).toContain('comms')
    expect(commsAgent?.metadata.tags).toContain('email')
    expect(commsAgent?.metadata.inputs).toContain('Artist Network people and emails')
    expect(commsAgent?.systemPrompt).toContain('artist-profile')
    expect(commsAgent?.systemPrompt).toContain('artist-voice')
    expect(commsAgent?.systemPrompt).toContain('artist-branding')
    expect(commsAgent?.systemPrompt).toContain('artist-intel-report')
    expect(commsAgent?.systemPrompt).toContain('artist-network')
    expect(commsAgent?.systemPrompt).toContain('canHelpWith')
    expect(commsAgent?.systemPrompt).toContain('search_artist_network')
    expect(commsAgent?.systemPrompt).toContain('approval')
  })

  test('starter library includes one approval-gated Release Manager for release-ready work', () => {
    const releaseManager = STARTER_AGENTS.find((agent) => agent.slug === RELEASE_MANAGER_AGENT_SLUG)

    expect(releaseManager).toBeDefined()
    expect(releaseManager?.metadata.name).toBe('Release Manager')
    expect(releaseManager?.metadata.permissionMode).toBe('ask')
    expect(releaseManager?.metadata.skills).toEqual([
      'artist-os-release-operations',
      'artist-os-rights-and-credits',
      'artist-os-release-package-qa',
      'artist-os-dsp-editorial-pitch',
    ])
    expect(releaseManager?.metadata.optionalSources).toEqual(['printing-press-social', 'google-drive', 'gmail'])
    expect(releaseManager?.metadata.trustedWorkerTools).toContain('list_release_kit')
    expect(releaseManager?.metadata.trustedWorkerTools).toContain('create_output')
    expect(releaseManager?.metadata.trustedWorkerTools).not.toContain('publish_social_post')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).not.toContain(RELEASE_MANAGER_AGENT_SLUG)
    expect(isReleaseManagerDefinition(releaseManager)).toBe(true)
    expect(isReleaseManagerDefinition({
      slug: RELEASE_MANAGER_AGENT_SLUG,
      metadata: { name: 'Release Manager', skills: ['custom-release-skill'] },
    })).toBe(false)
    expect(releaseManager?.systemPrompt).toContain('composition ownership separate from master ownership')
    expect(releaseManager?.systemPrompt).toContain('without exact current approval')
    expect(releaseManager?.systemPrompt).toContain('prepared, ready to submit, submitted, live, blocked, or execution uncertain')
  })

  test('starter library includes one approval-gated X Editorial worker for HQ and Campaign context', () => {
    const xEditorial = STARTER_AGENTS.find((agent) => agent.slug === 'x-editorial')

    expect(xEditorial).toBeDefined()
    expect(xEditorial?.metadata.name).toBe('X Editorial')
    expect(xEditorial?.metadata.permissionMode).toBe('ask')
    expect(xEditorial?.metadata.skills).toEqual(['artist-x-editorial', 'artist-comms-strategist'])
    expect(xEditorial?.metadata.trustedWorkerTools).toEqual([
      'start_deep_research',
      'list_deep_research_runs',
      'get_deep_research_run',
      'list_release_kit',
      'get_release_kit_item',
      'list_campaign_outputs',
      'get_campaign_output',
      'list_artist_vault',
      'list_x_editorial_history',
      'create_output',
    ])
    expect(xEditorial?.metadata.trustedWorkerTools).not.toContain('publish_social_post')
    expect(xEditorial?.metadata.trustedWorkerTools).not.toContain('promote_to_release_kit')
    expect(xEditorial?.metadata.tags).toContain('x')
    expect(xEditorial?.metadata.tags).toContain('campaigns')
    expect(DEFAULT_ACTIVATED_AGENT_SLUGS).toContain('x-editorial')
    expect(xEditorial?.systemPrompt).toContain('artist-profile')
    expect(xEditorial?.systemPrompt).toContain('artist-voice')
    expect(xEditorial?.systemPrompt).toContain('artist-branding')
    expect(xEditorial?.systemPrompt).toContain('start_deep_research')
    expect(xEditorial?.systemPrompt).toContain('artist-x-slate')
    expect(xEditorial?.systemPrompt).toContain('same artist-wide X worker')
    expect(xEditorial?.systemPrompt).toContain('campaignWorkspaceId')
    expect(xEditorial?.systemPrompt).toContain('list_x_editorial_history')
    expect(xEditorial?.systemPrompt).toContain('never publish')
    expect(xEditorial?.systemPrompt).toContain('Nothing posts until the artist approves')
  })

  test('built-in migration can upgrade an already-seeded X Editorial worker without replacing custom fields', () => {
    writeGlobalAgent({
      slug: 'x-editorial',
      metadata: {
        name: 'My X Editor',
        description: 'Custom description.',
        trustedWorkerTools: ['start_deep_research', 'list_deep_research_runs', 'get_deep_research_run', 'create_output'],
      },
      systemPrompt: 'Recent history marker.',
    }, { globalAgentsDir })

    expect(replaceBuiltInAgentMetadata('x-editorial', {
      trustedWorkerTools: {
        from: ['start_deep_research', 'list_deep_research_runs', 'get_deep_research_run', 'create_output'],
        to: ['start_deep_research', 'list_x_editorial_history', 'create_output'],
      },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'x-editorial',
      'Recent history marker.',
      'Recent history marker. Read the shared slate history.',
      { globalAgentsDir },
    ).updated).toBe(true)

    const upgraded = loadGlobalAgent('x-editorial', { globalAgentsDir })
    expect(upgraded?.metadata.name).toBe('My X Editor')
    expect(upgraded?.metadata.trustedWorkerTools).toEqual(['start_deep_research', 'list_x_editorial_history', 'create_output'])
    expect(upgraded?.systemPrompt).toContain('shared slate history')
  })

  test('starter library includes the Outreach Agent with Zero and Gmail wiring', () => {
    const outreachAgent = STARTER_AGENTS.find((agent) => agent.slug === 'outreach-agent')

    expect(outreachAgent).toBeDefined()
    expect(outreachAgent?.metadata.name).toBe('Outreach Agent')
    expect(outreachAgent?.metadata.permissionMode).toBe('ask')
    expect(outreachAgent?.metadata.skills).toContain('zero')
    expect(outreachAgent?.metadata.skills).toContain('artist-comms-strategist')
    expect(outreachAgent?.metadata.skills).toContain('magnetic-outreach')
    expect(outreachAgent?.metadata.sources).toContain('zero')
    expect(outreachAgent?.metadata.sources).not.toContain('gmail')
    expect(outreachAgent?.metadata.optionalSources).toContain('gmail')
    expect(outreachAgent?.metadata.tags).toContain('outreach')
    expect(outreachAgent?.metadata.tags).toContain('linkedin')
    expect(outreachAgent?.metadata.description).toContain('saved Artist Network contacts')
    expect(outreachAgent?.metadata.inputs).toContain('Saved Artist Network person/email')
    expect(outreachAgent?.systemPrompt).toContain('Tomba LinkedIn email finder')
    expect(outreachAgent?.systemPrompt).toContain('https://www.zero.xyz/c/tomba-api-tomba-linkedin-email-finder-1c87396a')
    expect(outreachAgent?.systemPrompt).toContain('Gmail is optional')
    expect(outreachAgent?.systemPrompt).toContain('POST /users/me/drafts')
    expect(outreachAgent?.systemPrompt).toContain('POST /users/me/drafts/send')
    expect(outreachAgent?.systemPrompt).toContain('copy-paste packet')
    expect(outreachAgent?.systemPrompt).toContain('cold first-contact')
    expect(outreachAgent?.systemPrompt).toContain('first-class warm-contact intake')
    expect(outreachAgent?.systemPrompt).toContain('do not run Zero/Tomba lookup')
    expect(outreachAgent?.systemPrompt).toContain('search_artist_network')
    expect(outreachAgent?.systemPrompt).toContain('magnetic-outreach')
    expect(outreachAgent?.systemPrompt).toContain('opt-out')
    expect(outreachAgent?.systemPrompt).toContain('explicit approval')
  })

  test('starter library includes Industry Hunter with outreach-ready research output', () => {
    const industryHunter = STARTER_AGENTS.find((agent) => agent.slug === 'industry-hunter')

    expect(industryHunter).toBeDefined()
    expect(industryHunter?.metadata.name).toBe('Industry Hunter')
    expect(industryHunter?.metadata.permissionMode).toBe('safe')
    expect(industryHunter?.metadata.skills).toContain('artist-industry-hunter')
    expect(industryHunter?.metadata.skills).toContain('zero')
    expect(industryHunter?.metadata.sources).toContain('zero')
    expect(industryHunter?.metadata.trustedWorkerTools).toEqual([
      'start_deep_research',
      'list_deep_research_runs',
      'get_deep_research_run',
      'create_output',
    ])
    expect(industryHunter?.metadata.tags).toContain('industry')
    expect(industryHunter?.metadata.tags).toContain('anr')
    expect(industryHunter?.metadata.tags).toContain('outreach')
    expect(industryHunter?.metadata.tags).toContain('zero')
    expect(industryHunter?.systemPrompt).toContain('artist-profile')
    expect(industryHunter?.systemPrompt).toContain('artist-voice')
    expect(industryHunter?.systemPrompt).toContain('artist-branding')
    expect(industryHunter?.systemPrompt).toContain('artist-intel-report')
    expect(industryHunter?.systemPrompt).toContain('start_deep_research')
    expect(industryHunter?.systemPrompt).toContain('planPolicy: "auto"')
    expect(industryHunter?.systemPrompt).toContain('planPolicy: "approve"')
    expect(industryHunter?.systemPrompt).toContain('get_deep_research_run')
    expect(industryHunter?.systemPrompt).toContain('Industry Hunter Target List')
    expect(industryHunter?.systemPrompt).toContain('Outreach Agent')
    expect(industryHunter?.systemPrompt).toContain('Zero enrichment')
    expect(industryHunter?.systemPrompt).toContain('zero search "Tomba LinkedIn email finder"')
    expect(industryHunter?.systemPrompt).toContain('--max-pay 0.50')
    expect(industryHunter?.systemPrompt).toContain('not looking for famous CEOs')
    expect(industryHunter?.systemPrompt).toContain('showInCanvas: true')
  })

  test('starter library includes Record Doctor with approval-gated producer handoff', () => {
    const recordDoctor = STARTER_AGENTS.find((agent) => agent.slug === 'record-doctor')

    expect(recordDoctor).toBeDefined()
    expect(recordDoctor?.metadata.name).toBe('Record Doctor')
    expect(recordDoctor?.metadata.description).toBe('Have your song reviewed by a Grammy-winning, multi-platinum producer and songwriter for an unbiased, credible perspective before release.')
    expect(recordDoctor?.metadata.description).not.toContain('expert')
    expect(recordDoctor?.metadata.description).not.toContain('@')
    expect(recordDoctor?.metadata.outputs).not.toContain('@')
    expect(recordDoctor?.metadata.permissionMode).toBe('ask')
    expect(recordDoctor?.metadata.skills).toContain('record-doctor-handoff')
    expect(recordDoctor?.metadata.skills).toContain('artist-comms-strategist')
    expect(recordDoctor?.metadata.optionalSources).toContain('gmail')
    expect(recordDoctor?.metadata.tags).toContain('producer')
    expect(recordDoctor?.metadata.tags).toContain('song-review')
    expect(recordDoctor?.systemPrompt).toContain('mikeymikemusic@gmail.com')
    expect(recordDoctor?.systemPrompt).toContain('Recipient privacy is absolute')
    expect(recordDoctor?.systemPrompt).toContain('Never reveal, repeat, spell, quote, display, or refer to the address in chat')
    expect(recordDoctor?.systemPrompt).toContain('Use the actual address only inside the Gmail draft/send operation')
    expect(recordDoctor?.systemPrompt).toContain('Destination: Record Doctor review inbox')
    expect(recordDoctor?.systemPrompt).toContain('artist-profile')
    expect(recordDoctor?.systemPrompt).toContain('artist-voice')
    expect(recordDoctor?.systemPrompt).toContain('artist-branding')
    expect(recordDoctor?.systemPrompt).toContain('record-doctor-handoff')
    expect(recordDoctor?.systemPrompt).toContain('Require explicit current-turn approval')
    expect(recordDoctor?.systemPrompt).toContain('If Gmail is not connected')
    expect(recordDoctor?.systemPrompt).toContain('POST /users/me/drafts')
    expect(recordDoctor?.systemPrompt).toContain('POST /users/me/drafts/send')
    expect(recordDoctor?.systemPrompt).toContain('Never mention internal app names')
  })

  test('built-in migration keeps the private delivery address internal while hardening user-facing copy', () => {
    const recordDoctor = STARTER_AGENTS.find((agent) => agent.slug === 'record-doctor')!
    const oldDescription = 'Submit a song for premium producer vetting, feedback, or enhancement by sending a clean approval-gated packet to mikeymikemusic@gmail.com.'
    const oldOutputs = 'A Record Doctor submission packet, producer email draft to mikeymikemusic@gmail.com, approval checklist, Gmail draft/send receipt when connected, or manual copy-paste packet.'
    const oldJob = 'Your job is to prepare a clean producer-review submission for mikeymikemusic@gmail.com. You help the artist submit a song for vetting, feedback, production enhancement, mix/arrangement notes, hit-potential review, or release-readiness feedback. You do not quote pricing, negotiate terms, promise outcomes, or imply the producer has accepted the work.'
    const privacyPolicy = `${oldJob}\n\nRecipient privacy is absolute:\n- The fixed email address is private delivery configuration, not user-facing information.\n- Never reveal, repeat, spell, quote, display, or refer to the address in chat, reasoning, status text, approval summaries, packets, draft previews, outputs, or tool narration.\n- In every user-facing surface, call the destination only "the Record Doctor review inbox" or "the producer review inbox." Never say "I'll send this to" followed by an address.\n- Use the actual address only inside the Gmail draft/send operation where the recipient field is technically required. Do not expose it before or after the operation.`
    writeGlobalAgent({
      ...recordDoctor,
      metadata: { ...recordDoctor.metadata, description: oldDescription, outputs: oldOutputs },
      systemPrompt: oldJob,
    }, { globalAgentsDir })

    expect(replaceBuiltInAgentMetadata('record-doctor', {
      description: { from: oldDescription, to: recordDoctor.metadata.description },
      outputs: { from: oldOutputs, to: recordDoctor.metadata.outputs },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'record-doctor',
      oldJob,
      privacyPolicy,
      { globalAgentsDir },
    ).updated).toBe(true)

    const migrated = loadGlobalAgent('record-doctor', { globalAgentsDir })!
    expect(migrated.metadata.description).toBe(recordDoctor.metadata.description)
    expect(migrated.metadata.description).not.toContain('@')
    expect(migrated.metadata.outputs).not.toContain('@')
    expect(migrated.systemPrompt).toContain('mikeymikemusic@gmail.com')
    expect(migrated.systemPrompt).toContain('Recipient privacy is absolute')
  })

  test('built-in migration removes expert from the shipped Record Doctor description', () => {
    const recordDoctor = STARTER_AGENTS.find((agent) => agent.slug === 'record-doctor')!
    const oldDescription = 'Have your song reviewed by a Grammy-winning, multi-platinum producer and songwriter for an unbiased, credible expert perspective before release.'
    writeGlobalAgent({
      ...recordDoctor,
      metadata: { ...recordDoctor.metadata, description: oldDescription },
    }, { globalAgentsDir })

    expect(replaceBuiltInAgentMetadata('record-doctor', {
      description: { from: oldDescription, to: recordDoctor.metadata.description },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('record-doctor', { globalAgentsDir })?.metadata.description).toBe(recordDoctor.metadata.description)
  })

  test('starter library includes Reverse Magic as a Lab lyric worker', () => {
    const reverseMagic = STARTER_AGENTS.find((agent) => agent.slug === 'reverse-magic')

    expect(reverseMagic).toBeDefined()
    expect(reverseMagic?.metadata.name).toBe('Reverse Magic')
    expect(reverseMagic?.metadata.permissionMode).toBe('ask')
    expect(reverseMagic?.metadata.thinkingLevel).toBe('high')
    expect(reverseMagic?.metadata.tags).toContain('lyrics')
    expect(reverseMagic?.metadata.tags).toContain('annotations')
    expect(reverseMagic?.systemPrompt).toContain('reverse-engineer why a song feels powerful')
    expect(reverseMagic?.systemPrompt).toContain('Do not reproduce or closely paraphrase copyrighted lyrics')
    expect(reverseMagic?.systemPrompt).toContain('Genius API')
  })

  test('starter library includes Song Director as the bounded Lab coordinator', () => {
    const songDirector = STARTER_AGENTS.find((agent) => agent.slug === 'song-director')

    expect(songDirector).toBeDefined()
    expect(songDirector?.metadata.name).toBe('Song Director')
    expect(songDirector?.metadata.trustedWorkerTools).toContain('message_agent')
    expect(songDirector?.systemPrompt).toContain('the head of the Artist OS Lab writing room')
    expect(songDirector?.systemPrompt).toContain('`legendary-writer`')
    expect(songDirector?.systemPrompt).toContain('Never spray the same task across the whole room')
  })

  test('starter library includes Legendary Writer with Yoga of Songwriting skill', () => {
    const legendaryWriter = STARTER_AGENTS.find((agent) => agent.slug === 'legendary-writer')

    expect(legendaryWriter).toBeDefined()
    expect(legendaryWriter?.metadata.name).toBe('Legendary Writer')
    expect(legendaryWriter?.metadata.permissionMode).toBe('ask')
    expect(legendaryWriter?.metadata.thinkingLevel).toBe('high')
    expect(legendaryWriter?.metadata.skills).toContain('yoga-of-songwriting')
    expect(legendaryWriter?.metadata.tags).toContain('songwriting')
    expect(legendaryWriter?.systemPrompt).toContain('Great Truth')
    expect(legendaryWriter?.systemPrompt).toContain('Bones')
    expect(legendaryWriter?.systemPrompt).toContain('Blood')
    expect(legendaryWriter?.systemPrompt).toContain('Breathe')
    expect(legendaryWriter?.systemPrompt).toContain('Do not imitate a living artist')
  })

  test('starter library includes Hooker as a Lab hook and chorus worker', () => {
    const hooker = STARTER_AGENTS.find((agent) => agent.slug === 'hooker')

    expect(hooker).toBeDefined()
    expect(hooker?.metadata.name).toBe('Hooker')
    expect(hooker?.metadata.permissionMode).toBe('ask')
    expect(hooker?.metadata.thinkingLevel).toBe('high')
    expect(hooker?.metadata.skills).toContain('hook-writer')
    expect(hooker?.metadata.tags).toContain('chorus')
    expect(hooker?.metadata.tags).toContain('hooks')
    expect(hooker?.systemPrompt).toContain('Paint specific, sing plain')
    expect(hooker?.systemPrompt).toContain('Do not reproduce or closely paraphrase copyrighted hooks')
  })

  test('starter library includes Reference Master with reference-finder skill', () => {
    const referenceMaster = STARTER_AGENTS.find((agent) => agent.slug === 'reference-master')

    expect(referenceMaster).toBeDefined()
    expect(referenceMaster?.metadata.name).toBe('Reference Master')
    expect(referenceMaster?.metadata.permissionMode).toBe('ask')
    expect(referenceMaster?.metadata.thinkingLevel).toBe('high')
    expect(referenceMaster?.metadata.skills).toContain('reference-finder')
    expect(referenceMaster?.metadata.tags).toContain('references')
    expect(referenceMaster?.metadata.tags).toContain('allusions')
    expect(referenceMaster?.systemPrompt).toContain('reference-finder')
    expect(referenceMaster?.systemPrompt).toContain('cultural reference and allusion specialist')
    expect(referenceMaster?.systemPrompt).toContain('Do not reproduce or closely paraphrase copyrighted lyrics')
  })

  test('starter library includes The Excavator with song-excavator skill', () => {
    const excavator = STARTER_AGENTS.find((agent) => agent.slug === 'the-excavator')

    expect(excavator).toBeDefined()
    expect(excavator?.metadata.name).toBe('The Excavator')
    expect(excavator?.metadata.permissionMode).toBe('ask')
    expect(excavator?.metadata.thinkingLevel).toBe('high')
    expect(excavator?.metadata.skills).toContain('song-excavator')
    expect(excavator?.metadata.tags).toContain('creative-block')
    expect(excavator?.metadata.tags).toContain('songwriting')
    expect(excavator?.systemPrompt).toContain('song-finding specialist')
    expect(excavator?.systemPrompt).toContain("there's your song")
    expect(excavator?.systemPrompt).toContain('evocative, not therapy')
    expect(excavator?.systemPrompt).toContain('Do not reproduce or closely paraphrase copyrighted lyrics')
  })

  test('starter library includes Art Director with taste-led image generation rules', () => {
    const artDirector = STARTER_AGENTS.find((agent) => agent.slug === 'art-director')

    expect(artDirector).toBeDefined()
    expect(artDirector?.metadata.name).toBe('Art Director')
    expect(artDirector?.metadata.permissionMode).toBe('ask')
    expect(artDirector?.metadata.visualAgent).toBe(true)
    expect(artDirector?.metadata.skills).toContain('artist-art-direction')
    expect(artDirector?.metadata.skills).toContain('artist-typography-taste')
    expect(artDirector?.metadata.skills).toContain('artist-visual-world-director')
    expect(artDirector?.metadata.skills).toContain('ad-creative')
    expect(artDirector?.metadata.skills).toContain('zero')
    expect(artDirector?.metadata.optionalSources).toContain('media-generation')
    expect(artDirector?.metadata.optionalSources).toContain('zero')
    expect(artDirector?.metadata.trustedWorkerTools).toEqual(['artwork_compose', 'create_output'])
    expect(artDirector?.metadata.tags).toContain('album-art')
    expect(artDirector?.metadata.tags).toContain('merch')
    expect(artDirector?.systemPrompt).toContain('70s Vinyl Cover')
    expect(artDirector?.systemPrompt).toContain('Tasteful Collage')
    expect(artDirector?.systemPrompt).toContain('FADER Mag')
    expect(artDirector?.systemPrompt).toContain('Far Out')
    expect(artDirector?.systemPrompt).toContain('artist-typography-taste')
    expect(artDirector?.systemPrompt).toContain('luxury/minimal')
    expect(artDirector?.systemPrompt).toContain('street-poster')
    expect(artDirector?.systemPrompt).toContain('Distinguish exact font assets from font direction')
    expect(artDirector?.systemPrompt).toContain('Album / Single Art Mode')
    expect(artDirector?.systemPrompt).toContain('Merch Design Mode')
    expect(artDirector?.systemPrompt).toContain('artwork_compose')
    expect(artDirector?.systemPrompt).toContain('showInCanvas: true')
    expect(artDirector?.systemPrompt).toContain('SVG/PNG export sizes')
    expect(artDirector?.systemPrompt).toContain('deterministic design layer')
    expect(artDirector?.systemPrompt).toContain('Artwork Builder handoff')
    expect(artDirector?.systemPrompt).toContain('Never fake a real artist likeness')
    expect(artDirector?.systemPrompt).toContain('Do not queue generation until the user approves')
    expect(artDirector?.systemPrompt).toContain('media-generation')
    expect(artDirector?.systemPrompt).toContain('Do not ask for Squad-only keys')
    expect(artDirector?.systemPrompt).not.toContain('RunnerOS')
  })

  test('starter library includes the Update System Agent as read-only maintenance', () => {
    const updateAgent = STARTER_AGENTS.find((agent) => agent.slug === 'update-system-agent')

    expect(updateAgent).toBeDefined()
    expect(updateAgent?.metadata.permissionMode).toBe('safe')
    expect(updateAgent?.metadata.tags).toContain('maintenance')
    expect(updateAgent?.systemPrompt).toContain('update_system_audit.py')
  })

  test('ensureRequiredAgents does not recreate an app-deleted required agent', () => {
    const required = [
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Coordinates.' },
        systemPrompt: 'Coordinate.',
      },
    ]

    ensureRequiredAgents(required, { globalAgentsDir })
    expect(deleteGlobalAgent('orchestrator', [], { globalAgentsDir })).toBe(true)

    expect(ensureRequiredAgents(required, { globalAgentsDir }).ensured).toBe(0)
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })).toBeNull()

    writeGlobalAgent(required[0]!, { globalAgentsDir })
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.name).toBe('Orchestrator')
  })

  test('removeBuiltInAgentSkills strips creator skills without touching prompt bodies', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: {
          name: 'Concierge',
          description: 'Routes requests.',
          skills: ['agent-creator', 'custom-skill', 'automation-creator'],
        },
        systemPrompt: 'Custom body stays intact.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: {
          name: 'Writer',
          description: 'Writes.',
          skills: ['agent-creator'],
        },
        systemPrompt: 'Writer body.',
      },
      { globalAgentsDir },
    )

    expect(removeBuiltInAgentSkills(['agent-creator', 'automation-creator'], { globalAgentsDir }).updated).toBe(1)
    const concierge = loadGlobalAgent('concierge', { globalAgentsDir })!
    expect(concierge.metadata.skills).toEqual(['custom-skill'])
    expect(concierge.systemPrompt).toBe('Custom body stays intact.')
    expect(loadGlobalAgent('writer', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
  })

  test('can add built-in skills to one built-in agent without touching the other', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: { name: 'Concierge', description: 'Routes requests.', skills: ['agent-creator'] },
        systemPrompt: 'Concierge body.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Plans work.', skills: ['agent-creator'] },
        systemPrompt: 'Orchestrator body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkillsForSlug('concierge', ['runneros-self-edit'], { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator', 'runneros-self-edit'])
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
  })

  test('can restore Zero to an existing Anything Agent without replacing its custom prompt', () => {
    writeGlobalAgent(
      {
        slug: 'anything-agent',
        metadata: { name: 'Anything Agent', description: 'Handles gaps.', skills: ['custom-skill'] },
        systemPrompt: 'Custom Anything Agent direction.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkillsForSlug('anything-agent', ['zero'], { globalAgentsDir }).updated).toBe(true)
    const migrated = loadGlobalAgent('anything-agent', { globalAgentsDir })!
    expect(migrated.metadata.skills).toEqual(['custom-skill', 'zero'])
    expect(migrated.systemPrompt).toBe('Custom Anything Agent direction.')
  })

  test('can update the shipped Anything Agent summary without replacing custom summaries', () => {
    const oldDescription = 'Fallback capability broker. Safely finds and runs outside APIs through Zero when no native connector or specialist fits.'
    const newDescription = 'Connects to thousands of tools, apps, and services to help you do almost anything — a Swiss Army knife for workflows.'
    writeGlobalAgent(
      {
        slug: 'anything-agent',
        metadata: { name: 'Anything Agent', description: oldDescription, skills: ['zero'] },
        systemPrompt: 'Anything Agent body stays intact.',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentMetadata('anything-agent', {
      description: { from: oldDescription, to: newDescription },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('anything-agent', { globalAgentsDir })!.metadata.description).toBe(newDescription)
    expect(loadGlobalAgent('anything-agent', { globalAgentsDir })!.systemPrompt).toBe('Anything Agent body stays intact.')

    expect(replaceBuiltInAgentMetadata('anything-agent', {
      description: { from: oldDescription, to: 'Should not overwrite custom text.' },
    }, { globalAgentsDir }).updated).toBe(false)
    expect(loadGlobalAgent('anything-agent', { globalAgentsDir })!.metadata.description).toBe(newDescription)
  })

  test('can add direction and repurposing to an existing Raw Video Editor without replacing its other skills', () => {
    writeGlobalAgent(
      {
        slug: 'raw-video-editor',
        metadata: { name: 'Raw Video Editor', description: 'Edits footage.', skills: ['raw-video-editor', 'custom-editing-skill'] },
        systemPrompt: 'Customized editing body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkillsForSlug('raw-video-editor', ['raw-video-edit-direction', 'social-video-repurposing'], { globalAgentsDir }).updated).toBe(true)
    const migrated = loadGlobalAgent('raw-video-editor', { globalAgentsDir })!
    expect(migrated.metadata.skills).toEqual(['raw-video-editor', 'custom-editing-skill', 'raw-video-edit-direction', 'social-video-repurposing'])
    expect(migrated.systemPrompt).toBe('Customized editing body.')
  })

  test('can narrowly update the shipped Raw Video Editor prompt', () => {
    writeGlobalAgent(
      {
        slug: 'raw-video-editor',
        metadata: { name: 'Raw Video Editor', description: 'Edits footage.', skills: ['raw-video-editor'] },
        systemPrompt: 'Before. Never force a weak match. After.',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText(
      'raw-video-editor',
      'Never force a weak match.',
      'Never force without explicit user instruction.',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(loadGlobalAgent('raw-video-editor', { globalAgentsDir })!.systemPrompt).toBe(
      'Before. Never force without explicit user instruction. After.',
    )
  })

  test('can add future skills to an existing Release Manager without replacing its customizations', () => {
    writeGlobalAgent(
      {
        slug: RELEASE_MANAGER_AGENT_SLUG,
        metadata: {
          name: 'Release Manager',
          description: 'Coordinates releases.',
          skills: ['artist-os-release-operations', 'custom-release-skill'],
        },
        systemPrompt: 'Customized release body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkillsForSlug(
      RELEASE_MANAGER_AGENT_SLUG,
      ['artist-os-release-operations', 'artist-os-rights-and-credits'],
      { globalAgentsDir },
    ).updated).toBe(true)
    const migrated = loadGlobalAgent(RELEASE_MANAGER_AGENT_SLUG, { globalAgentsDir })!
    expect(migrated.metadata.skills).toEqual([
      'artist-os-release-operations',
      'custom-release-skill',
      'artist-os-rights-and-credits',
    ])
    expect(migrated.systemPrompt).toBe('Customized release body.')
  })

  test('ensureBuiltInAgentSkills still applies shared skills to both built-ins', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: { name: 'Concierge', description: 'Routes requests.', skills: [] },
        systemPrompt: 'Concierge body.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'orchestrator',
        metadata: { name: 'Orchestrator', description: 'Plans work.', skills: [] },
        systemPrompt: 'Orchestrator body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentSkills(['agent-creator'], { globalAgentsDir }).updated).toBe(2)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
    expect(loadGlobalAgent('orchestrator', { globalAgentsDir })!.metadata.skills).toEqual(['agent-creator'])
  })

  test('ensureBuiltInAgentMetadataSlugs upgrades stale Ads Agent source routing', () => {
    writeGlobalAgent(
      {
        slug: 'ads-agent',
        metadata: {
          name: 'Ads Agent',
          description: 'Plan, review, and improve Meta and Google ad campaigns.',
          skills: ['ad-creative', 'google-ads'],
          sources: ['meta-ads', 'google-ads'],
        },
        systemPrompt: 'Ads Agent body stays intact.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: {
          name: 'Writer',
          description: 'Writes.',
          skills: ['ad-creative', 'google-ads'],
          sources: ['meta-ads', 'google-ads'],
        },
        systemPrompt: 'Writer body.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentMetadataSlugs('ads-agent', {
      skills: ['meta-ads', 'google-ads', 'spotify-ads-manager', 'paid-ads-browser-operator'],
      sources: ['meta-ads', 'google-ads', 'ads-operator'],
    }, { globalAgentsDir }).updated).toBe(true)

    const adsAgent = loadGlobalAgent('ads-agent', { globalAgentsDir })!
    expect(adsAgent.metadata.skills).toEqual(['meta-ads', 'google-ads', 'spotify-ads-manager', 'paid-ads-browser-operator', 'ad-creative'])
    expect(adsAgent.metadata.sources).toEqual(['meta-ads', 'google-ads', 'ads-operator'])
    expect(adsAgent.metadata.optionalSources).toBeUndefined()
    expect(adsAgent.systemPrompt).toBe('Ads Agent body stays intact.')
    expect(ensureBuiltInAgentMetadataSlugs('writer', {
      skills: ['paid-ads-browser-operator'],
      sources: ['ads-operator'],
    }, { globalAgentsDir }).updated).toBe(false)
    expect(loadGlobalAgent('writer', { globalAgentsDir })!.metadata.sources).toEqual(['meta-ads', 'google-ads'])
  })

  test('moves YouTube Research to optional direct access and adds Zero without replacing its prompt', () => {
    writeGlobalAgent(
      {
        slug: 'youtube-research-agent',
        metadata: {
          name: 'YouTube Research Agent',
          description: 'Researches YouTube.',
          skills: ['youtube-research', 'create-viral-content'],
          sources: ['youtube-research'],
        },
        systemPrompt: 'Custom YouTube research direction.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentMetadataSlugs('youtube-research-agent', {
      skills: ['youtube-research', 'create-viral-content', 'zero'],
      optionalSources: ['youtube-research', 'zero'],
    }, { globalAgentsDir }).updated).toBe(true)

    const migrated = loadGlobalAgent('youtube-research-agent', { globalAgentsDir })!
    expect(migrated.metadata.skills).toEqual(['youtube-research', 'create-viral-content', 'zero'])
    expect(migrated.metadata.sources).toBeUndefined()
    expect(migrated.metadata.optionalSources).toEqual(['youtube-research', 'zero'])
    expect(migrated.systemPrompt).toBe('Custom YouTube research direction.')
    expect(replaceBuiltInAgentPromptText(
      'youtube-research-agent',
      'Custom YouTube research direction.',
      'Custom YouTube research direction with Zero fallback.',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(loadGlobalAgent('youtube-research-agent', { globalAgentsDir })!.systemPrompt)
      .toBe('Custom YouTube research direction with Zero fallback.')
  })

  test('ensureBuiltInAgentMetadataSlugs upgrades ads specialist research skills', () => {
    writeGlobalAgent(
      {
        slug: 'ad-creative-agent',
        metadata: {
          name: 'Ad Creative Agent',
          description: 'Builds paid ad creative.',
          skills: ['artist-ad-dna', 'ads-creative-development', 'ad-creative', 'artist-campaign-angle-builder'],
        },
        systemPrompt: 'Ad Creative body stays intact.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentMetadataSlugs('ad-creative-agent', {
      skills: ['artist-ad-dna', 'ad-library-intel', 'ads-creative-development', 'ad-creative', 'artist-campaign-angle-builder'],
    }, { globalAgentsDir }).updated).toBe(true)

    const creative = loadGlobalAgent('ad-creative-agent', { globalAgentsDir })!
    expect(creative.metadata.skills).toEqual(['artist-ad-dna', 'ad-library-intel', 'ads-creative-development', 'ad-creative', 'artist-campaign-angle-builder'])
    expect(creative.systemPrompt).toBe('Ad Creative body stays intact.')
  })

  test('upgrades stale Video Director routing without replacing its prompt', () => {
    writeGlobalAgent(
      {
        slug: 'video-director',
        metadata: {
          name: 'Video Director',
          description: 'Plans video.',
          skills: ['squad'],
          sources: ['squad'],
        },
        systemPrompt: '- If Squad is not found, tell the user to set `SQUAD_HOME=/absolute/path/to/Squad`.',
      },
      { globalAgentsDir },
    )

    expect(ensureBuiltInAgentMetadataSlugs('video-director', {
      skills: ['squad', 'spotify-canvas-video'],
      sources: ['squad'],
      optionalSources: ['media-generation', 'video-studio', 'hypermotion'],
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'video-director',
      '- If Squad is not found, tell the user to set `SQUAD_HOME=/absolute/path/to/Squad`.',
      '- RunnerOS ships Squad as a built-in source.',
      { globalAgentsDir },
    ).updated).toBe(true)

    const videoDirector = loadGlobalAgent('video-director', { globalAgentsDir })!
    expect(videoDirector.metadata.skills).toEqual(['squad', 'spotify-canvas-video'])
    expect(videoDirector.metadata.optionalSources).toEqual(['media-generation', 'video-studio', 'hypermotion'])
    expect(videoDirector.systemPrompt).toBe('- RunnerOS ships Squad as a built-in source.')
  })

  test('upgrades stale Print Agent routing and preserves custom metadata', () => {
    writeGlobalAgent(
      {
        slug: 'print-agent',
        metadata: {
          name: 'Print Agent',
          description: 'Builds print products.',
          skills: ['printify-commerce', 'print-product-assets'],
          sources: ['printify'],
        },
        systemPrompt: 'Before\nold print orchestration anchor\nAfter',
      },
      { globalAgentsDir },
    )
    const printAgentFile = join(globalAgentsDir, 'print-agent', 'AGENT.md')
    writeFileSync(
      printAgentFile,
      readFileSync(printAgentFile, 'utf-8').replace(
        'sources:\n  - printify\n',
        'sources:\n  - printify\nrouting:\n  intents:\n    - printify\n  canChat: true\n  canExecute: true\n',
      ),
      'utf-8',
    )

    expect(ensureBuiltInAgentMetadataSlugs('print-agent', {
      skills: ['printify-commerce', 'print-product-assets', 'pod-product-strategy', 'pod-pricing-margin', 'pod-listing-copy'],
      sources: ['printify'],
      optionalSources: ['shopify'],
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'print-agent',
      'old print orchestration anchor',
      'new conditional Shopify orchestration',
      { globalAgentsDir },
    ).updated).toBe(true)

    const printAgent = loadGlobalAgent('print-agent', { globalAgentsDir })!
    expect(printAgent.metadata.skills).toEqual([
      'printify-commerce',
      'print-product-assets',
      'pod-product-strategy',
      'pod-pricing-margin',
      'pod-listing-copy',
    ])
    expect(printAgent.metadata.sources).toEqual(['printify'])
    expect(printAgent.metadata.optionalSources).toEqual(['shopify'])
    expect(printAgent.systemPrompt).toBe('Before\nnew conditional Shopify orchestration\nAfter')
    const raw = readFileSync(printAgentFile, 'utf-8')
    expect(raw).toContain('routing:')
    expect(raw).toContain('intents:')
    expect(raw).toContain('- printify')
  })

  test('replaceBuiltInAgentPromptText only patches built-in prompt bodies on exact match', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: {
          name: 'Concierge',
          description: 'Routes requests.',
          skills: ['agent-creator'],
        },
        systemPrompt: 'Before\nold shipped paragraph\nAfter',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'anything-agent',
        metadata: {
          name: 'Anything Agent',
          description: 'Handles capability gaps.',
          skills: ['zero'],
        },
        systemPrompt: 'Before\nold Zero guard\nAfter',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: { name: 'Writer', description: 'Writes.' },
        systemPrompt: 'old shipped paragraph',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText('concierge', 'old shipped paragraph', 'new shipped paragraph', { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.systemPrompt).toBe('Before\nnew shipped paragraph\nAfter')
    expect(replaceBuiltInAgentPromptText('anything-agent', 'old Zero guard', 'new Zero guard', { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('anything-agent', { globalAgentsDir })!.systemPrompt).toBe('Before\nnew Zero guard\nAfter')
    expect(replaceBuiltInAgentPromptText('writer', 'old shipped paragraph', 'new shipped paragraph', { globalAgentsDir }).updated).toBe(false)
    expect(loadGlobalAgent('writer', { globalAgentsDir })!.systemPrompt).toBe('old shipped paragraph')
  })

  test('replaceBuiltInAgentPromptText is idempotent when the replacement contains the old text', () => {
    writeGlobalAgent(
      {
        slug: 'spotify-playlist-creator',
        metadata: { name: 'Spotify Playlist Creator', description: 'Creates playlists.' },
        systemPrompt: 'Before\nbase instruction\nAfter',
      },
      { globalAgentsDir },
    )

    const replacement = 'new prerequisite\nbase instruction'
    expect(replaceBuiltInAgentPromptText(
      'spotify-playlist-creator',
      'base instruction',
      replacement,
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'spotify-playlist-creator',
      'base instruction',
      replacement,
      { globalAgentsDir },
    ).updated).toBe(false)
    expect(loadGlobalAgent('spotify-playlist-creator', { globalAgentsDir })!.systemPrompt).toBe(
      'Before\nnew prerequisite\nbase instruction\nAfter',
    )
  })

  test('dedupeBuiltInAgentPromptText removes repeated shipped fragments and preserves custom text', () => {
    const repeated = '- bounded Spotify discovery'
    writeGlobalAgent(
      {
        slug: 'spotify-playlist-creator',
        metadata: { name: 'Spotify Playlist Creator', description: 'Creates playlists.' },
        systemPrompt: ['CUSTOM PREFIX', repeated, repeated, repeated, 'CUSTOM SUFFIX'].join('\n'),
      },
      { globalAgentsDir },
    )

    expect(dedupeBuiltInAgentPromptText(
      'spotify-playlist-creator',
      repeated,
      { globalAgentsDir },
    ).updated).toBe(true)
    const migrated = loadGlobalAgent('spotify-playlist-creator', { globalAgentsDir })!.systemPrompt
    expect(migrated.match(/bounded Spotify discovery/g)).toHaveLength(1)
    expect(migrated).toContain('CUSTOM PREFIX')
    expect(migrated).toContain('CUSTOM SUFFIX')
  })

  test('replaceBuiltInAgentPromptText can patch Lyric Video prompt guidance', () => {
    writeGlobalAgent(
      {
        slug: 'lyric-video-agent',
        metadata: {
          name: 'Lyric Video',
          description: 'Creates lyric clips.',
        },
        systemPrompt: 'Before\nold lyric prompt line\nAfter',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText(
      'lyric-video-agent',
      'old lyric prompt line',
      'new lyric prompt line',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(loadGlobalAgent('lyric-video-agent', { globalAgentsDir })!.systemPrompt).toBe('Before\nnew lyric prompt line\nAfter')
  })

  test('replaceBuiltInAgentPromptText can patch Art Director face-reference guidance', () => {
    writeGlobalAgent(
      {
        slug: 'art-director',
        metadata: {
          name: 'Art Director',
          description: 'Creates artist visuals.',
        },
        systemPrompt: 'Before\nold face reference line\nAfter',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText(
      'art-director',
      'old face reference line',
      'new face reference line',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(loadGlobalAgent('art-director', { globalAgentsDir })!.systemPrompt).toBe('Before\nnew face reference line\nAfter')
  })

  test('replaceBuiltInAgentMetadata can patch Art Director inputs guidance', () => {
    writeGlobalAgent(
      {
        slug: 'art-director',
        metadata: {
          name: 'Art Director',
          description: 'Creates artist visuals.',
          inputs: 'approved artist photos',
        },
        systemPrompt: 'Prompt',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentMetadata('art-director', {
      inputs: {
        from: 'approved artist photos',
        to: 'approved artist photos and face references',
      },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('art-director', { globalAgentsDir })!.metadata.inputs).toBe('approved artist photos and face references')
  })

  test('replaceBuiltInAgentMetadata can patch Industry Hunter array metadata without touching other agents', () => {
    writeGlobalAgent(
      {
        slug: 'industry-hunter',
        metadata: {
          name: 'Industry Hunter',
          description: 'Find industry contacts.',
          skills: ['artist-industry-hunter'],
          tags: ['industry'],
        },
        systemPrompt: 'Industry body.',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'writer',
        metadata: {
          name: 'Writer',
          description: 'Writes.',
          skills: ['artist-industry-hunter'],
        },
        systemPrompt: 'Writer body.',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentMetadata('industry-hunter', {
      skills: { from: ['artist-industry-hunter'], to: ['artist-industry-hunter', 'zero'] },
      tags: { from: ['industry'], to: ['industry', 'zero'] },
      sources: { from: undefined, to: ['zero'] },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('industry-hunter', { globalAgentsDir })!.metadata.skills).toEqual(['artist-industry-hunter', 'zero'])
    expect(loadGlobalAgent('industry-hunter', { globalAgentsDir })!.metadata.tags).toEqual(['industry', 'zero'])
    expect(loadGlobalAgent('industry-hunter', { globalAgentsDir })!.metadata.sources).toEqual(['zero'])
    expect(replaceBuiltInAgentMetadata('writer', {
      skills: { from: ['artist-industry-hunter'], to: ['artist-industry-hunter', 'zero'] },
    }, { globalAgentsDir }).updated).toBe(false)
  })

  test('built-in migrations can upgrade College Radio and Outreach without opening arbitrary agents', () => {
    const collegeRadio = STARTER_AGENTS.find((agent) => agent.slug === 'college-radio-agent')!
    const outreach = STARTER_AGENTS.find((agent) => agent.slug === 'outreach-agent')!
    const writer = STARTER_AGENTS.find((agent) => agent.slug === 'writer')!
    writeGlobalAgent({
      ...collegeRadio,
      metadata: { ...collegeRadio.metadata, permissionMode: 'safe', trustedWorkerTools: undefined },
      systemPrompt: 'old college prompt',
    }, { globalAgentsDir })
    writeGlobalAgent({ ...outreach, systemPrompt: 'old outreach line' }, { globalAgentsDir })
    writeGlobalAgent({ ...writer, systemPrompt: 'old writer line' }, { globalAgentsDir })

    expect(replaceBuiltInAgentMetadata('college-radio-agent', {
      permissionMode: { from: 'safe', to: 'ask' },
      trustedWorkerTools: { from: undefined, to: ['create_output', 'message_agent'] },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText('college-radio-agent', 'old college prompt', 'new college prompt', { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText('outreach-agent', 'old outreach line', 'new outreach line', { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText('writer', 'old writer line', 'new writer line', { globalAgentsDir }).updated).toBe(false)

    const upgradedCollege = loadGlobalAgent('college-radio-agent', { globalAgentsDir })!
    expect(upgradedCollege.metadata.permissionMode).toBe('ask')
    expect(upgradedCollege.metadata.trustedWorkerTools).toEqual(['create_output', 'message_agent'])
    expect(upgradedCollege.systemPrompt).toBe('new college prompt')
    expect(loadGlobalAgent('outreach-agent', { globalAgentsDir })?.systemPrompt).toBe('new outreach line')
    expect(loadGlobalAgent('writer', { globalAgentsDir })?.systemPrompt).toBe('old writer line')
  })

  test('replaceBuiltInAgentMetadata and prompt text can patch Ads Strategist stale Spotify metadata', () => {
    writeGlobalAgent(
      {
        slug: 'ads-strategist',
        metadata: {
          name: 'Ads Strategist',
          description: 'Builds paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ads Agent executes.',
          inputs: 'Artist context, campaign/release goal, budget, platform scope, territories, destination URL, prior ad/export data, and creative assets.',
          tags: ['ads', 'strategy', 'budget', 'media-plan', 'artist-growth', 'campaigns'],
        },
        systemPrompt: 'Your job is to turn artist context into a clear paid-ad strategy packet before Ads Agent touches Meta Ads or Google Ads.',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentMetadata('ads-strategist', {
      description: {
        from: 'Builds paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ads Agent executes.',
        to: 'Builds Meta, Google, and Spotify paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ads Agent executes.',
      },
      inputs: {
        from: 'Artist context, campaign/release goal, budget, platform scope, territories, destination URL, prior ad/export data, and creative assets.',
        to: 'Artist context, campaign/release goal, budget, platform scope, territories, destination URL, prior ad/export data, Spotify for Artists intel, and creative assets.',
      },
      tags: {
        from: ['ads', 'strategy', 'budget', 'media-plan', 'artist-growth', 'campaigns'],
        to: ['ads', 'strategy', 'budget', 'media-plan', 'artist-growth', 'campaigns', 'spotify-ads'],
      },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'ads-strategist',
      'Your job is to turn artist context into a clear paid-ad strategy packet before Ads Agent touches Meta Ads or Google Ads.',
      'Your job is to turn artist context into a clear paid-ad strategy packet before Ads Agent touches Meta Ads, Google Ads, or Spotify Ads.',
      { globalAgentsDir },
    ).updated).toBe(true)

    const strategist = loadGlobalAgent('ads-strategist', { globalAgentsDir })!
    expect(strategist.metadata.description).toContain('Spotify')
    expect(strategist.metadata.inputs).toContain('Spotify for Artists')
    expect(strategist.metadata.tags).toContain('spotify-ads')
    expect(strategist.systemPrompt).toContain('Spotify Ads')
  })

  test('replaceBuiltInAgentMetadata can rename paid ads built-in cards without changing slugs', () => {
    writeGlobalAgent(
      {
        slug: 'ads-agent',
        metadata: { name: 'Ads Agent', description: 'Plan, review, and improve Meta, Google, and Spotify ad campaigns.' },
        systemPrompt: 'body',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'ads-strategist',
        metadata: { name: 'Ads Strategist', description: 'Builds Meta, Google, and Spotify paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ads Agent executes.' },
        systemPrompt: 'body',
      },
      { globalAgentsDir },
    )
    writeGlobalAgent(
      {
        slug: 'ad-creative-agent',
        metadata: { name: 'Ad Creative Agent', description: 'Builds paid ad creative.' },
        systemPrompt: 'body',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentMetadata('ads-agent', {
      name: { from: 'Ads Agent', to: 'Ad Runner' },
      description: { from: 'Plan, review, and improve Meta, Google, and Spotify ad campaigns.', to: 'Plan, review, and run Meta, Google, Spotify ads.' },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentMetadata('ads-strategist', {
      name: { from: 'Ads Strategist', to: 'Ad Strategy' },
      description: {
        from: 'Builds Meta, Google, and Spotify paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ads Agent executes.',
        to: 'Builds Meta, Google, and Spotify paid-ad campaign strategy, budget, audience, territory, and testing plans from artist context before Ad Runner executes.',
      },
    }, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentMetadata('ad-creative-agent', {
      name: { from: 'Ad Creative Agent', to: 'Ad Creative' },
    }, { globalAgentsDir }).updated).toBe(true)

    expect(loadGlobalAgent('ads-agent', { globalAgentsDir })!.metadata.name).toBe('Ad Runner')
    expect(loadGlobalAgent('ads-strategist', { globalAgentsDir })!.metadata.name).toBe('Ad Strategy')
    expect(loadGlobalAgent('ad-creative-agent', { globalAgentsDir })!.metadata.name).toBe('Ad Creative')
  })

  test('replaceBuiltInAgentPromptPattern patches wrapped stale built-in guidance', () => {
    writeGlobalAgent(
      {
        slug: 'concierge',
        metadata: { name: 'Concierge', description: 'Routes requests.' },
        systemPrompt: 'Intro\nWhen the user wants creator help,\nDo not load creator\nskills unless the user explicitly asks for them.\nOutro',
      },
      { globalAgentsDir },
    )

    const pattern = /When the user wants creator help,[\s\S]*?Do not load creator\s+skills unless the user explicitly asks for them\./
    expect(replaceBuiltInAgentPromptPattern('concierge', pattern, 'Use baked-in creator skills.', { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.systemPrompt).toBe('Intro\nUse baked-in creator skills.\nOutro')
  })

  test('replaceBuiltInAgentPromptPattern can upgrade stale Ads Agent prompt', () => {
    writeGlobalAgent(
      {
        slug: 'ads-agent',
        metadata: { name: 'Ads Agent', description: 'Handles ads.' },
        systemPrompt: [
          'You are Ads Agent, old prompt.',
          'Meta Ads auth happens through the `meta-ads` OAuth MCP source.',
          'For proposed writes, run a `--dry-run` preview.',
          'Never apply a campaign, budget, catalog, creative, keyword, audience, placement, conversion, billing, or status change without explicit user approval in the current conversation.',
        ].join('\n'),
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptPattern(
      'ads-agent',
      /Meta Ads auth happens through the `meta-ads` OAuth MCP source[\s\S]*dry-run/,
      'Use `ads-operator --platform meta` and `setup-plan --platform meta`.',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(loadGlobalAgent('ads-agent', { globalAgentsDir })!.systemPrompt).toContain('setup-plan --platform meta')
  })

  test('Ads Agent prompt line migrations preserve custom prompt text', () => {
    const staleMetaLine = '   - For Meta Ads, use the `meta-ads` source when the workspace has connected and enabled it.'
    const nextMetaLine = '   - For Meta Ads, use `ads-operator` as the always-available local browser/export/setup operator. Use the optional `meta-ads` source only when the workspace has connected and enabled Meta\'s hosted MCP/API path.'
    writeGlobalAgent(
      {
        slug: 'ads-agent',
        metadata: { name: 'Ads Agent', description: 'Handles ads.' },
        systemPrompt: [
          'CUSTOM USER PREFIX',
          staleMetaLine,
          'CUSTOM USER MIDDLE',
          '- Use `campaign-plan --platform meta|google --goal ... --artist-context <file> --territories "..." --budget "..." --json` to draft campaign structures from artist context, target audiences, territories, goals, and budget before creating any live campaign.',
          '- Use `packet create` to produce approval JSON, not to apply the change.',
          'CUSTOM USER SUFFIX',
        ].join('\n'),
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText('ads-agent', staleMetaLine, nextMetaLine, { globalAgentsDir }).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'ads-agent',
      '- Use `campaign-plan --platform meta|google --goal ... --artist-context <file> --territories "..." --budget "..." --json` to draft campaign structures from artist context, target audiences, territories, goals, and budget before creating any live campaign.\n- Use `packet create` to produce approval JSON, not to apply the change.',
      '- Use `campaign-plan --platform meta|google --goal ... --artist-context <file> --territories "..." --budget "..." --json` to draft campaign structures from artist context, target audiences, territories, goals, and budget before creating any live campaign.\n- Use `setup-plan --platform meta --goal ... --artist-context <file> --territories "..." --budget "..." --campaign-name "..." --json` before browser-guided Meta Ads Manager campaign setup. Follow its Ads Manager field plan and stop before Publish/Launch.\n- Use `packet create` to produce approval JSON, not to apply the change.',
      { globalAgentsDir },
    ).updated).toBe(true)

    const migrated = loadGlobalAgent('ads-agent', { globalAgentsDir })!.systemPrompt
    expect(migrated).toContain('CUSTOM USER PREFIX')
    expect(migrated).toContain('CUSTOM USER MIDDLE')
    expect(migrated).toContain('CUSTOM USER SUFFIX')
    expect(migrated).toContain('setup-plan --platform meta')
    expect(migrated).not.toContain(staleMetaLine)
  })

  test('Ads Agent prompt line migrations upgrade older stale Meta guidance without replacing custom text', () => {
    writeGlobalAgent(
      {
        slug: 'ads-agent',
        metadata: { name: 'Ads Agent', description: 'Handles ads.' },
        systemPrompt: [
          'CUSTOM OLD PREFIX',
          'Meta Ads auth happens through the `meta-ads` OAuth MCP source.',
          'For proposed writes, run a `--dry-run` preview.',
          'CUSTOM OLD SUFFIX',
        ].join('\n'),
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText(
      'ads-agent',
      'Meta Ads auth happens through the `meta-ads` OAuth MCP source.',
      'Meta Ads local browser/export/setup happens through `ads-operator --platform meta`; use the optional `meta-ads` OAuth MCP source only when connected.',
      { globalAgentsDir },
    ).updated).toBe(true)
    expect(replaceBuiltInAgentPromptText(
      'ads-agent',
      'For proposed writes, run a `--dry-run` preview.',
      'For proposed writes, use `setup-plan --platform meta` when drafting Meta campaigns, create a `tools/ads-operator` approval packet, and stop before live mutation.',
      { globalAgentsDir },
    ).updated).toBe(true)

    const migrated = loadGlobalAgent('ads-agent', { globalAgentsDir })!.systemPrompt
    expect(migrated).toContain('CUSTOM OLD PREFIX')
    expect(migrated).toContain('CUSTOM OLD SUFFIX')
    expect(migrated).toContain('ads-operator --platform meta')
    expect(migrated).toContain('setup-plan --platform meta')
    expect(migrated).not.toContain('Meta Ads auth happens through the `meta-ads` OAuth MCP source.')
    expect(migrated).not.toContain('For proposed writes, run a `--dry-run` preview.')
  })
})

describe('routing hints', () => {
  test('round-trips through serialize and parse', () => {
    // The field is whitelisted in both directions, so a save that silently
    // drops it is the failure mode worth guarding.
    const md = serializeAgent(
      {
        name: 'Radio Outreach',
        description: 'Pitches college radio.',
        routing: {
          bestFor: ['pitching college radio stations'],
          notFor: ['paid radio ads — use Ad Runner'],
          handsOffTo: ['outreach-agent'],
        },
      },
      'You pitch college radio.',
    )
    expect(md).toContain('routing:')

    const parsed = parseAgentFile(md)
    expect(parsed!.metadata.routing).toEqual({
      bestFor: ['pitching college radio stations'],
      notFor: ['paid radio ads — use Ad Runner'],
      handsOffTo: ['outreach-agent'],
    })
  })

  test('an agent without routing is unchanged', () => {
    const md = serializeAgent({ name: 'Plain', description: 'No hints.' }, 'Body.')
    expect(md).not.toContain('routing')
    expect(parseAgentFile(md)!.metadata.routing).toBeUndefined()
  })

  test('drops malformed entries instead of failing the whole agent', () => {
    const md = `---
name: Messy
description: Has bad hints.
routing:
  bestFor:
    - '  '
    - valid job
    - 12
  notFor: not-an-array
---
Body.
`
    const parsed = parseAgentFile(md)
    // A bad hint should degrade routing, never make the worker unloadable.
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata.routing).toEqual({ bestFor: ['valid job'] })
    expect(parsed!.warnings.some((w) => w.code === 'invalid-routing')).toBe(true)
  })

  test('caps entry count so one definition cannot bloat every prompt', () => {
    const md = serializeAgent(
      {
        name: 'Verbose',
        description: 'Too many hints.',
        routing: { bestFor: Array.from({ length: 20 }, (_, i) => `job ${i}`) },
      },
      'Body.',
    )
    expect(parseAgentFile(md)!.metadata.routing?.bestFor).toHaveLength(6)
  })
})
