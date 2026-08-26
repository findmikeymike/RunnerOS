import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeSyncHarness } from '@craft-agent/shared/records'
import { joinWorkspaceTeam, markWorkspaceAsSharedFolder } from '@craft-agent/shared/workspaces'
import type { WorkspaceConfig } from '@craft-agent/shared/workspaces'
import { assertAgentAutomationCreationAllowed } from './SessionManager.ts'

const roots: string[] = []
afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('agent create_automation Team permissions', () => {
  it('blocks an Editor from creating runner-executed webhook automation', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-automation-permission-'))
    roots.push(root)
    const sync = createFakeSyncHarness(join(root, 'sync'))
    const config: WorkspaceConfig = {
      id: 'workspace-1', name: 'Team', slug: 'team', createdAt: Date.now(), updatedAt: Date.now(),
    }
    writeFileSync(join(sync.machineA, 'config.json'), JSON.stringify(config), 'utf-8')
    process.env.CRAFT_CONFIG_DIR = join(root, 'private-a')
    markWorkspaceAsSharedFolder(sync.machineA, { makeRunner: true })
    sync.syncAtoB()
    process.env.CRAFT_CONFIG_DIR = join(root, 'private-b')
    joinWorkspaceTeam(sync.machineB)

    expect(() => assertAgentAutomationCreationAllowed({
      currentWorkspaceId: 'workspace-1',
      targetWorkspaceId: 'workspace-1',
      targetWorkspaceRootPath: sync.machineB,
      matcher: { actions: [{ type: 'webhook', url: 'https://example.com/hook' }] },
    })).toThrow('owner-required')
  })

  it('blocks cross-workspace automation targeting before permission evaluation', () => {
    expect(() => assertAgentAutomationCreationAllowed({
      currentWorkspaceId: 'workspace-1', targetWorkspaceId: 'workspace-2', targetWorkspaceRootPath: '/missing',
      matcher: { actions: [] },
    })).toThrow('scoped to the current session workspace')
  })
})
