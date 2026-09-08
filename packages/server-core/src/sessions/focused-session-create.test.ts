import { expect, test } from 'bun:test'
import type { CreateSessionOptions } from '@craft-agent/shared/protocol'
import { resolveFocusedSessionCreateOptions } from './focused-session-create'

const options: CreateSessionOptions = {
  model: 'chosen-model', permissionMode: 'safe',
  customSystemPrompt: 'stale broad prompt', agentSkillSlugs: ['unrelated'], enabledSourceSlugs: ['unrelated-source'],
  spawnedFromAgent: { agentSlug: 'writer', agentName: 'Writer' },
  launchReceipt: { createdAt: 1, origin: 'agent', agent: { slug: 'writer', name: 'Writer' },
    taskMode: { schemaVersion: 1, id: 'draft', label: 'Draft', definitionRevision: 'old', selectionSource: 'user', primarySkills: ['unrelated'], adjacentSkills: [], fullMode: false },
    config: {}, injected: { skills: [], sources: [], contextDocs: [] } },
}

test('focused RPC creation replaces client capability claims with the host recipe and explicit empty sources', async () => {
  const result = await resolveFocusedSessionCreateOptions('workspace', options, async (workspace, agent, selection) => {
    expect([workspace, agent, selection?.taskModeId, selection?.referenceMode]).toEqual(['workspace', 'writer', 'draft', 'strict'])
    return { customSystemPrompt: 'host prompt', agentSkillSlugs: ['writing'], enabledSourceSlugs: [], spawnedFromAgent: options.spawnedFromAgent,
      launchReceipt: { ...options.launchReceipt!, taskMode: { ...options.launchReceipt!.taskMode!, definitionRevision: 'current', primarySkills: ['writing'] } } }
  })
  expect(result?.agentSkillSlugs).toEqual(['writing'])
  expect(result?.enabledSourceSlugs).toEqual([])
  expect(result?.customSystemPrompt).toBe('host prompt')
  expect(result?.model).toBe('chosen-model')
  expect(result?.permissionMode).toBe('safe')
})

test('missing focused dependencies reject before session creation', async () => {
  await expect(resolveFocusedSessionCreateOptions('workspace', options, async () => { throw new Error('Missing writing skill') })).rejects.toThrow('Missing writing skill')
})

test('branches keep their host inheritance path and ordinary chats retain their options', async () => {
  const resolve = async () => { throw new Error('Must not resolve here') }
  const branch = { ...options, branchFromSessionId: 'parent', branchFromMessageId: 'message' }
  expect(await resolveFocusedSessionCreateOptions('workspace', branch, resolve)).toBe(branch)
  expect(await resolveFocusedSessionCreateOptions('workspace', undefined, resolve)).toBeUndefined()
})
