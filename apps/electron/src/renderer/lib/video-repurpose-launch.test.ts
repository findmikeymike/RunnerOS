import { describe, expect, test } from 'bun:test'
import type { AgentDefinitionDTO, Session } from '../../shared/types'
import { openVideoRepurposeSession } from './video-repurpose-launch'

function rawVideoEditor(): AgentDefinitionDTO {
  return {
    slug: 'raw-video-editor',
    systemPrompt: 'Edit footage.',
    path: '/agents/raw-video-editor',
    source: 'global',
    metadata: {
      name: 'Raw Video Editor',
      description: 'Turns footage into polished edits.',
      skills: ['raw-video-editor'],
      sources: ['raw-video-editor'],
      tags: [],
      visualAgent: true,
      inputs: '',
      outputs: '',
    },
  }
}

function session(): Session {
  return {
    id: 'session-1',
    workspaceId: 'workspace-1',
    workspaceName: 'Workspace',
    name: 'Raw Video Editor',
    lastMessageAt: Date.now(),
    isProcessing: false,
    createdAt: Date.now(),
    messages: [],
  }
}

describe('openVideoRepurposeSession', () => {
  test('reuses the active raw-video-editor agent and auto-sends the kickoff draft', async () => {
    const agent = rawVideoEditor()
    let called = false
    const result = await openVideoRepurposeSession({
      workspaceId: 'workspace-1',
      draftInput: 'Create variants from this source.',
      activeAgents: [agent],
      skills: [],
      sources: [],
      onCreateSession: async () => session(),
      onInputChange: () => {},
      onSendMessage: async () => true,
      getAgentDefinition: async () => null,
      listWorkspaceContextDocsForAgent: async () => [],
      openSessionComposer: async (params) => {
        called = true
        expect(params.agent.slug).toBe('raw-video-editor')
        expect(params.workspaceId).toBe('workspace-1')
        expect(params.draftInput).toBe('Create variants from this source.')
        expect(params.autoSendDraft).toBe(true)
        return session()
      },
    })
    expect(called).toBe(true)
    expect(result.id).toBe('session-1')
  })

  test('falls back to the bridge when the agent is not active in the current workspace', async () => {
    let lookedUpSlug = ''
    await openVideoRepurposeSession({
      workspaceId: 'workspace-1',
      draftInput: 'Create variants from this source.',
      activeAgents: [],
      skills: [],
      sources: [],
      onCreateSession: async () => session(),
      onInputChange: () => {},
      onSendMessage: async () => true,
      getAgentDefinition: async (slug) => {
        lookedUpSlug = slug
        return rawVideoEditor()
      },
      listWorkspaceContextDocsForAgent: async () => [],
      openSessionComposer: async () => session(),
    })
    expect(lookedUpSlug).toBe('raw-video-editor')
  })

  test('can open the editor session before the durable set and kickoff are created', async () => {
    await openVideoRepurposeSession({
      workspaceId: 'workspace-1',
      activeAgents: [rawVideoEditor()],
      skills: [],
      sources: [],
      onCreateSession: async () => session(),
      onInputChange: () => {},
      onSendMessage: async () => true,
      getAgentDefinition: async () => null,
      listWorkspaceContextDocsForAgent: async () => [],
      openSessionComposer: async (params) => {
        expect(params.draftInput).toBeUndefined()
        expect(params.autoSendDraft).toBe(false)
        expect(params.navigateOnCreate).toBe(false)
        return session()
      },
      autoSendDraft: false,
      navigateOnCreate: false,
    })
  })
})
