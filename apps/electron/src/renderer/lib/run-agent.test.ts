import { STARTER_AGENTS } from '@craft-agent/shared/agent-definitions/starter-templates'
import { describe, expect, test } from 'bun:test'
import { buildAgentCreateSessionOptions, buildPendingAgentTaskModeSessionOptions, ensureAgentDeclaredSkillsEnabled, openAgentSessionComposer, resolveArtistWorkspaceScope, sendAgentDraft, shouldDeferAgentTaskModeSelection } from './run-agent'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions/types'
import type { AgentDefinitionDTO, LoadedSource, SkillDescriptor, Session, CreateSessionOptions } from '../../shared/types'
import type { MemoryEntry } from '@craft-agent/shared/memory/types'

function makeAgent(): AgentDefinitionDTO {
  return {
    slug: 'test-agent',
    metadata: {
      name: 'Test Agent',
      description: 'For tests.',
    },
    systemPrompt: 'You are a test agent.',
    path: '/tmp/fake',
    source: 'global',
  } as AgentDefinitionDTO
}

function makeMemory(name: string, expires?: string): MemoryEntry {
  return {
    name,
    type: 'reference',
    created: '2026-05-01',
    expires,
    body: 'Body.',
  }
}

function makeSource(slug: string, usable = true): LoadedSource {
  return {
    config: {
      id: `id-${slug}`,
      name: slug,
      slug,
      enabled: true,
      provider: slug,
      type: 'api',
      api: usable ? { baseUrl: 'https://example.com', authType: 'none' } : { baseUrl: 'https://example.com', authType: 'oauth' },
      isAuthenticated: usable,
    },
    guide: null,
    folderPath: `/tmp/sources/${slug}`,
    workspaceRootPath: '/tmp/ws',
    workspaceId: 'ws-1',
  } as unknown as LoadedSource
}

test('focused launch requests authorized mode context even when the caller supplied a generic snapshot', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const requests: unknown[][] = []
  const inventoryReads: string[] = []
  const focusedDoc = { slug: 'artist-instagram-snapshot', metadata: { name: 'Insights', enabled: true, routing: { mode: 'broadcast' as const } }, body: 'Verified dated snapshot', path: '/tmp/context', workspaceRootPath: '/tmp/ws' }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
    listWorkspaceContextDocsForAgent: async (...args: unknown[]) => { requests.push(args); return [focusedDoc] },
    getSkills: async () => { inventoryReads.push('skills'); return [{ slug: 'narrow', metadata: { name: 'Narrow', description: 'Inspect the snapshot.' } }] },
    getSources: async () => { inventoryReads.push('sources'); return [] },
    listUserMemory: async () => [], listAgentMemory: async () => [], listAgentSessions: async () => [], getWorkspaces: async () => [],
  } } })
  try {
    const agent: AgentDefinitionDTO = { ...makeAgent(), metadata: { ...makeAgent().metadata, skills: ['narrow'], taskModes: [{
      id: 'snapshot', label: 'Snapshot', description: 'Inspect the snapshot.', kind: 'focus', primarySkillSlugs: ['narrow'],
      context: { preloadTopics: ['artist-instagram-snapshot'] },
    }] } }
    let created: CreateSessionOptions | undefined
    await openAgentSessionComposer({
      workspaceId: 'ws-1', agent, taskModeId: 'snapshot', contextDocs: [],
      navigateOnCreate: false, onInputChange: () => {},
      onCreateSession: async (_workspace, options) => { created = options; return { id: 'focused-session' } as Session },
    })
    expect(requests).toEqual([['ws-1', 'test-agent', 'snapshot']])
    expect(inventoryReads.sort()).toEqual(['skills', 'sources'])
    expect(created?.enabledSourceSlugs).toEqual([])
    expect(created?.launchReceipt?.injected.contextDocs.map(doc => doc.slug)).toEqual(['artist-instagram-snapshot'])
    expect(created?.customSystemPrompt).toContain('Verified dated snapshot')
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('focused launch dependency enforcement', () => {
  const definition = STARTER_AGENTS.find(agent => agent.slug === 'hypermotion-agent')!
  const agent = { ...makeAgent(), ...definition } as AgentDefinitionDTO
  const skills = definition.metadata.skills!.map(slug => ({ slug, metadata: { name: slug } })) as SkillDescriptor[]

  test('focused builder rejects absent inventory, missing skill and unusable required source', () => {
    expect(() => buildAgentCreateSessionOptions(agent, undefined, 'motion')).toThrow('Load current Skills and Connections')
    expect(() => buildAgentCreateSessionOptions(agent, { skills: [], sources: [makeSource('hypermotion')] }, 'motion')).toThrow('missing skill @hyperframes')
    expect(() => buildAgentCreateSessionOptions(agent, { skills, sources: [] }, 'motion')).toThrow('missing connection @hypermotion')
    expect(() => buildAgentCreateSessionOptions(agent, { skills, sources: [makeSource('hypermotion', false)] }, 'motion')).toThrow('disabled or disconnected @hypermotion')
  })

  test('focused composer never creates a session when a required dependency is unavailable', async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    let creates = 0
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: {
      getSkills: async () => skills, getSources: async () => [makeSource('hypermotion', false)],
    } } })
    try {
      await expect(openAgentSessionComposer({
        workspaceId: 'ws-1', agent, taskModeId: 'motion', navigateOnCreate: false, onInputChange: () => {},
        onCreateSession: async () => { creates += 1; return { id: 'should-not-exist' } as Session },
      })).rejects.toThrow('disabled or disconnected @hypermotion')
      expect(creates).toBe(0)
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })

  test('an intentional empty source list cannot inherit workspace defaults', () => {
    const options = buildAgentCreateSessionOptions(agent, { skills, sources: [makeSource('hypermotion')] }, 'canvas')
    expect(options.enabledSourceSlugs).toEqual([])
    const selectedSources = options.enabledSourceSlugs ?? ['unrelated-workspace-default']
    expect(selectedSources).toEqual([])
  })
})

