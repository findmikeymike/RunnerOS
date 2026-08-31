import { describe, expect, it } from 'bun:test'
import type { SessionState } from '../../types'
import { processEvent } from '../../processor'
import { createSessionTaskList } from '@craft-agent/shared/sessions'

function makeState(): SessionState {
  return {
    session: {
      id: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Artist OS',
      messages: [],
      isProcessing: false,
      lastMessageAt: 1,
    },
    streaming: null,
  }
}

describe('chat Goal events', () => {
  it('updates the Goal without disturbing streaming state', () => {
    const state = makeState()
    state.streaming = { content: 'still streaming', turnId: 'turn-1' }

    const result = processEvent(state, {
      type: 'goal_state_changed',
      sessionId: 'session-1',
      chatGoal: {
        schemaVersion: 1,
        id: 'goal-1',
        objective: 'Finish the launch plan',
        status: 'active',
        revision: 2,
        round: 1,
        maxRounds: 6,
        createdAt: 1,
        updatedAt: 2,
      },
    })

    expect(result.state.session.chatGoal?.objective).toBe('Finish the launch plan')
    expect(result.state.streaming).toEqual(state.streaming)
    expect(result.effects).toEqual([])
  })

  it('turns a host proposal into a session-scoped setup effect', () => {
    const result = processEvent(makeState(), {
      type: 'goal_creation_proposed',
      sessionId: 'session-1',
      proposal: { objective: 'Research the release plan', maxRounds: 4 },
      confirmationNonce: 'host-nonce',
    })

    expect(result.effects).toEqual([{
      type: 'open_goal_setup',
      sessionId: 'session-1',
      proposal: { objective: 'Research the release plan', maxRounds: 4 },
      confirmationNonce: 'host-nonce',
    }])
  })

  it('appends a live Goal divider once and deduplicates replay by message id', () => {
    const event = {
      type: 'goal_event' as const,
      sessionId: 'session-1',
      message: {
        id: 'goal-event-1',
        role: 'info' as const,
        content: 'Goal continuing automatically.',
        timestamp: 10,
        displayIntent: 'goal-event' as const,
        goalEvent: {
          type: 'resumed' as const,
          goalId: 'goal-1',
          revision: 1,
          timestamp: 10,
          round: 2,
          maxRounds: 6,
          status: 'active' as const,
          summary: 'Goal continuing automatically.',
        },
      },
    }

    const first = processEvent(makeState(), event)
    const replayed = processEvent(first.state, event)
    expect(first.state.session.messages).toHaveLength(1)
    expect(replayed.state.session.messages).toHaveLength(1)
  })

  it('applies durable task snapshots without disturbing streaming state', () => {
    const state = makeState()
    state.streaming = { content: 'still working', turnId: 'turn-1' }
    const sessionTasks = createSessionTaskList([
      { content: 'Delegate visual review', status: 'pending' },
    ], 'native-tool', { now: '2026-08-30T12:00:00.000Z' })

    const result = processEvent(state, {
      type: 'session_tasks_changed',
      sessionId: 'session-1',
      sessionTasks,
      degraded: false,
    })

    expect(result.state.session.sessionTasks).toEqual(sessionTasks)
    expect(result.state.session.sessionTasksDegraded).toBe(false)
    expect(result.state.streaming).toEqual(state.streaming)
    expect(result.effects).toEqual([])
  })

  it('retains the last durable snapshot when a task write degrades', () => {
    const state = makeState()
    const sessionTasks = createSessionTaskList([
      { content: 'Keep visible', status: 'pending' },
    ], 'native-tool', { now: '2026-08-30T12:00:00.000Z' })
    state.session.sessionTasks = sessionTasks

    const result = processEvent(state, {
      type: 'session_tasks_changed',
      sessionId: 'session-1',
      sessionTasks,
      degraded: true,
      error: 'Could not save task state',
    })

    expect(result.state.session.sessionTasks).toEqual(sessionTasks)
    expect(result.state.session.sessionTasksDegraded).toBe(true)
    expect(result.state.session.sessionTasksError).toBe('Could not save task state')
  })
})
