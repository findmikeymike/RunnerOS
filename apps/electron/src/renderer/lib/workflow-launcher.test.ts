import { describe, expect, test } from 'bun:test'
import type { ContextDocDTO, WorkflowDTO } from '../../shared/types'
import { buildWorkflowLaunchContextDocs, createWorkflowSetupDraft, resolveWorkflowLaunchWorkspace } from './workflow-launcher'

function workflow(overrides: Partial<WorkflowDTO> = {}): WorkflowDTO {
  return {
    slug: 'lyric-clips',
    path: '/tmp/lyric-clips.md',
    metadata: {
      name: 'Lyric Clips',
      description: 'Create short lyric-led visuals.',
      trigger: {
        type: 'manual',
        inputs: [
          { name: 'lyrics', type: 'string', required: true },
          { name: 'master_audio', type: 'string', required: true },
          { name: 'notes', type: 'string', required: false },
        ],
      },
      steps: [],
    },
    body: '',
    ...overrides,
  } as WorkflowDTO
}

function doc(slug: string): ContextDocDTO {
  return {
    slug,
    metadata: {
      name: slug,
      enabled: true,
    },
    body: slug,
    path: `/tmp/context/${slug}/CONTEXT.md`,
    workspaceRootPath: '/tmp',
  } as ContextDocDTO
}

describe('workflow launcher prompt helpers', () => {
  test('resolves launch context from the requested workspace instead of the active one', () => {
    const workspaces = [{ id: 'hq', name: 'HQ' }, { id: 'campaign-2', name: 'Second Campaign' }]
    expect(resolveWorkflowLaunchWorkspace(workspaces, 'campaign-2')).toEqual(workspaces[1])
  })

  test('adds one manager-facing launch context doc without replacing workspace docs', () => {
    const docs = buildWorkflowLaunchContextDocs([doc('artist-profile')], workflow(), {
      workspaceKind: 'campaign',
      workspaceName: 'Angelina',
      workspaceRootPath: '/tmp',
      seededInputNames: ['lyrics', 'master_audio'],
      seededInputs: { lyrics: 'Approved lyrics', master_audio: '/vault/angelina.wav' },
    })
    expect(docs.map((item) => item.slug)).toEqual(['artist-profile', 'workflow-launch-context'])
    expect(docs[1]?.body).toContain('The artist is asking for setup help, not blind execution.')
    expect(docs[1]?.body).toContain('lyrics: Approved lyrics')
    expect(docs[1]?.body).toContain('master_audio: /vault/angelina.wav')
    expect(docs[1]?.body).toContain('Run now, Schedule once, or Repeat automatically')
  })

  test('creates a human setup draft instead of a blind command', () => {
    const draft = createWorkflowSetupDraft(workflow(), {
      workspaceKind: 'campaign',
      workspaceName: 'Angelina',
      seededInputNames: ['lyrics'],
      seededInputs: { lyrics: 'Approved lyrics' },
    })
    expect(draft).toContain('I want to set up the Lyric Clips workflow')
    expect(draft).toContain('lyrics: Approved lyrics')
    expect(draft).toContain('ask only the key questions')
    expect(draft).toContain('exactly three choices')
    expect(draft).toContain('Do not start the workflow')
  })

  test('does not silently truncate exact seeded workflow inputs', () => {
    const lyrics = `start-${'verse '.repeat(240)}-end`
    const draft = createWorkflowSetupDraft(workflow(), {
      workspaceKind: 'campaign',
      workspaceName: 'Angelina',
      seededInputs: { lyrics },
    })

    expect(draft).toContain(lyrics)
    expect(draft).toContain('-end')
  })
})
