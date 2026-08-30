import * as React from 'react'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../../../../shared/types'
import { ChatGoalControls, parseChatGoalCommand } from './ChatGoalControls'

describe('ChatGoalControls', () => {
  it('parses only explicit slash and dollar Goal commands', () => {
    expect(parseChatGoalCommand('/goal')).toBeNull()
    expect(parseChatGoalCommand('$goal Build the release plan')).toBe('Build the release plan')
    expect(parseChatGoalCommand('make this a goal')).toBeUndefined()
    expect(parseChatGoalCommand('/goalish nope')).toBeUndefined()
  })

  it('renders status text, round count, and labelled controls without relying on color', () => {
    const session = {
      id: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Artist OS',
      messages: [],
      isProcessing: false,
      lastMessageAt: 1,
      chatGoal: {
        schemaVersion: 1,
        id: 'goal-1',
        objective: 'Build a grounded release plan',
        status: 'active',
        revision: 1,
        round: 2,
        maxRounds: 6,
        createdAt: 1,
        updatedAt: 2,
      },
    } satisfies Session

    const html = renderToStaticMarkup(<ChatGoalControls session={session} />)
    expect(html).toContain('aria-label="Chat Goal"')
    expect(html).toContain('Goal active')
    expect(html).toContain('Round 2/6')
    expect(html).toContain('aria-label="Pause Goal"')
    expect(html).toContain('aria-label="Stop Goal now"')
  })

  it('offers token-budget recovery even when the round cap is already twelve', () => {
    const session = {
      id: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Artist OS',
      messages: [],
      isProcessing: false,
      lastMessageAt: 1,
      chatGoal: {
        schemaVersion: 1,
        id: 'goal-1',
        objective: 'Finish the plan',
        status: 'budget-limited',
        revision: 3,
        round: 4,
        maxRounds: 12,
        tokenBaseline: 100,
        tokenBudget: 1_000,
        stop: { code: 'token-limit', message: 'Goal reached its token budget.', at: 3 },
        createdAt: 1,
        updatedAt: 3,
      },
      tokenUsage: {
        inputTokens: 1_100,
        outputTokens: 0,
        totalTokens: 1_100,
        contextTokens: 1_100,
        costUsd: 0,
      },
    } satisfies Session

    const html = renderToStaticMarkup(<ChatGoalControls session={session} />)
    const recoveryButton = html.match(/<button[^>]*>Increase budget<\/button>/)?.[0]
    expect(recoveryButton).toBeDefined()
    expect(recoveryButton).not.toContain(' disabled=""')
  })
})
