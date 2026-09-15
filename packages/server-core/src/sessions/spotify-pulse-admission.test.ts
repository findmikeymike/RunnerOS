import { expect, test } from 'bun:test'
import { SessionManager } from './SessionManager'

const input = { workspaceId: 'pulse-test', workspaceRootPath: '/tmp/pulse-admission-test', prompt: 'refresh', agentSlug: 'spotify-analyst', taskModeId: 'fresh-snapshot' }

test('simultaneous Pulse starts admit only one session and release after completion', async () => {
  const manager = new SessionManager()
  const host = manager as any
  let finish!: () => void
  let calls = 0
  host.executePromptAutomationAdmitted = async () => {
    calls++
    await new Promise<void>(resolve => { finish = resolve })
    return { sessionId: 'one' }
  }
  const first = manager.executePromptAutomation(input)
  await expect(manager.executePromptAutomation(input)).rejects.toThrow('already running')
  expect(calls).toBe(1)
  finish()
  await first
  host.executePromptAutomationAdmitted = async () => ({ sessionId: 'two' })
  expect(await manager.executePromptAutomation(input)).toEqual({ sessionId: 'two' })
})

test('a failed Pulse launch releases admission for retry', async () => {
  const manager = new SessionManager()
  const host = manager as any
  host.executePromptAutomationAdmitted = async () => { throw new Error('launch failed') }
  await expect(manager.executePromptAutomation(input)).rejects.toThrow('launch failed')
  host.executePromptAutomationAdmitted = async () => ({ sessionId: 'retry' })
  expect(await manager.executePromptAutomation(input)).toEqual({ sessionId: 'retry' })
})

test('a draining Spotify session blocks a replacement even after its automation returned', async () => {
  const manager = new SessionManager()
  const host = manager as any
  host.sessions.set('draining', { workspace: { id: input.workspaceId }, spawnedFromAgent: { agentSlug: 'spotify-analyst' }, isProcessing: true })
  host.executePromptAutomationAdmitted = async () => { throw new Error('should not launch') }
  await expect(manager.executePromptAutomation(input)).rejects.toThrow('already running')
})
