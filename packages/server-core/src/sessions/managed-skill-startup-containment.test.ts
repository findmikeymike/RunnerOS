import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runManagedSkillStartupMigration } from '../../../shared/src/skills/startup-migration'
import { setManagedSkillMigrationDeferred } from '../../../shared/src/skills/migration'

const source = readFileSync(new URL('./SessionManager.ts', import.meta.url), 'utf8')

test('actual startup prelude contains corrupt skill data and defers dependent rewrites', () => {
  const root = mkdtempSync(join(tmpdir(), 'skill-init-containment-'))
  const workspace = join(root, 'workspace')
  const session = join(workspace, 'sessions', 'bad', 'session.jsonl')
  mkdirSync(join(workspace, 'sessions', 'bad'), { recursive: true })
  writeFileSync(session, 'not a session header\nuntouched user content')
  const start = source.indexOf('      let managedSkillMigrationReady = true')
  const end = source.indexOf('      // Seed the global agent-definitions library', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const run = new Function('runManagedSkillStartupMigration', 'resolveRuntimeIdentity', 'getWorkspaces', 'sessionLog',
    source.slice(start, end).replace(': string | undefined', '') + '\nreturn { ready: managedSkillMigrationReady, message: managedSkillRecoveryMessage }')
  const warnings: unknown[] = []
  try {
    const result = run(() => runManagedSkillStartupMigration({
      workspaceRoots: [workspace], globalSkillsDir: join(root, 'skills'), agentsDir: join(root, 'agents'), runtimeVariant: 'artist-os',
    }), () => ({ variant: 'artist-os' }), () => [{ rootPath: workspace }], { warn: (...args: unknown[]) => warnings.push(args) })
    expect(result.ready).toBe(false)
    expect(result.message).toContain('Existing customizations were retained')
    expect(warnings).toHaveLength(1)
    expect(readFileSync(session, 'utf8')).toBe('not a session header\nuntouched user content')
    // Both migration families and default activation must share the prelude's
    // result. Auth, session restoration and normal work stay outside this guard.
    for (const operation of ['seedGlobalLibraryIfEmpty,', 'seedGlobalWorkflowLibraryIfEmpty,', 'ensureDefaultWorkflowActivations,']) {
      expect(source).toContain(`if (managedSkillMigrationReady) try {\n        const {\n          ${operation}`)
    }
    expect(source).toContain('await this.reinitializeAuth()')
    expect(source).toContain('await this.loadSessionsFromDisk()')
    expect(source).toContain('this.initGate.markReady()')
  } finally {
    setManagedSkillMigrationDeferred(false)
    rmSync(root, { recursive: true, force: true })
  }
})
