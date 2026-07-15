import { describe, expect, test } from 'bun:test'

import { createHeadlessPlatform } from '../runtime/platform-headless.ts'
import { SessionManager, setSessionPlatform } from './SessionManager.ts'

setSessionPlatform(createHeadlessPlatform({ appVersion: 'one-shot-test' }))

function harness(query: () => Promise<any>) {
  const manager = new SessionManager() as any
  const deleted: string[] = []
  let createOptions: any
  manager.createSession = async (_workspaceId: string, options: any) => {
    createOptions = options
    manager.sessions.set('carrier-session', {})
    return { id: 'carrier-session' }
  }
  manager.getOrCreateAgent = async () => ({ queryLlm: query })
  manager.deleteSession = async (id: string) => { deleted.push(id); manager.sessions.delete(id) }
  return { manager: manager as SessionManager, deleted, getCreateOptions: () => createOptions }
}

describe('SessionManager.runOneShotLlmQuery', () => {
  test('uses a hidden tool-free carrier and always deletes it after success', async () => {
    const { manager, deleted, getCreateOptions } = harness(async () => ({ text: '{}' }))
    expect(await manager.runOneShotLlmQuery('workspace', { prompt: 'test' })).toEqual({ text: '{}' })
    expect(getCreateOptions()).toMatchObject({ hidden: true, permissionMode: 'safe', enabledSourceSlugs: [], workingDirectory: 'none' })
    expect(deleted).toEqual(['carrier-session'])
  })

  test('deletes its hidden carrier after provider failure', async () => {
    const { manager, deleted } = harness(async () => { throw new Error('provider failed') })
    await expect(manager.runOneShotLlmQuery('workspace', { prompt: 'test' })).rejects.toThrow('provider failed')
    expect(deleted).toEqual(['carrier-session'])
  })
})