describe('pending in-chat task-mode selection', () => {
  const agent = {
    ...makeAgent(),
    slug: 'branding-agent',
    metadata: {
      ...makeAgent().metadata,
      name: 'Branding Agent',
      skills: ['brand-audit', 'visual-world'],
      taskModes: [
        { id: 'brand-audit', label: 'Brand Audit', description: 'Audit it.', kind: 'focus', primarySkillSlugs: ['brand-audit'] },
        { id: 'visual-world', label: 'Visual World', description: 'Shape it.', kind: 'focus', primarySkillSlugs: ['visual-world'] },
      ],
    },
  } as AgentDefinitionDTO

  test('opens a prompt-free shell until the user chooses a mode', () => {
    expect(shouldDeferAgentTaskModeSelection(agent)).toBe(true)
    expect(shouldDeferAgentTaskModeSelection(agent, 'brand-audit')).toBe(false)

    const options = buildPendingAgentTaskModeSessionOptions(agent)
    expect(options.customSystemPrompt).toBeUndefined()
    expect(options.agentSkillSlugs).toBeUndefined()
    expect(options.enabledSourceSlugs).toBeUndefined()
    expect(options.launchReceipt?.taskModeSelectionPending).toBe(true)
    expect(options.launchReceipt?.injected).toMatchObject({ skills: [], sources: [], contextDocs: [] })
  })
})

