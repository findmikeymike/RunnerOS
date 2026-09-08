import { beforeEach, describe, expect, test } from 'bun:test'
import type { AgentBackend, AgentContextUpdate } from '@craft-agent/shared/agent/backend'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import { createModelFallbackBackend } from '@craft-agent/shared/agent/backend/model-fallback-backend'
import type { AgentEvent } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

const focusedReceipt = {
  createdAt: 2,
  origin: 'agent' as const,
  agent: { slug: 'branding-agent', name: 'Branding Agent' },
  taskMode: {
    schemaVersion: 1 as const,
    id: 'narrative-universe',
    label: 'Narrative Universe',
    definitionRevision: 'task-mode-v1-test',
    selectionSource: 'user' as const,
    primarySkills: ['artist-narrative-universe'],
    adjacentSkills: [],
    fullMode: false,
  },
  config: {},
  injected: {
    skills: ['artist-narrative-universe'],
    sources: ['artist-profile'],
    contextDocs: [],
  },
}

function focusedOptions(): Partial<CreateSessionOptions> {
  return {
    customSystemPrompt: 'Focused branding prompt',
    agentSkillSlugs: ['artist-narrative-universe'],
    enabledSourceSlugs: ['artist-profile'],
    launchReceipt: focusedReceipt,
  }
}

