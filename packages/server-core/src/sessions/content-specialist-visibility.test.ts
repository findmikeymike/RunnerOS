import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readActivatedAgents, setAgentActive, writeActivatedAgents, writeGlobalAgent, STARTER_AGENTS, type AgentStorageOptions } from '@craft-agent/shared/agent-definitions'
import { loadActiveAgentsForWorkspace } from './agent-registration'
import { enableWorkspaceContentCompanions, groupWorkspaceContentSpecialists, loadVisibleAgentSlugs } from './content-specialist-visibility'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture(scope: 'hq' | 'campaign' | 'lab' | 'general' = 'hq') {
  const root = mkdtempSync(join(tmpdir(), 'content-visibility-'))
  roots.push(root)
  const options: AgentStorageOptions = { globalAgentsDir: join(root, 'library') }
  const workspace = { rootPath: join(root, 'workspace'), artistWorkspaceScope: scope }
  for (const slug of ['content-genius', 'scroll-stopper', 'anticipation-director', 'scriptwriter']) {
    writeGlobalAgent(STARTER_AGENTS.find(agent => agent.slug === slug)!, options)
  }
  return { workspace, options }
}

test.each(['hq', 'campaign'] as const)('%s groups specialists while runtime and saved schedule activation remain intact', scope => {
  const f = fixture(scope)
  writeActivatedAgents(f.workspace.rootPath, ['scroll-stopper', 'anticipation-director', 'scriptwriter'])
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  expect(loadVisibleAgentSlugs(f.workspace, f.options)).toEqual(['scriptwriter', 'content-genius'])
  expect(loadActiveAgentsForWorkspace(f.workspace, f.options).map(agent => agent.slug)).toContain('scroll-stopper')
  expect(readActivatedAgents(f.workspace.rootPath).active).toContain('anticipation-director')
  expect(readActivatedAgents(f.workspace.rootPath).deactivated).toBeUndefined()
})

test('manual Add reveals permanently; disabling removes runtime permission and stays disabled', () => {
  const f = fixture()
  writeActivatedAgents(f.workspace.rootPath, ['content-genius'])
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  setAgentActive(f.workspace.rootPath, 'scroll-stopper', true)
  setAgentActive(f.workspace.rootPath, 'anticipation-director', false)
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  expect(loadVisibleAgentSlugs(f.workspace, f.options)).toContain('scroll-stopper')
  expect(readActivatedAgents(f.workspace.rootPath).active).not.toContain('anticipation-director')
  expect(readActivatedAgents(f.workspace.rootPath).deactivated).toContain('anticipation-director')
})

test('bulk activation and unrelated toggles preserve hidden companions and migration marker', () => {
  const f = fixture()
  writeActivatedAgents(f.workspace.rootPath, ['content-genius'])
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  const before = readActivatedAgents(f.workspace.rootPath)
  writeActivatedAgents(f.workspace.rootPath, [...before.active, 'scriptwriter'])
  setAgentActive(f.workspace.rootPath, 'my-custom-agent', true)
  const after = readActivatedAgents(f.workspace.rootPath)
  expect(after.libraryOnly).toEqual(before.libraryOnly)
  expect(after.contentSpecialistsGrouped).toBe(true)
})

test('explicit disabled choices, missing definitions, and custom specialist bodies are preserved', () => {
  const f = fixture()
  writeActivatedAgents(f.workspace.rootPath, ['content-genius', 'scroll-stopper'])
  setAgentActive(f.workspace.rootPath, 'anticipation-director', false)
  writeGlobalAgent({ ...STARTER_AGENTS.find(agent => agent.slug === 'scroll-stopper')!, systemPrompt: 'My custom worker' }, f.options)
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  expect(loadVisibleAgentSlugs(f.workspace, f.options)).toContain('scroll-stopper')
  expect(readActivatedAgents(f.workspace.rootPath).active).not.toContain('anticipation-director')
  const missing = fixture()
  rmSync(join(missing.options.globalAgentsDir!, 'scroll-stopper'), { recursive: true })
  writeActivatedAgents(missing.workspace.rootPath, ['content-genius'])
  groupWorkspaceContentSpecialists(missing.workspace, missing.options)
  expect(readActivatedAgents(missing.workspace.rootPath).active).not.toContain('scroll-stopper')
})

test('disabled Content Genius does not replace existing specialist cards', () => {
  const f = fixture()
  writeActivatedAgents(f.workspace.rootPath, ['scroll-stopper'])
  setAgentActive(f.workspace.rootPath, 'content-genius', false)
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  expect(loadVisibleAgentSlugs(f.workspace, f.options)).toEqual(['scroll-stopper'])
})

test.each(['lab', 'general'] as const)('%s manifests are unchanged', scope => {
  const f = fixture(scope)
  writeActivatedAgents(f.workspace.rootPath, ['content-genius', 'scroll-stopper'])
  const before = readActivatedAgents(f.workspace.rootPath)
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  expect(readActivatedAgents(f.workspace.rootPath)).toEqual(before)
})


test('later Content Genius Add enables only missing companions and never hides an individually added one', () => {
  const f = fixture()
  groupWorkspaceContentSpecialists(f.workspace, f.options)
  setAgentActive(f.workspace.rootPath, 'scroll-stopper', true)
  setAgentActive(f.workspace.rootPath, 'content-genius', true)
  enableWorkspaceContentCompanions(f.workspace, f.options)
  expect(loadVisibleAgentSlugs(f.workspace, f.options)).toEqual(['scroll-stopper', 'content-genius'])
  expect(readActivatedAgents(f.workspace.rootPath).libraryOnly).toEqual(['anticipation-director'])
  setAgentActive(f.workspace.rootPath, 'anticipation-director', false)
  enableWorkspaceContentCompanions(f.workspace, f.options)
  expect(readActivatedAgents(f.workspace.rootPath).active).not.toContain('anticipation-director')
})
