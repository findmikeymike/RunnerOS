import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createStore, Provider } from 'jotai'
import { useAgents, type UseAgentsOptions, type UseAgentsResult } from './useAgents'
import type { AgentDefinitionDTO } from '../../shared/types'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
  else globalThis.window = originalWindow
})

// Render the real hook against a fresh Jotai store. Server rendering lets these
// tests drive refresh explicitly without mocking React or leaking module mocks.
function harness(workspaceId: string | null, initialActive: string[], options: UseAgentsOptions = {}) {
  let saved = [...initialActive]
  const library = ['industry-hunter', 'content-director', 'ads-strategist', 'record-doctor']
    .map((slug) => ({ slug, metadata: { name: slug } } as AgentDefinitionDTO))
  const api = {
    upsertAgentDefinition: mock(async (input: { slug: string; metadata: AgentDefinitionDTO['metadata']; systemPrompt: string }) => {
      const created = { ...input } as AgentDefinitionDTO
      const existing = library.findIndex((agent) => agent.slug === input.slug)
      if (existing >= 0) library[existing] = created
      else library.push(created)
      // Simulate successful definition save with refused activation.
      return created
    }),
    listAllAgentDefinitions: mock(async () => library),
    listActiveAgentDefinitions: mock(async () => [...saved]),
    setAgentDefinitionActive: mock(async (_workspaceId: string, slug: string, active: boolean) => {
      saved = active ? [...new Set([...saved, slug])] : saved.filter((item) => item !== slug)
      return { active: [...saved] }
    }),
  }
  globalThis.window = { electronAPI: api } as unknown as Window & typeof globalThis
  const store = createStore()
  let result: UseAgentsResult
  function Probe() {
    result = useAgents(workspaceId, options)
    return null
  }
  function render() {
    renderToString(createElement(Provider, { store }, createElement(Probe)))
    return result!
  }
  return { api, render }
}

describe('workspace activation truth in useAgents', () => {
  test('Workers keeps available default definitions inactive until saved by the server', async () => {
    const { api, render } = harness('campaign', ['record-doctor'], {
      defaultVisibleSlugs: ['content-director', 'industry-hunter'],
      includeSystemVisibleAgents: true,
    })
    await render().refresh()
    const state = render()
    expect(state.allAgents.map((agent) => agent.slug)).toContain('content-director')
    expect(state.activeSlugs).toEqual(['record-doctor'])
    expect(state.activeAgents.map((agent) => agent.slug)).toEqual(['record-doctor'])
    expect(api.listActiveAgentDefinitions).toHaveBeenCalledWith('campaign')
  })

  test('Library activation and deactivation of former pinned built-ins survives refresh', async () => {
    const { api, render } = harness('campaign-toggle', ['ads-strategist'], {
      defaultVisibleSlugs: ['ads-strategist', 'content-director'],
    })
    await render().refresh()
    await render().setActive('ads-strategist', false)
    expect(api.setAgentDefinitionActive).toHaveBeenCalledWith('campaign-toggle', 'ads-strategist', false)
    expect(render().activeSlugs).toEqual([])
    await render().refresh()
    expect(render().activeAgents).toEqual([])
    expect(render().allAgents).toHaveLength(4)

    await render().setActive('content-director', true)
    expect(render().activeSlugs).toEqual(['content-director'])
    await render().refresh()
    expect(render().activeAgents.map((agent) => agent.slug)).toEqual(['content-director'])
  })

  test('Lab Library does not reinsert built-ins or inactive defaults', async () => {
    const { render } = harness('lab', [], {
      includeSystemVisibleAgents: false,
      defaultVisibleSlugs: ['record-doctor'],
    })
    await render().refresh()
    expect(render().allAgents).toHaveLength(4)
    expect(render().activeSlugs).toEqual([])
    await render().setActive('record-doctor', true)
    await render().refresh()
    expect(render().activeSlugs).toEqual(['record-doctor'])
  })

  test('a rejected activation does not make the worker look active', async () => {
    const { api, render } = harness('rejected-toggle', [])
    await render().refresh()
    api.setAgentDefinitionActive.mockImplementationOnce(async () => {
      throw new Error('Agent is not eligible in this workspace')
    })
    await expect(render().setActive('industry-hunter', true)).rejects.toThrow('not eligible')
    expect(render().activeSlugs).toEqual([])
    await render().refresh()
    expect(render().activeSlugs).toEqual([])
  })

  test('upsert keeps a saved definition available when activation was refused', async () => {
    const { api, render } = harness('upsert-refused', ['record-doctor'])
    await render().refresh()
    const input = {
      slug: 'new-worker',
      metadata: { name: 'New Worker' } as AgentDefinitionDTO['metadata'],
      systemPrompt: 'Help the artist.',
    }
    await render().upsert(input)
    expect(api.upsertAgentDefinition).toHaveBeenCalledWith({ ...input, activateInWorkspaceId: 'upsert-refused' })
    expect(render().allAgents.map((agent) => agent.slug)).toContain('new-worker')
    expect(render().activeSlugs).toEqual(['record-doctor'])
    await render().refresh()
    expect(render().allAgents.map((agent) => agent.slug)).toContain('new-worker')
    expect(render().activeSlugs).toEqual(['record-doctor'])
  })

  test('upsert exposes activation only when confirmed by the manifest', async () => {
    const { api, render } = harness('upsert-activated', [])
    await render().refresh()
    api.listActiveAgentDefinitions.mockResolvedValueOnce(['new-worker'])
    await render().upsert({
      slug: 'new-worker',
      metadata: { name: 'New Worker' } as AgentDefinitionDTO['metadata'],
      systemPrompt: 'Help the artist.',
    })
    expect(render().activeAgents.map((agent) => agent.slug)).toEqual(['new-worker'])
  })

  test('no workspace exposes the library without fabricating active workers', async () => {
    const { api, render } = harness(null, ['industry-hunter'])
    await render().refresh()
    expect(render().allAgents).toHaveLength(4)
    expect(render().activeSlugs).toEqual([])
    expect(api.listActiveAgentDefinitions).not.toHaveBeenCalled()
    await render().setActive('industry-hunter', true)
    expect(api.setAgentDefinitionActive).not.toHaveBeenCalled()
  })
})
