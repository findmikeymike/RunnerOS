import { describe, expect, test } from 'bun:test'
import type { TeamMigrationJournal } from '@craft-agent/shared/workspaces'
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
  }
  const log = { info: (_message: string) => {}, error: (_message: string, _error?: unknown) => {} }
  return { calls, deps, log }
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
})
