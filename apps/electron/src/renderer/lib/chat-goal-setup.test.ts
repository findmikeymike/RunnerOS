import { describe, expect, it } from 'bun:test'
import { rememberChatGoalSetup, takePendingChatGoalSetup } from './chat-goal-setup'

describe('pending chat Goal setup', () => {
  it('buffers a proposal until the matching session UI mounts', () => {
    rememberChatGoalSetup({
      sessionId: 'session-1',
      proposal: { objective: 'Finish the plan', maxRounds: 4 },
      confirmationNonce: 'nonce-1',
    })

    expect(takePendingChatGoalSetup('session-2')).toBeUndefined()
    expect(takePendingChatGoalSetup('session-1')).toEqual({
      sessionId: 'session-1',
      proposal: { objective: 'Finish the plan', maxRounds: 4 },
      confirmationNonce: 'nonce-1',
    })
    expect(takePendingChatGoalSetup('session-1')).toBeUndefined()
  })
})
