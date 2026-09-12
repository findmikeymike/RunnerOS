import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const root = mkdtempSync(join(tmpdir(), 'artist-backend-kind-'))
const previousConfig = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = root
const workspace = { id: 'test', name: 'Test', slug: 'test', rootPath: join(root, 'workspace'), createdAt: 1 }
mkdirSync(workspace.rootPath)
function configure(providerType: 'anthropic' | 'pi') {
  writeFileSync(join(root, 'config.json'), JSON.stringify({
    workspaces: [workspace], activeWorkspaceId: workspace.id,
    defaultLlmConnection: 'same-slug',
    llmConnections: [{ slug: 'same-slug', name: 'Editable connection', providerType,
      authType: 'api_key', createdAt: 1,
      ...(providerType === 'pi' ? { piAuthProvider: 'openai', defaultModel: 'pi/gpt-5.5' } : { defaultModel: 'claude-sonnet-4-6' }),
    }],
  }))
}
configure('anthropic')
const { SessionManager } = await import('./SessionManager.ts')
const { withLlmConnectionMutation } = await import('@craft-agent/shared/config')
function fixture(provider: 'anthropic' | 'pi') {
  let disposed = 0
  const agent = { dispose: () => { disposed++ } }
  const managed = { id: 'session', workspace, agent, isProcessing: false, llmConnection: 'same-slug',
    sdkSessionId: 'provider-specific-resume-id', messages: [{ role: 'user', content: 'Keep my history' }],
    branchFromSdkSessionId: 'parent-resume-id', branchFromSdkTurnId: 'parent-turn',
  }
  const runtime = new SessionManager() as any
  runtime.sessions.set(managed.id, managed)
  runtime.agentProviders.set(agent, provider)
  runtime.persistSession = () => {}
  return { runtime, managed, agent, disposed: () => disposed }
}
afterAll(() => {
  if (previousConfig === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = previousConfig
  rmSync(root, { recursive: true, force: true })
})

for (const [previous, next] of [['anthropic', 'pi'], ['pi', 'anthropic']] as const) {
  test(`same-slug ${previous} to ${next} retires only the idle backend and preserves replay`, async () => {
    configure(previous)
    const f = fixture(previous)
    configure(next)
    await f.runtime.refreshIdleAgentBackend(f.managed)
    expect(f.disposed()).toBe(1)
    expect(f.managed.agent).toBeNull()
    expect(f.managed.sdkSessionId).toBeUndefined()
    expect(f.managed.branchFromSdkSessionId).toBeUndefined()
    expect(f.managed.messages[0]?.content).toBe('Keep my history')
    expect((f.managed as any).branchContextStrategy).toBe('seeded-fresh-session')
    expect((f.managed as any).branchSeedApplied).toBe(false)
    expect((await f.runtime.resolveCurrentBackendContext(f.managed)).provider).toBe(next)
  })
}

test('a running response is never disposed for a changed provider kind', async () => {
  const f = fixture('anthropic')
  f.managed.isProcessing = true
  configure('pi')
  await f.runtime.refreshIdleAgentBackend(f.managed)
  expect(f.managed.agent).toBe(f.agent)
  expect(f.disposed()).toBe(0)
})

test('same-kind edits retain the existing backend', async () => {
  const f = fixture('pi')
  configure('pi')
  await f.runtime.refreshIdleAgentBackend(f.managed)
  expect(f.managed.agent).toBe(f.agent)
  expect(f.disposed()).toBe(0)
})

test('admission waits for setup and resolves the final backend kind', async () => {
  configure('anthropic')
  const f = fixture('anthropic')
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const write = withLlmConnectionMutation('same-slug', async () => {
    await pending
    configure('pi')
  })
  const admission = f.runtime.refreshIdleAgentBackend(f.managed)
  await Promise.resolve()
  expect(f.disposed()).toBe(0)
  release()
  await write
  await admission
  expect(f.disposed()).toBe(1)
  expect((await f.runtime.resolveCurrentBackendContext(f.managed)).provider).toBe('pi')
})
