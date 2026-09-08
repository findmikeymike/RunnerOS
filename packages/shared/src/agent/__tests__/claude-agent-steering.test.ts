import { describe, expect, it, mock } from 'bun:test'
import { ClaudeAgent } from '../claude-agent.ts'
import { AbortReason } from '../backend/types.ts'

function streamingAgent() {
  const agent = Object.create(ClaudeAgent.prototype) as any
  agent.currentQuery = {}
  agent.currentQueryAbortController = { abort: mock(() => {}) }
  agent.pendingSteerMessage = null
  agent.debug = mock(() => {})
  return agent
}

describe('ClaudeAgent mid-stream steering', () => {
  it('retains successive updates in arrival order until an injecting hook consumes them', () => {
    const agent = streamingAgent()
    expect(agent.redirect('Use the acoustic version.')).toBe(true)
    expect(agent.redirect('Also keep the original title.')).toBe(true)
    expect(agent.pendingSteerMessage).toBe('Use the acoustic version.\n\nAlso keep the original title.')
    expect(agent.consumePendingSteerMessage('allow')).toBe('Use the acoustic version.\n\nAlso keep the original title.')
    expect(agent.pendingSteerMessage).toBeNull()
    expect(agent.consumePendingSteerMessage('allow')).toBeNull()
  })

  for (const outcome of ['block', 'source_activation_needed', 'prompt', 'call_llm_intercept', 'spawn_session_intercept']) {
    it(`preserves updates across ${outcome} for a later injecting hook or end-of-turn recovery`, () => {
      const agent = streamingAgent()
      agent.redirect('Change the artwork direction.')
      expect(agent.consumePendingSteerMessage(outcome)).toBeNull()
      expect(agent.pendingSteerMessage).toBe('Change the artwork direction.')
      agent.redirect('Keep the release date.')
      expect(agent.consumePendingSteerMessage('modify')).toBe('Change the artwork direction.\n\nKeep the release date.')
      expect(agent.pendingSteerMessage).toBeNull()
    })
  }

  it('preserves abort-and-queue fallback when there is no active query', () => {
    const agent = streamingAgent()
    agent.currentQuery = null
    agent.forceAbort = mock(() => {})
    expect(agent.redirect('Next update')).toBe(false)
    expect(agent.forceAbort).toHaveBeenCalledWith(AbortReason.Redirect)
    expect(agent.pendingSteerMessage).toBeNull()
  })

  it('discards accumulated updates when the user explicitly stops', () => {
    const agent = streamingAgent()
    const controller = agent.currentQueryAbortController
    agent.teardownPersistentQuery = mock(() => {})
    agent.redirect('First update')
    agent.redirect('Second update')
    agent.forceAbort(AbortReason.UserStop)
    expect(controller.abort).toHaveBeenCalledWith(AbortReason.UserStop)
    expect(agent.pendingSteerMessage).toBeNull()
    expect(agent.currentQuery).toBeNull()
  })
})