describe('task-mode selection', () => {
  let manager: SessionManager
  let managed: ReturnType<typeof createManagedSession>

  beforeEach(() => {
    manager = new SessionManager()
    manager.setPaidExecutionAuthorizer(() => true)
    managed = createManagedSession({
      id: 'task-mode-session',
      spawnedFromAgent: { agentSlug: 'branding-agent', agentName: 'Branding Agent' },
      launchReceipt: {
        createdAt: 1,
        origin: 'agent',
        agent: { slug: 'branding-agent', name: 'Branding Agent' },
        taskModeSelectionPending: true,
        config: {},
        injected: { skills: [], sources: [], contextDocs: [] },
      },
    }, {
      id: 'workspace-1',
      name: 'Workspace',
      slug: 'workspace',
      rootPath: '/tmp/task-mode-workspace',
      createdAt: 1,
    }, { messagesLoaded: true })

    const internals = manager as unknown as {
      sessions: Map<string, typeof managed>
      resolveAgentSessionOptions: () => Promise<Partial<CreateSessionOptions>>
      persistSession: () => void
    }
    internals.sessions.set(managed.id, managed)
    internals.resolveAgentSessionOptions = async () => focusedOptions()
    internals.persistSession = () => {}
  })

  test('the first deliberate focus click starts one hidden model turn', async () => {
    let sendArgs: Parameters<SessionManager['sendMessage']> | undefined
    manager.sendMessage = async (...args) => {
      sendArgs = args
      args[7]?.('hidden-start')
    }

    await manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true })

    expect(managed.launchReceipt?.taskModeSelectionPending).toBe(false)
    expect(managed.launchReceipt?.taskMode?.id).toBe('narrative-universe')
    expect(sendArgs?.[1]).toContain('selected Narrative Universe')
    expect(sendArgs?.[4]).toEqual({ hidden: true, inputOrigin: 'system' })
  })

  test('a later focus change updates the active Agent for the next reply without auto-sending', async () => {
    const appliedContexts: Array<{ customSystemPrompt?: string; agentSkillSlugs?: string[] }> = []
    managed.launchReceipt = { ...focusedReceipt, taskModeSelectionPending: false }
    managed.messages = [{ id: 'user-1', role: 'user', content: 'Existing turn', timestamp: 1 }]
    managed.isProcessing = true
    managed.enabledSourceSlugs = ['manual-source']
    managed.agent = {
      setAgentContext: (context: AgentContextUpdate) => { appliedContexts.push(context) },
    } as unknown as AgentBackend
    let sendCount = 0
    manager.sendMessage = async () => { sendCount += 1 }

    await manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true })

    expect(sendCount).toBe(0)
    expect(appliedContexts).toEqual([])
    expect(managed.customSystemPrompt).toBe('Focused branding prompt')
    expect(managed.enabledSourceSlugs).toEqual(['manual-source', 'artist-profile'])
  })

  test('does not rewrite context while the hidden opening turn is still initializing', async () => {
    managed.launchReceipt = { ...focusedReceipt, taskModeSelectionPending: false }
    managed.messages = [{
      id: 'hidden-start',
      role: 'user',
      content: 'INTERNAL TASK MODE START',
      timestamp: 1,
      hidden: true,
    }]
    managed.isProcessing = true

    await expect(manager.selectSessionTaskMode(managed.id, 'narrative-universe')).rejects.toThrow(
      'The opening response is still starting.',
    )
  })

  test('two concurrent initial selections cannot rewrite focus before hidden-send admission', async () => {
    let acknowledge!: () => void
    let entered!: () => void
    const sending = new Promise<void>(resolve => { entered = resolve })
    const admitted = new Promise<void>(resolve => { acknowledge = resolve })
    let sends = 0
    manager.sendMessage = async (...args) => {
      sends += 1
      entered()
      await admitted
      args[7]?.('hidden-start')
    }
    const first = manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true })
    await sending
    // isProcessing is deliberately still false: this is the admission gap.
    expect(managed.isProcessing).toBe(false)
    try {
      await expect(SessionManager.prototype.sendMessage.call(manager, managed.id, 'A fast Enter press'))
        .rejects.toThrow('The opening response is still starting.')
      expect(managed.messages).toEqual([])
      await expect(manager.selectSessionTaskMode(managed.id, 'visual-world', { startConversation: true }))
        .rejects.toThrow('The opening response is still starting.')
      expect(managed.launchReceipt?.taskMode?.id).toBe('narrative-universe')
      expect(sends).toBe(1)
    } finally {
      acknowledge()
      await first
    }
  })

  test('a real opening flush failure rolls back only its hidden message and permits another start', async () => {
    const internals = manager as unknown as { flushSession: () => Promise<void> }
    internals.flushSession = async () => { throw new Error('Disk unavailable') }
    await expect(manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true }))
      .rejects.toThrow('Disk unavailable')
    expect(managed.messages).toEqual([])
    expect(managed.launchReceipt?.taskModeSelectionPending).toBe(true)
    expect(managed.launchReceipt?.taskMode).toBeUndefined()
    expect(managed.agentSkillSlugs).toBeUndefined()
    let starts = 0
    manager.sendMessage = async (...args) => { starts += 1; args[7]?.('accepted') }
    await manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true })
    expect(starts).toBe(1)
  })

  test('hidden turns never enter memory review or regenerate a title', async () => {
    let reviews = 0
    managed.agent = { runMiniCompletion: async () => { reviews += 1; return null } } as unknown as AgentBackend
    managed.messages = [
      { id: 'hidden', role: 'user', content: 'Remember INTERNAL START forever', timestamp: 1, hidden: true },
      { id: 'answer', role: 'assistant', content: 'What inspires you?', timestamp: 2 },
    ]
    const internals = manager as unknown as {
      scheduleMemorySidecarReview: (session: typeof managed, messageId: string) => void
      buildMemorySidecarIndex: () => []
    }
    internals.buildMemorySidecarIndex = () => []
    internals.scheduleMemorySidecarReview(managed, 'answer')
    expect(reviews).toBe(0)
    expect(await manager.refreshTitle(managed.id)).toEqual({ success: false, error: 'No user messages to generate title from' })
    managed.messages.unshift({ id: 'earlier', role: 'user', content: 'I love blue', timestamp: 0 })
    internals.scheduleMemorySidecarReview(managed, 'answer')
    expect(reviews).toBe(0) // Never pair a hidden turn with an older human ask.
  })

  test('a rejected opening can be selected again without leaving the opening gate stuck', async () => {
    manager.sendMessage = async () => { throw new Error('Admission failed') }
    await expect(manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true }))
      .rejects.toThrow('Admission failed')
    expect(managed.launchReceipt?.taskModeSelectionPending).toBe(true)
    manager.sendMessage = async (...args) => { args[7]?.('accepted') }
    await manager.selectSessionTaskMode(managed.id, 'narrative-universe', { startConversation: true })
    expect(managed.launchReceipt?.taskModeSelectionPending).toBe(false)
  })

  test('async backend initialization receives the admitted focus despite another selection', async () => {
    managed.launchReceipt = { ...focusedReceipt, taskModeSelectionPending: false }
    managed.messages = [{ id: 'real', role: 'user', content: 'Prior real request', timestamp: 1 }]
    managed.customSystemPrompt = 'Original admitted focus'
    managed.name = 'Branding'
    const internals = manager as unknown as {
      getOrCreateAgent: (session: typeof managed, context: AgentContextUpdate) => Promise<AgentBackend>
    }
    let captured: AgentContextUpdate | undefined
    internals.getOrCreateAgent = async (_session, context) => {
      await manager.selectSessionTaskMode(managed.id, 'narrative-universe')
      captured = context
      throw new Error('Stop before provider execution')
    }
    await expect(manager.sendMessage(managed.id, 'An admitted request')).rejects.toThrow('Stop before provider execution')
    expect(captured?.customSystemPrompt).toBe('Original admitted focus')
    expect(managed.customSystemPrompt).toBe('Focused branding prompt')
    // Auth recovery is another attempt of the same response, not a new turn.
    managed.isProcessing = false
    await expect(manager.sendMessage(managed.id, 'An admitted request', undefined, undefined, undefined, undefined, true))
      .rejects.toThrow('Stop before provider execution')
    expect(captured?.customSystemPrompt).toBe('Original admitted focus')
    managed.isProcessing = false
    await expect(manager.sendMessage(managed.id, 'Now change focus')).rejects.toThrow('Stop before provider execution')
    expect(captured?.customSystemPrompt).toBe('Focused branding prompt')
  })

  test('source retry keeps admitted focus, activated source and input identity without another user bubble', async () => {
    managed.launchReceipt = { ...focusedReceipt, taskModeSelectionPending: false }
    managed.messages = [{ id: 'original', role: 'user', content: 'Original ask', timestamp: 1, inputOrigin: 'human' }]
    managed.name = 'Branding'
    managed.lastSentInputMessageId = 'original'
    managed.lastSentMessage = 'Original ask'
    managed.lastSentOptions = { inputOrigin: 'human' }
    managed.lastSentTurnContext = { customSystemPrompt: 'Admitted focus', agentSkillSlugs: ['original-skill'], enabledSourceSlugs: ['activated-source'], launchReceipt: managed.launchReceipt }
    managed.customSystemPrompt = 'Pending next focus'
    const internals = manager as unknown as {
      processEvent: (session: typeof managed, event: AgentEvent) => Promise<void>
      getOrCreateAgent: (session: typeof managed, context: NonNullable<typeof managed.lastSentTurnContext>) => Promise<AgentBackend>
    }
    await internals.processEvent(managed, { type: 'source_activated', sourceSlug: 'activated-source', originalMessage: 'Original ask' })
    const token = managed.pendingSourceRetry!.token
    let captured: typeof managed.lastSentTurnContext | undefined
    internals.getOrCreateAgent = async (_session, context) => { captured = context; throw new Error('Stop before provider') }
    let ack: string | undefined
    await expect(manager.sendMessage(managed.id, 'Untrusted replacement text', undefined, undefined, { sourceRetryToken: token, inputOrigin: 'system' }, undefined, undefined, id => { ack = id }))
      .rejects.toThrow('Stop before provider')
    expect(ack).toBe('original')
    expect(managed.messages.filter(message => message.role === 'user')).toHaveLength(1)
    expect(managed.lastSentInputMessageId).toBe('original')
    expect(managed.lastSentMessage).toContain('Original ask')
    expect(managed.lastSentMessage).not.toContain('Untrusted replacement')
    expect(captured?.customSystemPrompt).toBe('Admitted focus')
    expect(captured?.enabledSourceSlugs).toEqual(['activated-source'])
    await expect(manager.sendMessage(managed.id, '', undefined, undefined, { sourceRetryToken: token })).rejects.toThrow('stale')
    managed.isProcessing = false
    await expect(manager.sendMessage(managed.id, 'Auth retry', undefined, undefined, undefined, 'original', true)).rejects.toThrow('Stop before provider')
    expect(captured?.customSystemPrompt).toBe('Admitted focus')
    expect(captured?.enabledSourceSlugs).toEqual(['activated-source'])
    managed.isProcessing = false
    await expect(manager.sendMessage(managed.id, 'Next real ask')).rejects.toThrow('Stop before provider')
    expect(captured?.customSystemPrompt).toBe('Pending next focus')
    expect(managed.lastSentInputMessageId).not.toBe('original')
  })

  test('forged source retry token never admits a user message', async () => {
    await expect(manager.sendMessage(managed.id, 'Injected ask', undefined, undefined, { sourceRetryToken: 'forged' })).rejects.toThrow('stale')
    expect(managed.messages).toHaveLength(0)
  })

  test('Stop invalidates a source retry even after provider teardown', async () => {
    managed.pendingSourceRetry = {
      token: 'stopped-token', inputMessageId: 'original', generation: managed.processingGeneration,
      sourceSlug: 'calendar', message: 'Original ask', turnContext: {},
    }
    managed.isProcessing = false
    await manager.cancelProcessing(managed.id)
    await expect(manager.sendMessage(managed.id, '', undefined, undefined, { sourceRetryToken: 'stopped-token' })).rejects.toThrow('stale')
    expect(managed.messages).toHaveLength(0)
  })

  test('an in-flight fallback keeps the admitted focus and the next send receives the new focus', async () => {
    const original = { customSystemPrompt: 'Original visual focus', agentSkillSlugs: ['artist-visual-world-director'] }
    managed.customSystemPrompt = original.customSystemPrompt
    managed.agentSkillSlugs = original.agentSkillSlugs
    managed.launchReceipt = { ...focusedReceipt, taskModeSelectionPending: false }
    managed.messages = [{ id: 'real', role: 'user', content: 'Make a visual direction', timestamp: 1 }]
    managed.name = 'Branding'
    managed.sdkSessionId = 'focus-race-sdk'
    let releasePrimary!: () => void
    let primaryStarted!: () => void
    const gate = new Promise<void>(resolve => { releasePrimary = resolve })
    const started = new Promise<void>(resolve => { primaryStarted = resolve })
    const primaryContexts: AgentContextUpdate[] = []
    const fallbackContexts: AgentContextUpdate[] = []
    const primary = {
      setAgentContext: (context: AgentContextUpdate) => { primaryContexts.push(context) },
      setAllSources: () => {}, getModel: () => 'primary',
      getSummarizeCallback: () => async () => null,
      async *chat(): AsyncGenerator<AgentEvent> {
        primaryStarted()
        yield { type: 'text_delta', text: 'Starting visual work' }
        await gate
        yield { type: 'typed_error', error: { code: 'service_unavailable', title: 'Unavailable', message: 'Try fallback', actions: [], canRetry: true } }
      },
    } as unknown as AgentBackend
    const fallback = {
      setAgentContext: (context: AgentContextUpdate) => { fallbackContexts.push(context) },
      setAllSources: () => {}, getModel: () => 'fallback',
      getSummarizeCallback: () => async () => null,
      postInit: async () => ({}), destroy: () => {},
      async *chat(): AsyncGenerator<AgentEvent> {
        yield { type: 'text_complete', text: 'Visual work completed' }
        yield { type: 'complete' }
      },
    } as unknown as AgentBackend
    managed.agent = createModelFallbackBackend({
      primary, primaryConnectionSlug: 'focus-race-primary', primaryModel: 'focus-race-model',
      resolveCandidates: async () => [{ connectionSlug: 'focus-race-backup', model: 'backup', chainIndex: 1, create: () => fallback }],
    })
    const internals = manager as unknown as {
      getOrCreateAgent: (...args: unknown[]) => Promise<AgentBackend>
      processEvent: () => void
      onProcessingStopped: () => Promise<void>
      resolveAgentSessionOptions: () => Promise<Partial<CreateSessionOptions>>
    }
    internals.getOrCreateAgent = async () => managed.agent!
    internals.processEvent = () => {}
    internals.onProcessingStopped = async () => { managed.isProcessing = false }
    internals.resolveAgentSessionOptions = async () => ({ ...focusedOptions(), enabledSourceSlugs: [] })
    const response = manager.sendMessage(managed.id, 'Start visual work')
    await started
    try {
      await manager.selectSessionTaskMode(managed.id, 'narrative-universe')
      expect(primaryContexts).toEqual([original])
    } finally {
      releasePrimary()
      await response
    }
    expect(fallbackContexts).toEqual([original])
    await manager.sendMessage(managed.id, 'Now develop the narrative')
    expect(fallbackContexts.at(-1)).toEqual({
      customSystemPrompt: 'Focused branding prompt', agentSkillSlugs: ['artist-narrative-universe'],
    })
  })
})
