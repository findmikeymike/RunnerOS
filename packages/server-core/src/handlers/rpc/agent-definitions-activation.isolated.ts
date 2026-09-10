import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'

// Capture real filesystem operations before replacing only their default library
// location. No production profile is read or written by this fixture.
const definitions = { ...await import('@craft-agent/shared/agent-definitions') }
const root = mkdtempSync(join(tmpdir(), 'agent-registration-rpc-'))
const globalAgentsDir = join(root, 'library')
const options = { globalAgentsDir }
const workspaces = [
  { id: 'campaign', rootPath: join(root, 'campaign'), artistWorkspaceScope: 'campaign' as const },
  { id: 'lab', rootPath: join(root, 'lab'), artistWorkspaceScope: 'lab' as const },
]
function scopedWorkspace(path: string): string {
  if (!workspaces.some(workspace => workspace.rootPath === path)) throw new Error('Unscoped fixture workspace')
  return path
}
mock.module('@craft-agent/shared/config', () => ({
  getWorkspaceByNameOrId: (id: string) => workspaces.find(workspace => workspace.id === id) ?? null,
  getWorkspaces: () => workspaces,
}))
mock.module('@craft-agent/shared/workspaces', () => ({
  assertTeamPermission: (path: string) => { scopedWorkspace(path) },
}))
mock.module('@craft-agent/shared/agent-definitions', () => ({
  ...definitions,
  loadAllGlobalAgents: () => definitions.loadAllGlobalAgents(options),
  loadGlobalAgent: (slug: string) => definitions.loadGlobalAgent(slug, options),
  loadActivatedAgents: (path: string) => definitions.loadActivatedAgents(scopedWorkspace(path), options),
  readActivatedAgents: (path: string) => definitions.readActivatedAgents(scopedWorkspace(path)),
  setAgentActive: (path: string, slug: string, active: boolean) => definitions.setAgentActive(scopedWorkspace(path), slug, active),
  writeActivatedAgents: (path: string, slugs: string[]) => definitions.writeActivatedAgents(scopedWorkspace(path), slugs),
  writeGlobalAgent: (input: Parameters<typeof definitions.writeGlobalAgent>[0]) => definitions.writeGlobalAgent(input, options),
  deleteGlobalAgent: (slug: string, paths: string[]) => definitions.deleteGlobalAgent(slug, paths.map(scopedWorkspace), options),
}))
const { registerAgentDefinitionsHandlers } = await import('./agent-definitions')
const handlers = new Map<string, (...args: any[]) => any>()
registerAgentDefinitionsHandlers({ handle: (channel: string, handler: any) => handlers.set(channel, handler) } as any, {
  platform: { logger: { warn: () => {} } },
} as any)
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
const channels = RPC_CHANNELS.agentDefinitions
beforeEach(() => {
  rmSync(root, { recursive: true, force: true })
  for (const workspace of workspaces) mkdirSync(workspace.rootPath, { recursive: true })
  for (const slug of ['content-director', 'ads-strategist', 'record-doctor']) {
    definitions.writeGlobalAgent({ slug, metadata: { name: slug, description: 'Fixture agent' }, systemPrompt: 'Fixture prompt' }, options)
  }
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('registered agent activation RPC lifecycle', () => {
  it('keeps an available content director inactive until explicitly activated, and preserves deactivation on reload', async () => {
    expect((await call(channels.LIST_ALL)).map((agent: { slug: string }) => agent.slug)).toContain('content-director')
    expect(await call(channels.LIST_ACTIVE_IN_WORKSPACE, 'campaign')).toEqual([])
    expect(await call(channels.SET_ACTIVE, 'campaign', 'content-director', true)).toEqual({ active: ['content-director'] })
    expect(await call(channels.LIST_ACTIVE_IN_WORKSPACE, 'campaign')).toEqual(['content-director'])
    expect(await call(channels.SET_ACTIVE, 'campaign', 'content-director', false)).toEqual({ active: [] })
    expect(definitions.readActivatedAgents(workspaces[0]!.rootPath).deactivated).toEqual(['content-director'])
    expect(await call(channels.LIST_ACTIVE_IN_WORKSPACE, 'campaign')).toEqual([])
  })

  it('filters a polluted Lab manifest and refuses activation outside its roster', async () => {
    definitions.writeActivatedAgents(workspaces[1]!.rootPath, ['ads-strategist', 'record-doctor'])
    expect(await call(channels.LIST_ACTIVE_IN_WORKSPACE, 'lab')).toEqual(['record-doctor'])
    await expect(call(channels.SET_ACTIVE, 'lab', 'ads-strategist', true)).rejects.toThrow('not available')
    expect(await call(channels.SET_ACTIVE, 'lab', 'record-doctor', true)).toEqual({ active: ['record-doctor'] })
    // Reading eligibility does not silently rewrite saved choices.
    expect(definitions.readActivatedAgents(workspaces[1]!.rootPath).active).toEqual(['ads-strategist', 'record-doctor'])
  })

  it('rejects missing and unreadable definitions without persisting activation', async () => {
    mkdirSync(join(globalAgentsDir, 'corrupt-agent'))
    writeFileSync(join(globalAgentsDir, 'corrupt-agent', 'AGENT.md'), 'unreadable definition')
    for (const slug of ['missing-agent', 'corrupt-agent']) {
      await expect(call(channels.SET_ACTIVE, 'campaign', slug, true)).rejects.toThrow('Agent not found')
    }
    expect(await call(channels.LIST_ACTIVE_IN_WORKSPACE, 'campaign')).toEqual([])
    expect(definitions.readActivatedAgents(workspaces[0]!.rootPath).active).toEqual([])
  })
})
