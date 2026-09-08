import { describe, expect, test } from 'bun:test'
import { handleTaskModeSelected } from '../session'
import type { SessionState, TaskModeSelectedEvent } from '../../types'

describe('handleTaskModeSelected', () => {
  test('replaces the pending receipt and activates the selected bundles', () => {
    const receipt: TaskModeSelectedEvent['launchReceipt'] = {
      createdAt: 1,
      origin: 'agent',
      taskMode: {
        schemaVersion: 1,
        id: 'visual-world',
        label: 'Visual World',
        definitionRevision: 'task-mode-v1-test',
        selectionSource: 'user',
        primarySkills: ['artist-visual-world-director'],
        adjacentSkills: [],
        fullMode: false,
      },
      taskModeSelectionPending: false,
      config: {},
      injected: { skills: ['artist-visual-world-director'], sources: ['artist-profile'], contextDocs: [] },
    }
    const state = {
      session: {
        id: 'session-1',
        workspaceId: 'workspace-1',
        workspaceName: 'Workspace',
        lastMessageAt: 1,
        messages: [],
        isProcessing: false,
        launchReceipt: {
          createdAt: 1,
          origin: 'agent',
          taskModeSelectionPending: true,
          config: {},
          injected: { skills: [], sources: [], contextDocs: [] },
        },
      },
      streaming: null,
    } as SessionState
    const event: TaskModeSelectedEvent = {
      type: 'task_mode_selected',
      sessionId: 'session-1',
      taskMode: receipt.taskMode!,
      agentSkillSlugs: ['artist-visual-world-director'],
      enabledSourceSlugs: ['artist-profile'],
      launchReceipt: receipt,
    }

    const result = handleTaskModeSelected(state, event)
    expect(result.state.session.launchReceipt).toEqual(receipt)
    expect(result.state.session.agentSkillSlugs).toEqual(['artist-visual-world-director'])
    expect(result.state.session.enabledSourceSlugs).toEqual(['artist-profile'])
  })
})
