import { beforeEach, describe, expect, test } from 'bun:test'
import type { AgentBackend, AgentContextUpdate } from '@craft-agent/shared/agent/backend'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
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
    expect(appliedContexts).toEqual([{
      customSystemPrompt: 'Focused branding prompt',
      agentSkillSlugs: ['artist-narrative-universe'],
    }])
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
})
