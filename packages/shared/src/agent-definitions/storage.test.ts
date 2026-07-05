import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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
  ensureBuiltInAgentSkills,
  ensureBuiltInAgentSkillsForSlug,
  replaceBuiltInAgentPromptPattern,
  replaceBuiltInAgentPromptText,
  removeBuiltInAgentSkills,
} from './storage.ts'
import { STARTER_AGENTS } from './starter-templates.ts'
import { SOCIAL_PUBLISHER_SLUG } from './types.ts'
import { BUNDLED_STARTER_SKILLS, STARTER_SKILLS } from '../skills/index.ts'

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-test-'))
}

function tmpGlobalAgentsDir(): string {
  return mkdtempSync(join(tmpdir(), 'craft-agent-defs-global-test-'))
}

describe('isValidAgentSlug', () => {
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

  test('loadActivatedAgents self-heals stale manifest entries for missing globals', () => {
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
    expect(readActivatedAgents(workspace).active).toEqual(['present'])
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

  test('starter library includes HNIC as workflow-aware work router', () => {
    const hnic = STARTER_AGENTS.find((agent) => agent.slug === 'concierge')

    expect(hnic).toBeDefined()
    expect(hnic?.metadata.name).toBe('HNIC')
    expect(hnic?.metadata.tags).toContain('routing')
    expect(hnic?.metadata.tags).toContain('workflows')
    expect(hnic?.metadata.skills).toContain('artist-os-guide')
    expect(hnic?.metadata.skills).toContain('workflow-creator')
    expect(hnic?.metadata.skills).toContain('automation-creator')
    expect(hnic?.systemPrompt).toContain('current active-agent capability catalog')
    expect(hnic?.systemPrompt).toContain('artist-os-guide')
    expect(hnic?.systemPrompt).toContain('suggest an automation')
    expect(hnic?.systemPrompt).toContain('suggest a workflow')
    expect(hnic?.systemPrompt).toContain('Handoff target')
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

  test('starter library includes the social publisher with the Printing Press source', () => {
    const socialPublisher = STARTER_AGENTS.find((agent) => agent.slug === SOCIAL_PUBLISHER_SLUG)

    expect(socialPublisher?.metadata.skills).toEqual(['social-publishing'])
    expect(socialPublisher?.metadata.sources).toEqual(['printing-press-social'])
    expect(socialPublisher?.systemPrompt).toContain('browser_tool')
    expect(socialPublisher?.systemPrompt).toContain('chrome-cdp')
    expect(socialPublisher?.systemPrompt).toContain('not Playwright')
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
  })

  test('starter library includes the Ads Agent with bundled Google Ads source', () => {
    const adsAgent = STARTER_AGENTS.find((agent) => agent.slug === 'ads-agent')

    expect(adsAgent?.metadata.skills).toContain('google-ads')
    expect(adsAgent?.metadata.skills).toContain('ad-creative')
    expect(adsAgent?.metadata.sources).toContain('google-ads')
    expect(adsAgent?.metadata.sources).not.toContain('meta-ads')
    expect(adsAgent?.systemPrompt).toContain('node bin/google-ads.mjs')
    expect(adsAgent?.systemPrompt).toContain('Meta OAuth must be connected first')
    expect(adsAgent?.systemPrompt).toContain('explicit user approval')
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
    expect(spotifyPlaylistCreator?.metadata.tags).toContain('promotion')
    expect(spotifyPlaylistCreator?.metadata.permissionMode).toBe('ask')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('sandwich-pattern plan')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('Spotify MCP/API/OAuth')
    expect(spotifyPlaylistCreator?.systemPrompt).toContain('explicit approval')
  })

  test('starter library includes the Spotify Analyst with analytics skills', () => {
    const spotifyAnalyst = STARTER_AGENTS.find((agent) => agent.slug === 'spotify-analyst')

    expect(spotifyAnalyst).toBeDefined()
    expect(spotifyAnalyst?.metadata.name).toBe('Spotify Analyst')
    expect(spotifyAnalyst?.metadata.skills).toContain('spotify-analytics-snapshot')
    expect(spotifyAnalyst?.metadata.skills).toContain('spotify-anomaly-watch')
    expect(spotifyAnalyst?.metadata.tags).toContain('analytics')
    expect(spotifyAnalyst?.systemPrompt).toContain('artist-spotify-snapshot')
  })

  test('starter library includes the YouTube Research Agent as read-only', () => {
    const youtubeAgent = STARTER_AGENTS.find((agent) => agent.slug === 'youtube-research-agent')

    expect(youtubeAgent?.metadata.skills).toContain('youtube-research')
    expect(youtubeAgent?.metadata.sources).toContain('youtube-research')
    expect(youtubeAgent?.systemPrompt).toContain('node bin/youtube-research.mjs')
    expect(youtubeAgent?.systemPrompt).toContain('You do not publish')
  })

  test('starter library includes the Hypermotion Agent with bundled motion source', () => {
    const hypermotionAgent = STARTER_AGENTS.find((agent) => agent.slug === 'hypermotion-agent')

    expect(hypermotionAgent).toBeDefined()
    expect(hypermotionAgent?.metadata.visualAgent).toBe(true)
    expect(hypermotionAgent?.metadata.skills).toContain('hyperframes')
    expect(hypermotionAgent?.metadata.skills).not.toContain('remotion-production')
    expect(hypermotionAgent?.metadata.sources).toContain('hypermotion')
    expect(hypermotionAgent?.systemPrompt).toContain('node bin/hypermotion.mjs doctor')
    expect(hypermotionAgent?.systemPrompt).toContain('showInCanvas')
  })

  test('starter library includes the Lottie Animation Agent with official player workflow', () => {
    const lottieAgent = STARTER_AGENTS.find((agent) => agent.slug === 'lottie-animation-agent')

    expect(lottieAgent).toBeDefined()
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
    expect(rawVideoAgent?.metadata.sources).toContain('raw-video-editor')
    expect(rawVideoAgent?.metadata.sources).toContain('video-studio')
    expect(rawVideoAgent?.metadata.tags).toContain('raw-footage')
    expect(rawVideoAgent?.systemPrompt).toContain('post-production, not AI video generation')
    expect(rawVideoAgent?.systemPrompt).toContain('Preserve originals')
    expect(rawVideoAgent?.systemPrompt).toContain('raw-video-editor')
    expect(rawVideoAgent?.systemPrompt).toContain('takes_packed.md')
    expect(rawVideoAgent?.systemPrompt).toContain('edl.json')
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
    expect(printAgent?.metadata.sources).toContain('printify')
    expect(printAgent?.metadata.visualAgent).toBe(true)
    expect(printAgent?.systemPrompt).toContain('turn local image assets into real print-on-demand products')
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
    expect(commsAgent?.systemPrompt).toContain('artist-profile')
    expect(commsAgent?.systemPrompt).toContain('artist-voice')
    expect(commsAgent?.systemPrompt).toContain('artist-branding')
    expect(commsAgent?.systemPrompt).toContain('artist-intel-report')
    expect(commsAgent?.systemPrompt).toContain('approval')
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
    expect(outreachAgent?.systemPrompt).toContain('Tomba LinkedIn email finder')
    expect(outreachAgent?.systemPrompt).toContain('https://www.zero.xyz/c/tomba-api-tomba-linkedin-email-finder-1c87396a')
    expect(outreachAgent?.systemPrompt).toContain('Gmail is optional')
    expect(outreachAgent?.systemPrompt).toContain('POST /users/me/drafts')
    expect(outreachAgent?.systemPrompt).toContain('POST /users/me/drafts/send')
    expect(outreachAgent?.systemPrompt).toContain('copy-paste packet')
    expect(outreachAgent?.systemPrompt).toContain('cold first-contact')
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
    expect(industryHunter?.metadata.trustedWorkerTools).toEqual([
      'start_deep_research',
      'list_deep_research_runs',
      'get_deep_research_run',
      'create_output',
    ])
    expect(industryHunter?.metadata.tags).toContain('industry')
    expect(industryHunter?.metadata.tags).toContain('anr')
    expect(industryHunter?.metadata.tags).toContain('outreach')
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
    expect(industryHunter?.systemPrompt).toContain('not looking for famous CEOs')
    expect(industryHunter?.systemPrompt).toContain('showInCanvas: true')
  })

  test('starter library includes Record Doctor with approval-gated producer handoff', () => {
    const recordDoctor = STARTER_AGENTS.find((agent) => agent.slug === 'record-doctor')

    expect(recordDoctor).toBeDefined()
    expect(recordDoctor?.metadata.name).toBe('Record Doctor')
    expect(recordDoctor?.metadata.permissionMode).toBe('ask')
    expect(recordDoctor?.metadata.skills).toContain('record-doctor-handoff')
    expect(recordDoctor?.metadata.skills).toContain('artist-comms-strategist')
    expect(recordDoctor?.metadata.optionalSources).toContain('gmail')
    expect(recordDoctor?.metadata.tags).toContain('producer')
    expect(recordDoctor?.metadata.tags).toContain('song-review')
    expect(recordDoctor?.systemPrompt).toContain('mikeymikemusic@gmail.com')
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
        slug: 'writer',
        metadata: { name: 'Writer', description: 'Writes.' },
        systemPrompt: 'old shipped paragraph',
      },
      { globalAgentsDir },
    )

    expect(replaceBuiltInAgentPromptText('concierge', 'old shipped paragraph', 'new shipped paragraph', { globalAgentsDir }).updated).toBe(true)
    expect(loadGlobalAgent('concierge', { globalAgentsDir })!.systemPrompt).toBe('Before\nnew shipped paragraph\nAfter')
    expect(replaceBuiltInAgentPromptText('writer', 'old shipped paragraph', 'new shipped paragraph', { globalAgentsDir }).updated).toBe(false)
    expect(loadGlobalAgent('writer', { globalAgentsDir })!.systemPrompt).toBe('old shipped paragraph')
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
})
