import { expect, test } from 'bun:test'
import { markVoiceManagedSession, isVoiceManagedSession } from './voice-managed-sessions'
test('voice ownership survives asynchronous retry scheduling and does not affect chat', async () => {
  const id = 'voice-' + crypto.randomUUID()
  markVoiceManagedSession(id)
  await new Promise(resolve => setTimeout(resolve, 1))
  expect(isVoiceManagedSession(id)).toBe(true)
  expect(isVoiceManagedSession('ordinary-chat')).toBe(false)
})
