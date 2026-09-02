import * as React from 'react'
import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../../../../shared/types'
import { buildGoalCommandDraft, ChatGoalBadge, ChatGoalControls, parseChatGoalCommand } from './ChatGoalControls'

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

    const html = renderToStaticMarkup(<ChatGoalControls session={session} defaultExpanded />)
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

    const html = renderToStaticMarkup(<ChatGoalControls session={session} defaultExpanded />)
    const recoveryButton = html.match(/<button[^>]*>Increase budget<\/button>/)?.[0]
    expect(recoveryButton).toBeDefined()
    expect(recoveryButton).not.toContain(' disabled=""')
  })

  it('shows when completion could not verify open tasks', () => {
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
        status: 'complete',
        revision: 2,
        round: 1,
        maxRounds: 6,
        completion: {
          summary: 'Finished the plan.',
          taskVerification: 'skipped-degraded',
          completedAt: 3,
        },
        createdAt: 1,
        updatedAt: 3,
      },
    } satisfies Session

    const html = renderToStaticMarkup(<ChatGoalControls session={session} defaultExpanded />)
    expect(html).toContain('Goal completed while task tracking was unavailable')
    expect(html).toContain('Open tasks could not be verified')
  })

  it('uses the prime chat badge to start or reopen Goal controls', () => {
    const baseSession = {
      id: 'session-1',
      workspaceId: 'workspace-1',
      workspaceName: 'Artist OS',
      messages: [],
      isProcessing: false,
      lastMessageAt: 1,
    } satisfies Session

    const emptyHtml = renderToStaticMarkup(<ChatGoalBadge session={baseSession} onDraftChange={() => {}} />)
    expect(emptyHtml).toContain('aria-label="Write a Goal in chat"')
    expect(emptyHtml).toContain('>Goal<')

    const activeHtml = renderToStaticMarkup(<ChatGoalBadge session={{
      ...baseSession,
      chatGoal: {
        schemaVersion: 1,
        id: 'goal-1',
        objective: 'Finish the release plan',
        status: 'active',
        revision: 1,
        round: 2,
        maxRounds: 6,
        createdAt: 1,
        updatedAt: 2,
      },
    }} />)
    expect(activeHtml).toContain('Open Goal controls: Goal 2/6')
    expect(activeHtml).toContain('Goal 2/6')
  })

  it('turns the existing chat draft into a Goal command without losing it', () => {
    expect(buildGoalCommandDraft()).toBe('$goal ')
    expect(buildGoalCommandDraft('Finish the Angelina release plan')).toBe('$goal Finish the Angelina release plan')
    expect(buildGoalCommandDraft('$goal Finish the plan')).toBe('$goal Finish the plan')
    expect(buildGoalCommandDraft('/goal Finish the plan')).toBe('/goal Finish the plan')
  })
})
