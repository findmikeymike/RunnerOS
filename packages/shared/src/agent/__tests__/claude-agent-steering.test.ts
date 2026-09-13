import { describe, expect, it, mock } from 'bun:test'
import { ClaudeAgent } from '../claude-agent.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AbortReason } from '../backend/types.ts'

function streamingAgent() {
  const agent = Object.create(ClaudeAgent.prototype) as any
  agent.currentQuery = { interrupt: mock(async () => {}) }
  agent.currentQueryAbortController = { abort: mock(() => {}) }
  agent.pendingSteers = []
  agent.debug = mock(() => {})
  agent.teardownPersistentQuery = mock(() => {})
  agent.onSteerDelivered = mock(() => {})
  return agent
}

describe('ClaudeAgent mid-stream steering', () => {
  it('retains original ids and arrival order and acknowledges only injected updates', () => {
    const agent = streamingAgent()
    expect(agent.redirect('Use the acoustic version.', 'first')).toBe(true)
    expect(agent.redirect('Also keep the original title.', 'second')).toBe(true)
    expect(agent.onSteerDelivered).not.toHaveBeenCalled()
    expect(agent.consumePendingSteerMessage('allow')).toBe('Use the acoustic version.\n\nAlso keep the original title.')
    expect(agent.onSteerDelivered).toHaveBeenCalledWith(['first', 'second'])
    expect(agent.takePendingSteers()).toEqual([])
    expect(agent.consumePendingSteerMessage('allow')).toBeNull()
    expect(agent.onSteerDelivered).toHaveBeenCalledTimes(1)
  })

  for (const outcome of ['block', 'source_activation_needed', 'prompt', 'call_llm_intercept', 'spawn_session_intercept']) {
    it(`preserves updates across ${outcome} until injection`, () => {
      const agent = streamingAgent()
      agent.redirect('Change the artwork direction.', 'first')
      expect(agent.consumePendingSteerMessage(outcome)).toBeNull()
      expect(agent.onSteerDelivered).not.toHaveBeenCalled()
      agent.redirect('Keep the release date.', 'second')
      expect(agent.consumePendingSteerMessage('modify')).toBe('Change the artwork direction.\n\nKeep the release date.')
      expect(agent.onSteerDelivered).toHaveBeenCalledWith(['first', 'second'])
    })
  }

  it('preserves abort-and-queue fallback when there is no active query', () => {
    const agent = streamingAgent()
    agent.currentQuery = null
    agent.forceAbort = mock(() => {})
    expect(agent.redirect('Next update', 'next')).toBe(false)
    expect(agent.forceAbort).toHaveBeenCalledWith(AbortReason.Redirect)
    expect(agent.takePendingSteers()).toEqual([])
  })

  for (const reason of [AbortReason.UserStop, AbortReason.SourceActivated, AbortReason.Redirect]) {
    it(`does not erase accepted updates on ${reason}`, () => {
      const agent = streamingAgent()
      agent.redirect('First update', 'first')
      agent.redirect('Second update', 'second')
      agent.forceAbort(reason)
      expect(agent.takePendingSteers()).toEqual([{ message: 'First update', messageId: 'first' }, { message: 'Second update', messageId: 'second' }])
      expect(agent.takePendingSteers()).toEqual([])
      expect(agent.onSteerDelivered).not.toHaveBeenCalled()
    })
  }

  it('lets the host transfer Stop updates once before abort without later replay', () => {
    const agent = streamingAgent()
    agent.redirect('Keep my correction', 'original-id')
    expect(agent.takePendingSteers()).toEqual([{ message: 'Keep my correction', messageId: 'original-id' }])
    agent.forceAbort(AbortReason.UserStop)
    expect(agent.takePendingSteers()).toEqual([])
  })

  it('does not suppress injection when the delivery callback throws', () => {
    const agent = streamingAgent()
    agent.onSteerDelivered = () => { throw new Error('host failed') }
    agent.redirect('Still deliver this.', 'id')
    expect(agent.consumePendingSteerMessage('allow')).toBe('Still deliver this.')
    expect(agent.takePendingSteers()).toEqual([])
    expect(agent.debug).toHaveBeenCalledWith('Steer delivery notification failed: host failed')
  })
})

it('real hook retains steering when host policy denies an otherwise allowed tool', async () => {
  const root = mkdtempSync(join(tmpdir(), 'claude-steer-policy-'))
  let allowed = false
  const agent = new ClaudeAgent({ isHeadless: true, skipConfigWatcher: true,
    workspace: { id: 'steer-policy', name: 'Steering', rootPath: root } as any,
    session: { id: 'steer-policy', workingDirectory: root } as any,
    hostToolExecutionGuard: { beforeToolUse: () => allowed
      ? { allowed: true } : { allowed: false, reason: 'Host denied' } },
  }) as any
  try {
    agent.keepBackgroundTasksAlive = true
    agent.setPermissionMode('allow-all')
    agent.prerequisiteManager.checkPrerequisites = () => ({ allowed: true })
    let hook: any
    agent.beginPersistentTurn = (_prompt: unknown, options: any) => {
      hook = options.hooks.PreToolUse[0].hooks[0]
      return (async function* () {})()
    }
    for await (const _event of agent.chatImpl('test')) { /* capture hook without provider */ }
    agent.currentQuery = {}
    agent.currentQueryAbortController = { abort: () => {} }
    agent.onSteerDelivered = mock(() => {})
    agent.redirect('Keep this correction', 'correction')
    const invoke = () => hook({ hook_event_name: 'PreToolUse', tool_use_id: 'read-1',
      tool_name: 'Read', tool_input: { file_path: join(root, 'notes.txt') } })
    const blocked = await invoke()
    expect(blocked.decision).toBe('block')
    expect(blocked.reason).toContain('Host denied')
    expect(agent.onSteerDelivered).not.toHaveBeenCalled()
    allowed = true
    const delivered = await invoke()
    expect(delivered.hookSpecificOutput.additionalContext).toContain('Keep this correction')
    expect(agent.onSteerDelivered).toHaveBeenCalledWith(['correction'])
    expect(agent.takePendingSteers()).toEqual([])
  } finally {
    agent.currentQuery = null
    agent.currentQueryAbortController = null
    agent.destroy()
    rmSync(root, { recursive: true, force: true })
  }
})
