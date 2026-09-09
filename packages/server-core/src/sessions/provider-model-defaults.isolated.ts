import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Run separately: config paths are captured at import time. No module mocks or
// provider calls; exercise the real session method against an isolated profile.
const root = mkdtempSync(join(tmpdir(), 'artist-provider-defaults-'))
const originalConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = root
const workspace = { id: 'defaults-test', slug: 'defaults-test', name: 'Defaults test', rootPath: join(root, 'workspace'), createdAt: 1 }
mkdirSync(workspace.rootPath)
const connection = {
  slug: 'openai-test', name: 'OpenAI test', providerType: 'pi', authType: 'api_key',
  piAuthProvider: 'openai', models: ['pi/gpt-5.5', 'pi/gpt-5.4'], defaultModel: 'pi/gpt-5.5', createdAt: 1,
}
writeFileSync(join(root, 'config.json'), JSON.stringify({
  workspaces: [workspace], activeWorkspaceId: workspace.id, activeSessionId: null,
  llmConnections: [connection], defaultLlmConnection: connection.slug,
}))

const { SessionManager, createManagedSession } = await import('./SessionManager.ts')
const { createSession, loadSession } = await import('@craft-agent/shared/sessions')

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = originalConfigDir
  rmSync(root, { recursive: true, force: true })
})

async function changeModel(workspaceModel: string, requestedModel: string | null) {
  writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({
    ...workspace, slug: 'defaults-test', updatedAt: 1, defaults: { model: workspaceModel },
  }))
  const stored = await createSession(workspace.rootPath, {
    name: 'Existing conversation', model: 'pi/gpt-5.4', llmConnection: connection.slug,
  })
  const managed = createManagedSession(stored, workspace, { messagesLoaded: true })
  managed.connectionLocked = true
  const forwarded: string[] = []
  managed.agent = { setModel: (model: string) => forwarded.push(model) } as unknown as NonNullable<typeof managed.agent>
  const manager = new SessionManager()
  const runtime = manager as unknown as {
    sessions: Map<string, typeof managed>
    sendEvent: (event: unknown) => void
  }
  runtime.sessions.set(managed.id, managed)
  runtime.sendEvent = () => {}
  await manager.updateSessionModel(managed.id, workspace.id, requestedModel)
  return { forwarded, managed, persisted: loadSession(workspace.rootPath, managed.id) }
}

describe('live backend model defaults respect the pinned provider', () => {
  it('clearing an override rejects an incompatible workspace model', async () => {
    const result = await changeModel('claude-sonnet-4-6', null)
    expect(result.forwarded).toEqual(['pi/gpt-5.5'])
    expect(result.managed.model).toBeUndefined()
    expect(result.persisted?.model).toBeUndefined()
    expect(result.persisted?.llmConnection).toBe(connection.slug)
  })

  it('an incompatible explicit override cannot reintroduce the incompatible workspace model', async () => {
    const result = await changeModel('claude-sonnet-4-6', 'claude-opus-4-6')
    expect(result.forwarded).toEqual(['pi/gpt-5.5'])
    expect(result.managed.model).toBeUndefined()
    expect(result.persisted?.model).toBeUndefined()
  })

  it('a valid explicit override wins over the workspace default', async () => {
    const result = await changeModel('pi/gpt-5.5', 'pi/gpt-5.4')
    expect(result.forwarded).toEqual(['pi/gpt-5.4'])
    expect(result.managed.model).toBe('pi/gpt-5.4')
    expect(result.persisted?.model).toBe('pi/gpt-5.4')
  })

  it('clearing an override preserves a compatible workspace default over the connection default', async () => {
    const result = await changeModel('pi/gpt-5.4', null)
    expect(result.forwarded).toEqual(['pi/gpt-5.4'])
    expect(result.managed.model).toBeUndefined()
    expect(result.persisted?.model).toBeUndefined()
  })
})
