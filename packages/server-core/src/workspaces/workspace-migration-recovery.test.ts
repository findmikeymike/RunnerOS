import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadWorkspaceConfig,
  prepareWorkspaceMoveToSharedFolder,
  readTeamMigrationJournal,
  rollbackPreparedWorkspaceMigration,
  updateTeamMigrationJournal,
  validatePreparedWorkspaceMigration,
  type TeamMigrationJournal,
  type WorkspaceConfig,
} from '@craft-agent/shared/workspaces'
import {
  recoverInterruptedWorkspaceMigrations,
  type WorkspaceMigrationRecoveryDeps,
} from './workspace-migration-recovery'

function journal(phase: TeamMigrationJournal['phase']): TeamMigrationJournal {
  return {
    version: 1,
    migrationId: 'mig_test',
    workspaceId: 'ws_test',
    phase,
    sourceRootPath: '/old/workspace',
    destinationParentPath: '/shared',
    finalRootPath: '/shared/workspace',
    provider: 'generic-folder',
    startedAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

function harness(initial: TeamMigrationJournal, currentRoot: string) {
  const calls: string[] = []
  const deps: WorkspaceMigrationRecoveryDeps = {
    listJournals: () => [initial],
    getWorkspace: () => ({ rootPath: currentRoot }),
    updateRoot: (_workspaceId, rootPath) => { calls.push(`root:${rootPath}`) },
    updateJournal: (value, phase, error) => {
      calls.push(`journal:${phase}${error ? `:${error}` : ''}`)
      return { ...value, phase, error }
    },
    rollback: (value) => {
      calls.push('rollback')
      return { ...value, phase: 'rolled-back' }
    },
    writeTombstone: () => { calls.push('tombstone') },
    promotePrivateSessions: () => { calls.push('promote-private-sessions') },
    completeDestination: () => { calls.push('complete-destination') },
    validateDestination: () => ({ ok: true }),
  }
  const log = { info: (_message: string) => {}, error: (_message: string, _error?: unknown) => {} }
  return { calls, deps, log }
}

const tempDirs: string[] = []

afterEach(() => {
  delete process.env.CRAFT_CONFIG_DIR
  for (const root of tempDirs.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'workspace-migration-recovery-'))
  tempDirs.push(root)
  return root
}

function prepareRealInterruptedMigration(): {
  source: string
  result: ReturnType<typeof prepareWorkspaceMoveToSharedFolder>
  journal: TeamMigrationJournal
} {
  const root = makeTempRoot()
  const source = join(root, 'source-workspace')
  const destinationParent = join(root, 'shared')
  const privateRoot = join(root, 'private')
  mkdirSync(source, { recursive: true })
  mkdirSync(destinationParent, { recursive: true })
  mkdirSync(privateRoot, { recursive: true })
  process.env.CRAFT_CONFIG_DIR = privateRoot
  const config: WorkspaceConfig = {
    id: 'ws_real_recovery',
    name: 'Recovery Workspace',
    slug: 'recovery-workspace',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  writeFileSync(join(source, 'config.json'), JSON.stringify(config, null, 2))
  const result = prepareWorkspaceMoveToSharedFolder(source, destinationParent, {
    deferCompletion: true,
    initialPhase: 'runtime-quiesced',
  })
  const loaded = result.journalPath ? readTeamMigrationJournal(result.journalPath) : null
  if (!loaded) throw new Error('expected migration journal')
  const journal = updateTeamMigrationJournal(loaded, 'root-switched')
  return { source, result, journal }
}

function recoverInvalidRealDestination(
  mutate: (prepared: ReturnType<typeof prepareRealInterruptedMigration>) => void,
): { calls: string[]; prepared: ReturnType<typeof prepareRealInterruptedMigration> } {
  const prepared = prepareRealInterruptedMigration()
  mutate(prepared)
  const calls: string[] = []
  const deps: WorkspaceMigrationRecoveryDeps = {
    listJournals: () => [prepared.journal],
    getWorkspace: () => ({ rootPath: prepared.source }),
    updateRoot: () => { calls.push('root-updated') },
    updateJournal: updateTeamMigrationJournal,
    rollback: (value) => {
      calls.push('rolled-back')
      return rollbackPreparedWorkspaceMigration(value)
    },
    validateDestination: validatePreparedWorkspaceMigration,
    writeTombstone: () => { calls.push('tombstoned') },
    promotePrivateSessions: () => { calls.push('private-promoted') },
    completeDestination: () => { calls.push('destination-completed') },
  }
  recoverInterruptedWorkspaceMigrations({ info: () => {}, error: () => {} }, deps)
  return { calls, prepared }
}

describe('interrupted workspace migration recovery', () => {
  test('rolls back before the configured root switch', () => {
    const h = harness(journal('destination-staged'), '/old/workspace')
    recoverInterruptedWorkspaceMigrations(h.log, h.deps)
    expect(h.calls).toEqual(['rollback'])
  })

  test('recovers forward when root update committed before journal update', () => {
    const h = harness(journal('destination-staged'), '/shared/workspace')
    recoverInterruptedWorkspaceMigrations(h.log, h.deps)
    expect(h.calls).toEqual([
      'journal:root-switched',
      'promote-private-sessions',
      'tombstone',
      'journal:source-tombstoned',
      'complete-destination',
      'journal:complete',
    ])
  })

  test('recovers forward after a journaled root switch', () => {
    const h = harness(journal('root-switched'), '/old/workspace')
    recoverInterruptedWorkspaceMigrations(h.log, h.deps)
    expect(h.calls[0]).toBe('root:/shared/workspace')
    expect(h.calls).toContain('tombstone')
    expect(h.calls.at(-1)).toBe('journal:complete')
  })

  test('fails closed as needs-repair when forward completion throws', () => {
    const h = harness(journal('root-switched'), '/shared/workspace')
    h.deps.writeTombstone = () => { throw new Error('disk unavailable') }
    recoverInterruptedWorkspaceMigrations(h.log, h.deps)
    expect(h.calls).toContain('journal:needs-repair:disk unavailable')
    expect(h.calls).not.toContain('complete-destination')
  })

  test('missing destination config rolls back without changing registry or tombstoning source', () => {
    const { calls, prepared } = recoverInvalidRealDestination(({ result }) => {
      rmSync(join(result.finalRootPath, 'config.json'))
    })
    expect(calls).toEqual(['rolled-back'])
    expect(loadWorkspaceConfig(prepared.source)?.movedTo).toBeUndefined()
    expect(readTeamMigrationJournal(prepared.result.journalPath!)?.phase).toBe('rolled-back')
  })

  test('corrupt destination receipt rolls back without changing registry or tombstoning source', () => {
    const { calls, prepared } = recoverInvalidRealDestination(({ result }) => {
      writeFileSync(result.receiptPath, '{broken json')
    })
    expect(calls).toEqual(['rolled-back'])
    expect(loadWorkspaceConfig(prepared.source)?.movedTo).toBeUndefined()
    expect(readTeamMigrationJournal(prepared.result.journalPath!)?.phase).toBe('rolled-back')
  })

  test('incomplete destination receipt rolls back without changing registry or tombstoning source', () => {
    const { calls, prepared } = recoverInvalidRealDestination(({ result }) => {
      const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf-8')) as Record<string, unknown>
      writeFileSync(result.receiptPath, JSON.stringify({ ...receipt, status: 'in-progress' }, null, 2))
    })
    expect(calls).toEqual(['rolled-back'])
    expect(loadWorkspaceConfig(prepared.source)?.movedTo).toBeUndefined()
    expect(readTeamMigrationJournal(prepared.result.journalPath!)?.phase).toBe('rolled-back')
  })
})
