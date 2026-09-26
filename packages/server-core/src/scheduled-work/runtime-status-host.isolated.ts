import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Import-time config resolution must point at a disposable profile. Run this
// file in its own process; no real profile, scheduler, or SessionManager constructor.
const root = mkdtempSync(join(tmpdir(), 'scheduled-runtime-host-'))
const originalConfigDir = process.env.CRAFT_CONFIG_DIR
process.env.CRAFT_CONFIG_DIR = root
const workspace = { id: 'runtime-local', slug: 'runtime-local', name: 'Runtime local', rootPath: join(root, 'workspace'), createdAt: 1 }
const remote = { ...workspace, id: 'runtime-remote', slug: 'runtime-remote', remoteServer: { url: 'https://example.invalid' } }
mkdirSync(workspace.rootPath)
writeFileSync(join(root, 'config.json'), JSON.stringify({ workspaces: [workspace, remote], activeWorkspaceId: workspace.id, activeSessionId: null }))
writeFileSync(join(workspace.rootPath, 'config.json'), JSON.stringify({ ...workspace, updatedAt: 1, storage: { mode: 'solo' } }))

const { SessionManager } = await import('../sessions/SessionManager.ts')
const { registerScheduledWorkHandlers } = await import('../handlers/rpc/scheduled-work.ts')
const { RPC_CHANNELS } = await import('@craft-agent/shared/protocol')

afterAll(() => {
  if (originalConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR
  else process.env.CRAFT_CONFIG_DIR = originalConfigDir
  rmSync(root, { recursive: true, force: true })
})

function fakeHost(schedulerRunning?: boolean) {
  const paid = mock(() => true)
  const createRunner = mock(() => { throw new Error('Status must not create a runner') })
  const systems = new Map(schedulerRunning === undefined ? [] : [[workspace.rootPath, { isSchedulerRunning: () => schedulerRunning }]])
  const host = { automationSystems: systems, isPaidExecutionAuthorized: paid, getScheduledWorkRunner: createRunner }
  const read = (id: string) => SessionManager.prototype.getScheduledWorkRuntimeStatus.call(host as unknown as InstanceType<typeof SessionManager>, id)
  return { read, host, paid, createRunner }
}

function workspaceSnapshot() {
  return readdirSync(workspace.rootPath, { recursive: true }).map(String).sort().map(name => [name, readFileSync(join(workspace.rootPath, name), 'utf8')])
}

describe('scheduled runtime host read path', () => {
  test('missing workspace reports unavailable without consulting execution or creating scheduler', () => {
    const f = fakeHost()
    expect(f.read('missing').state).toBe('unavailable')
    expect(f.paid).not.toHaveBeenCalled()
    expect(f.createRunner).not.toHaveBeenCalled()
  })

  test('remote lookup does not consult local execution, scheduler map, or local team configuration', () => {
    // A broken local workspace must not affect a remote host status response.
    const configFile = join(workspace.rootPath, 'config.json')
    const original = readFileSync(configFile, 'utf8')
    writeFileSync(configFile, '{broken')
    try {
      const f = fakeHost()
      Object.defineProperty(f.host, 'automationSystems', { get: () => { throw new Error('Local map was consulted') } })
      expect(f.read(remote.id).state).toBe('remote-host')
      expect(f.paid).not.toHaveBeenCalled()
      expect(f.createRunner).not.toHaveBeenCalled()
    } finally { writeFileSync(configFile, original) }
  })

  test('absent and stopped schedulers report stopped without creating one or writing workspace files', () => {
    for (const running of [undefined, false]) {
      const before = workspaceSnapshot()
      const f = fakeHost(running)
      const result = f.read(workspace.id)
      expect(result.state).toBe('scheduler-stopped')
      expect(result.workspaceId).toBe(workspace.id)
      expect(Number.isFinite(Date.parse(result.checkedAt))).toBe(true)
      expect(f.createRunner).not.toHaveBeenCalled()
      expect(workspaceSnapshot()).toEqual(before)
      expect(f.host.automationSystems.size).toBe(running === undefined ? 0 : 1)
    }
  })

  test('running scheduler reports ready; unreadable workspace configuration reports unavailable', () => {
    const f = fakeHost(true)
    expect(f.read(workspace.id).state).toBe('ready')
    const configFile = join(workspace.rootPath, 'config.json')
    const original = readFileSync(configFile, 'utf8')
    writeFileSync(configFile, '{broken')
    try { expect(f.read(workspace.id).state).toBe('unavailable') }
    finally { writeFileSync(configFile, original) }
    expect(f.createRunner).not.toHaveBeenCalled()
  })

  test('actual status RPC forwards the workspace and returns host evidence without running work', async () => {
    const f = fakeHost(false)
    const read = mock((id: string) => f.read(id))
    const push = mock(() => { throw new Error('Status must not broadcast changes') })
    const handlers = new Map<string, (...args: any[]) => any>()
    registerScheduledWorkHandlers({ handle: (channel: string, fn: (...args: any[]) => any) => handlers.set(channel, fn) } as never,
      { sessionManager: { getScheduledWorkRuntimeStatus: read }, wsServer: { push } } as never)
    const before = workspaceSnapshot()
    const result = await handlers.get(RPC_CHANNELS.scheduledWork.GET_RUNTIME_STATUS)!({}, workspace.id)
    expect(read).toHaveBeenCalledWith(workspace.id)
    expect(result.state).toBe('scheduler-stopped')
    expect(result.workspaceId).toBe(workspace.id)
    expect(f.createRunner).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
    expect(workspaceSnapshot()).toEqual(before)
  })
})