describe('buildAgentCreateSessionOptions memory receipts', () => {
  test.each([
    ['artist-world', ['artist-narrative-universe', 'artist-visual-world-director']],
    ['voice-beliefs', ['artist-belief-system', 'artist-brand-expression-strategist']],
  ] as const)('delivers both paired skills and matching receipt for %s', (modeId, expectedSkills) => {
    const definition = STARTER_AGENTS.find(agent => agent.slug === 'branding-agent')!;
    const agent = { ...makeAgent(), ...definition } as AgentDefinitionDTO;
    const options = buildAgentCreateSessionOptions(agent, {
      skills: definition.metadata.skills!.map(slug => ({ slug, metadata: { name: slug } })) as any,
      sources: [],
    }, modeId);
    expect(options.agentSkillSlugs).toEqual([...expectedSkills]);
    expect(options.launchReceipt?.taskMode?.primarySkills).toEqual([...expectedSkills]);
    expect(options.launchReceipt?.taskMode?.fullMode).toBe(false);
    expect(options.customSystemPrompt).toContain('Use every selected primary skill together');
    expect(options.customSystemPrompt).toContain('one coherent result');
    expect(options.permissionMode).toBe(agent.metadata.permissionMode);
  });

  test('launches a focused mode with only its primary skill and selected context', () => {
    const agent = {
      ...makeAgent(),
      slug: 'branding-agent',
      metadata: {
        name: 'Branding Agent',
        description: 'For tests.',
        skills: ['brand-audit', 'visual-world'],
        taskModes: [{
          id: 'visual-world',
          label: 'Visual World',
          description: 'Define the visual system.',
          kind: 'focus',
          primarySkillSlugs: ['visual-world'],
          adjacentSkills: [{
            slug: 'brand-audit',
            when: 'Use when the identity conflicts.',
            expansion: 'same-session',
          }],
          context: {
            preloadTopics: ['artist-profile'],
            retrieveOnDemandTopics: ['artist-network'],
          },
        }],
      },
    } as AgentDefinitionDTO
    const options = buildAgentCreateSessionOptions(agent, {
      skills: [
        { slug: 'brand-audit', metadata: { name: 'Audit' } },
        { slug: 'visual-world', metadata: { name: 'Visual World' } },
      ] as any,
      sources: [],
      contextDocs: [
        { slug: 'artist-profile', metadata: { name: 'Artist Profile', enabled: true }, body: 'Profile.' },
        { slug: 'artist-network', metadata: { name: 'Network', enabled: true }, body: 'Network.' },
      ] as any,
      agentCatalog: [{ ...makeAgent(), slug: 'other-agent' }],
    }, 'visual-world')

    expect(options.agentSkillSlugs).toEqual(['visual-world'])
    expect(options.launchReceipt?.taskMode).toEqual(expect.objectContaining({
      id: 'visual-world',
      label: 'Visual World',
      primarySkills: ['visual-world'],
      selectionSource: 'user',
    }))
    expect(options.launchReceipt?.injected.contextDocs).toEqual([
      { slug: 'artist-profile', name: 'Artist Profile' },
    ])
    expect(options.launchReceipt?.injected.agentCatalog).toBeUndefined()
    expect(options.customSystemPrompt).toContain('Task mode (host-selected):')
    expect(options.customSystemPrompt).toContain('Related capabilities (available on demand — not preloaded)')
    expect(options.customSystemPrompt).not.toContain('Network.')
  })

  test('records active user and agent memory names in direct launch receipts', () => {
    const options = buildAgentCreateSessionOptions(makeAgent(), {
      skills: [],
      sources: [],
      userMemoryEntries: [
        makeMemory('Current user fact', '2999-12-31'),
        makeMemory('Expired user fact', '2000-01-01'),
      ],
      agentMemoryEntries: [makeMemory('Review rule')],
    })

    expect(options.launchReceipt?.injected.memory).toEqual({
      user: [{ name: 'Current user fact' }],
      agent: [{ name: 'Review rule' }],
    })
  })

  test('injects the active agent catalog into Concierge launch receipts', () => {
    const options = buildAgentCreateSessionOptions(
      {
        ...makeAgent(),
        slug: CONCIERGE_SLUG,
        metadata: { name: 'HNIC', description: 'Routes work.' },
      },
      {
        skills: [],
        sources: [],
        agentCatalog: [
          {
            ...makeAgent(),
            slug: 'comms-agent',
            metadata: {
              name: 'Comms Agent',
              description: 'Drafts fan, press, and partner comms.',
              tags: ['comms'],
            },
          },
        ],
      },
    )

    expect(options.launchReceipt?.routing).toEqual({
      mode: 'concierge',
      activeAgentCount: 1,
      instruction: 'Use the active agent capability catalog to route the user to a specialist when appropriate.',
    })
    expect(options.launchReceipt?.injected.agentCatalog).toEqual([
      expect.objectContaining({ slug: 'comms-agent', name: 'Comms Agent', tags: ['comms'] }),
    ])
    expect(options.customSystemPrompt).toContain('Comms Agent')
  })

  test('launches with optional sources only when they are usable', () => {
    const agent = {
      ...makeAgent(),
      metadata: {
        name: 'Outreach Agent',
        description: 'For tests.',
        sources: ['zero'],
        optionalSources: ['gmail'],
      },
    } as AgentDefinitionDTO

    const disconnected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('zero'), makeSource('gmail', false)],
    })
    expect(disconnected.enabledSourceSlugs).toEqual(['zero'])
    expect(disconnected.customSystemPrompt).not.toContain('@gmail')

    const connected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('zero'), makeSource('gmail')],
    })
    expect(connected.enabledSourceSlugs).toEqual(['zero', 'gmail'])
    expect(connected.customSystemPrompt).toContain('@gmail')
  })

  test('does not inject optional Meta Ads when it is not authenticated', () => {
    const agent = {
      ...makeAgent(),
      slug: 'ads-agent',
      metadata: {
        name: 'Ads Agent',
        description: 'For tests.',
        sources: ['google-ads', 'ads-operator'],
        optionalSources: ['meta-ads'],
      },
    } as AgentDefinitionDTO

    const disconnected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('google-ads'), makeSource('ads-operator'), makeSource('meta-ads', false)],
    })
    expect(disconnected.enabledSourceSlugs).toEqual(['google-ads', 'ads-operator'])
    expect(disconnected.customSystemPrompt).toContain('@google-ads')
    expect(disconnected.customSystemPrompt).toContain('@ads-operator')
    expect(disconnected.customSystemPrompt).not.toContain('@meta-ads')

    const connected = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [makeSource('google-ads'), makeSource('ads-operator'), makeSource('meta-ads')],
    })
    expect(connected.enabledSourceSlugs).toEqual(['google-ads', 'ads-operator', 'meta-ads'])
    expect(connected.customSystemPrompt).toContain('@meta-ads')
  })

  test('passes trusted worker tools into spawned sessions and receipts', () => {
    const agent = {
      ...makeAgent(),
      metadata: {
        name: 'Industry Hunter',
        description: 'For tests.',
        trustedWorkerTools: ['start_deep_research', 'create_output'],
      },
    } as AgentDefinitionDTO

    const options = buildAgentCreateSessionOptions(agent, {
      skills: [],
      sources: [],
    })

    expect(options.trustedWorkerTools).toEqual(['start_deep_research', 'create_output'])
    expect(options.launchReceipt?.injected.trustedWorkerTools).toEqual(['start_deep_research', 'create_output'])
  })
})

