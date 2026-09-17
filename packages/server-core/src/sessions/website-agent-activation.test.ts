import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deleteGlobalAgent, getGlobalAgentDir, readActivatedAgents, setAgentActive, writeActivatedAgents, writeGlobalAgent, STARTER_AGENTS, type AgentStorageOptions } from '@craft-agent/shared/agent-definitions'
import { getActivatedAgentsManifestPath } from '@craft-agent/shared/workspaces'
import { activateHqWebsiteAgentOnce } from './website-agent-activation'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(scope: 'hq' | 'campaign' | 'lab' = 'hq') {
  const root = mkdtempSync(join(tmpdir(), 'hq-website-'))
  roots.push(root)
  const options: AgentStorageOptions = { globalAgentsDir: join(root, 'library') }
  const workspace = { id: 'workspace', rootPath: join(root, 'workspace'), artistWorkspaceScope: scope }
  writeGlobalAgent({ ...STARTER_AGENTS.find(agent => agent.slug === 'website-agent')!, systemPrompt: 'Preserve my customized website worker.' }, options)
  writeActivatedAgents(workspace.rootPath, ['site-builder', 'content-genius'])
  return { root, options, workspace, run: () => activateHqWebsiteAgentOnce([workspace], options) }
}

test('existing HQ gets one activation, preserves customized definition and creates exact manifest backup', () => {
  const f = fixture()
  const manifestPath = getActivatedAgentsManifestPath(f.workspace.rootPath)
  const before = readFileSync(manifestPath, 'utf8')
  const definitionPath = join(getGlobalAgentDir('website-agent', f.options), 'AGENT.md')
  const definition = readFileSync(definitionPath, 'utf8')
  expect(f.run().updatedWorkspaceIds).toEqual(['workspace'])
  expect(readActivatedAgents(f.workspace.rootPath).active).toEqual(['site-builder', 'content-genius', 'website-agent'])
  expect(readFileSync(`${manifestPath}.before-hq-website-agent`, 'utf8')).toBe(before)
  expect(readFileSync(definitionPath, 'utf8')).toBe(definition)
  setAgentActive(f.workspace.rootPath, 'website-agent', false)
  expect(f.run().updatedWorkspaceIds).toEqual([])
  expect(readActivatedAgents(f.workspace.rootPath).active).not.toContain('website-agent')
})

test('explicit disable remains disabled before first migration', () => {
  const f = fixture()
  setAgentActive(f.workspace.rootPath, 'website-agent', false)
  const before = readActivatedAgents(f.workspace.rootPath)
  expect(f.run().updatedWorkspaceIds).toEqual([])
  expect(readActivatedAgents(f.workspace.rootPath)).toEqual(before)
})

test.each(['campaign', 'lab'] as const)('%s activation choices remain byte-for-byte intact', scope => {
  const f = fixture(scope)
  setAgentActive(f.workspace.rootPath, 'website-agent', true)
  const path = getActivatedAgentsManifestPath(f.workspace.rootPath)
  const before = readFileSync(path, 'utf8')
  expect(f.run().updatedWorkspaceIds).toEqual([])
  expect(readFileSync(path, 'utf8')).toBe(before)
})

test('remote HQ is untouched', () => {
  const f = fixture()
  expect(activateHqWebsiteAgentOnce([{ ...f.workspace, remoteServer: { url: 'remote' } }], f.options).updatedWorkspaceIds).toEqual([])
  expect(readActivatedAgents(f.workspace.rootPath).active).not.toContain('website-agent')
})

test.each(['missing', 'deleted'] as const)('%s definitions are not resurrected or latently activated', mode => {
  const f = fixture()
  if (mode === 'deleted') deleteGlobalAgent('website-agent', [], f.options)
  else rmSync(getGlobalAgentDir('website-agent', f.options), { recursive: true })
  expect(f.run().updatedWorkspaceIds).toEqual([])
  writeGlobalAgent(STARTER_AGENTS.find(agent => agent.slug === 'website-agent')!, f.options)
  f.run()
  expect(readActivatedAgents(f.workspace.rootPath).active).not.toContain('website-agent')
})

test('malformed manifest is preserved and retry succeeds only after repair', () => {
  const f = fixture()
  const path = getActivatedAgentsManifestPath(f.workspace.rootPath)
  const before = readFileSync(path, 'utf8')
  writeFileSync(path, '{invalid')
  expect(f.run().failedWorkspaceIds).toEqual(['workspace'])
  expect(readFileSync(path, 'utf8')).toBe('{invalid')
  writeFileSync(path, before)
  expect(f.run().updatedWorkspaceIds).toEqual(['workspace'])
})

test('corrupt prior migration marker does not reapply preferences', () => {
  const f = fixture()
  f.run()
  writeActivatedAgents(f.workspace.rootPath, ['site-builder'])
  writeFileSync(join(f.options.globalAgentsDir!, '.migrations', 'hq-website-agent-activation-v1.json'), '{invalid')
  expect(f.run().updatedWorkspaceIds).toEqual([])
  expect(readActivatedAgents(f.workspace.rootPath).active).toEqual(['site-builder'])
})
