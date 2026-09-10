import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ts from 'typescript'
import { ensureRequiredAgents, readActivatedAgents, setAgentActive, writeActivatedAgents, writeGlobalAgent, STARTER_AGENTS, type AgentStorageOptions } from '@craft-agent/shared/agent-definitions'
import { REQUIRED_BUILTIN_AGENT_SLUGS } from '@craft-agent/shared/agent-definitions/registration'
import { loadActiveAgentsForWorkspace, shouldBackfillLegacyAgentActivation } from './agent-registration'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'registration-lifecycle-'))
  roots.push(root)
  const options: AgentStorageOptions = { globalAgentsDir: join(root, 'library') }
  const workspace = { rootPath: join(root, 'workspace'), artistWorkspaceScope: 'campaign' as const }
  const recover = () => ensureRequiredAgents(STARTER_AGENTS.filter(a => REQUIRED_BUILTIN_AGENT_SLUGS.includes(a.slug)), options)
  recover()
  return { workspace, options, recover }
}

describe('workspace registration lifecycle', () => {
  test('a visible built-in becomes routable only after explicit activation', () => {
    const f = fixture()
    expect(loadActiveAgentsForWorkspace(f.workspace, f.options)).toEqual([])
    setAgentActive(f.workspace.rootPath, 'content-director', true)
    expect(loadActiveAgentsForWorkspace(f.workspace, f.options).map(a => a.slug)).toEqual(['content-director'])
    setAgentActive(f.workspace.rootPath, 'content-director', false)
    f.recover()
    expect(loadActiveAgentsForWorkspace(f.workspace, f.options)).toEqual([])
    expect(readActivatedAgents(f.workspace.rootPath).deactivated).toContain('content-director')
  })

  test('upgraded Lab routing excludes unrelated saved built-ins without rewriting the manifest', () => {
    const f = fixture()
    writeGlobalAgent({ ...STARTER_AGENTS.find(agent => agent.slug === 'writer')!, slug: 'my-writer' }, f.options)
    writeActivatedAgents(f.workspace.rootPath, ['ads-strategist', 'record-doctor', 'my-writer', 'missing-definition'])
    const before = readActivatedAgents(f.workspace.rootPath)
    expect(loadActiveAgentsForWorkspace({ ...f.workspace, artistWorkspaceScope: 'lab' }, f.options).map(a => a.slug)).toEqual(['record-doctor', 'my-writer'])
    expect(readActivatedAgents(f.workspace.rootPath)).toEqual(before)
  })

  test('default backfills run only in legacy Runner, never Artist OS', () => {
    expect(shouldBackfillLegacyAgentActivation('artist-os')).toBe(false)
    expect(shouldBackfillLegacyAgentActivation('runner')).toBe(true)
  })
})

// This architecture gate scans the real startup method. Persisted-off tests alone
// cannot catch a new bespoke loop that explicitly calls setAgentActive(true).
test('every startup activation or skill backfill is fenced off from Artist OS', () => {
  const path = join(import.meta.dir, 'SessionManager.ts')
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const writes = new Set(['setAgentActive', 'setGlobalSkillEnabled', 'migrateOrPreserveInitialArtistAgentActivation', 'migrateInitialReleaseManagerActivation', 'preserveReleaseManagerActivationChoices'])
  let checked = 0
  const unguarded: string[] = []
  function isGuarded(node: ts.Node): boolean {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isIfStatement(parent) && node.pos >= parent.thenStatement.pos && node.end <= parent.thenStatement.end
        && /^allowLegacyAgentActivation(?:\s*&&|$)/.test(parent.expression.getText(source))) return true
      if (ts.isForOfStatement(parent) && ts.isConditionalExpression(parent.expression)
        && parent.expression.condition.getText(source) === 'allowLegacyAgentActivation'
        && parent.expression.whenFalse.getText(source) === '[]') return true
    }
    return false
  }
  function inspect(node: ts.Node) {
    if (ts.isCallExpression(node) && writes.has(node.expression.getText(source))) {
      checked++
      if (!isGuarded(node)) unguarded.push(`${node.expression.getText(source)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
    }
    ts.forEachChild(node, inspect)
  }
  function find(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'initialize') inspect(node)
    else ts.forEachChild(node, find)
  }
  find(source)
  expect(checked).toBeGreaterThan(10)
  expect(unguarded).toEqual([])
})