describe('sendAgentDraft', () => {
  test('waits for confirmed delivery', async () => {
    let delivered = false
    await sendAgentDraft(async () => {
      await Promise.resolve()
      delivered = true
      return true
    }, 'session-1', 'Start the work', 'Test Agent')

    expect(delivered).toBe(true)
  })

  test('surfaces a failed first message', async () => {
    expect(
      sendAgentDraft(async () => false, 'session-1', 'Start the work', 'Test Agent'),
    ).rejects.toThrow('first message failed to send')
  })
})

describe('ensureAgentDeclaredSkillsEnabled', () => {
  test('activates installed declared skills before a direct agent launch', async () => {
    const activeSkill = { slug: 'already-active' }
    const spotifySkills = [
      { slug: 'spotify-growth-intake' },
      { slug: 'spotify-analytics-snapshot' },
      { slug: 'spotify-anomaly-watch' },
    ]
    const enabled: string[] = []
    const refreshed = [activeSkill, ...spotifySkills] as any

    const result = await ensureAgentDeclaredSkillsEnabled({
      agent: {
        ...makeAgent(),
        slug: 'spotify-analyst',
        metadata: {
          name: 'Spotify Analyst',
          description: 'For tests.',
          skills: ['already-active', ...spotifySkills.map((skill) => skill.slug)],
        },
      },
      workspaceId: 'workspace-1',
      activeSkills: [activeSkill] as any,
      listGlobalSkills: async () => spotifySkills as any,
      setGlobalSkillEnabled: async (_workspaceId, slug, enabledFlag) => {
        if (enabledFlag) enabled.push(slug)
        return enabled
      },
      getSkills: async () => refreshed,
    })

    expect(enabled).toEqual(spotifySkills.map((skill) => skill.slug))
    expect(result).toBe(refreshed)
  })

  test('does not activate unavailable declared skills', async () => {
    let reloaded = false

    const result = await ensureAgentDeclaredSkillsEnabled({
      agent: {
        ...makeAgent(),
        metadata: {
          name: 'Test Agent',
          description: 'For tests.',
          skills: ['not-installed'],
        },
      },
      workspaceId: 'workspace-1',
      activeSkills: [],
      listGlobalSkills: async () => [],
      setGlobalSkillEnabled: async () => {
        throw new Error('should not enable')
      },
      getSkills: async () => {
        reloaded = true
        return []
      },
    })

    expect(result).toEqual([])
    expect(reloaded).toBe(false)
  })
})

describe('artist workspace scope reaches the composed prompt', () => {
  const contractHeader = 'Artist OS asset contract:'

  test('resolves the scope for a known workspace and degrades to undefined otherwise', async () => {
    const workspaces = [{ id: 'ws-1', artistWorkspaceScope: 'campaign' }, { id: 'ws-2' }]
    expect(await resolveArtistWorkspaceScope('ws-1', async () => workspaces)).toBe('campaign')
    expect(await resolveArtistWorkspaceScope('ws-2', async () => workspaces)).toBeUndefined()
    expect(await resolveArtistWorkspaceScope('missing', async () => workspaces)).toBeUndefined()
    expect(await resolveArtistWorkspaceScope('ws-1', async () => [{ id: 'ws-1', artistWorkspaceScope: 'bogus' }])).toBeUndefined()
    expect(await resolveArtistWorkspaceScope('ws-1', async () => { throw new Error('offline') })).toBeUndefined()
  })

  test('forwards the scope so a chat-launched campaign worker keeps the asset contract', () => {
    const without = buildAgentCreateSessionOptions(makeAgent(), { skills: [], sources: [] })
    const withScope = buildAgentCreateSessionOptions(makeAgent(), { skills: [], sources: [], artistWorkspaceScope: 'campaign' })

    expect(without.customSystemPrompt ?? '').not.toContain(contractHeader)
    expect(withScope.customSystemPrompt ?? '').toContain(contractHeader)
  })
})


describe('focused optional adapters', () => {
  test('publishing prompt and receipt contain only the selected route', () => {
    const definition = STARTER_AGENTS.find(agent => agent.slug === 'social-publisher')!;
    const agent = { ...makeAgent(), ...definition } as AgentDefinitionDTO;
    const options = buildAgentCreateSessionOptions(agent, {
      skills: definition.metadata.skills!.map(slug => ({ slug, metadata: { name: slug } })) as any,
      sources: [makeSource('trypost'), makeSource('postiz'), makeSource('printing-press-social')],
    }, 'publish');
    expect(options.enabledSourceSlugs).toEqual(['trypost']);
    expect(options.launchReceipt?.injected.sources).toEqual(['trypost']);
    expect(options.customSystemPrompt).toContain('Optional adapter candidates');
    expect(options.customSystemPrompt).toContain('source_test(sourceSlug, autoEnable: true)');
  });
  test('having generation connections does not preload them for a Canvas discussion', () => {
    const definition = STARTER_AGENTS.find(agent => agent.slug === 'hypermotion-agent')!;
    const agent = { ...makeAgent(), ...definition } as AgentDefinitionDTO;
    const options = buildAgentCreateSessionOptions(agent, {
      skills: definition.metadata.skills!.map(slug => ({ slug, metadata: { name: slug } })) as any,
      sources: [makeSource('hypermotion'), makeSource('media-generation')],
    }, 'canvas');
    expect(options.enabledSourceSlugs ?? []).toEqual([]);
    expect(options.launchReceipt?.injected.sources).toEqual([]);
  });
});
