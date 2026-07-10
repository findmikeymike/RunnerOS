import { getWorkspaceByNameOrId, updateWorkspaceRootPath } from '@craft-agent/shared/config'
import { join } from 'node:path'
import {
  completePreparedWorkspaceMigration,
  getLocalTeamMigrationJournalPath,
  listLocalTeamMigrationJournals,
  rollbackPreparedWorkspaceMigration,
  promotePreparedPrivateSessions,
  updateTeamMigrationJournal,
  writeMovedToTombstone,
  type TeamMigrationJournal,
  type TeamSharedFolderMigrationResult,
} from '@craft-agent/shared/workspaces'

const FORWARD_PHASES = new Set<TeamMigrationJournal['phase']>([
  'root-switched',
  'source-tombstoned',
  'runtime-rebound',
  'needs-repair',
])

export interface WorkspaceMigrationRecoveryDeps {
  listJournals(): TeamMigrationJournal[]
  getWorkspace(workspaceId: string): { rootPath: string } | null | undefined
  updateRoot(workspaceId: string, rootPath: string): unknown
  updateJournal(journal: TeamMigrationJournal, phase: TeamMigrationJournal['phase'], error?: string): TeamMigrationJournal
  rollback(journal: TeamMigrationJournal): TeamMigrationJournal
  writeTombstone(sourceRootPath: string, finalRootPath: string, migrationId: string): unknown
  completeDestination(result: TeamSharedFolderMigrationResult): void
  promotePrivateSessions(result: TeamSharedFolderMigrationResult): void
}

const DEFAULT_DEPS: WorkspaceMigrationRecoveryDeps = {
  listJournals: listLocalTeamMigrationJournals,
  getWorkspace: getWorkspaceByNameOrId,
  updateRoot: updateWorkspaceRootPath,
  updateJournal: updateTeamMigrationJournal,
  rollback: rollbackPreparedWorkspaceMigration,
  writeTombstone: writeMovedToTombstone,
  completeDestination: completePreparedWorkspaceMigration,
  promotePrivateSessions: promotePreparedPrivateSessions,
}

function resultFromJournal(journal: TeamMigrationJournal): TeamSharedFolderMigrationResult {
  return {
    migrationId: journal.migrationId,
    originalRootPath: journal.sourceRootPath,
    finalRootPath: journal.finalRootPath,
    receiptPath: join(journal.finalRootPath, 'team', 'migrations', `${journal.migrationId}.json`),
    teamConfigPath: join(journal.finalRootPath, 'team', 'config.json'),
    journalPath: getLocalTeamMigrationJournalPath(journal.workspaceId, journal.migrationId),
  }
}

/**
 * Reconcile interrupted moves before SessionManager starts any watcher,
 * scheduler, or session runtime. Before the root switch we roll back. Once
 * the local root points at the destination, recovery is forward-only.
 */
export function recoverInterruptedWorkspaceMigrations(
  log: { info(message: string): void; error(message: string, error?: unknown): void },
  deps: WorkspaceMigrationRecoveryDeps = DEFAULT_DEPS,
): void {
  for (const journal of deps.listJournals()) {
    if (journal.phase === 'complete' || journal.phase === 'rolled-back') continue
    try {
      const workspace = deps.getWorkspace(journal.workspaceId)
      const rootAlreadySwitched = workspace?.rootPath === journal.finalRootPath
      if (!rootAlreadySwitched && !FORWARD_PHASES.has(journal.phase)) {
        deps.rollback(journal)
        log.info(`[TeamMigration] Rolled back interrupted migration ${journal.migrationId}`)
        continue
      }

      if (!rootAlreadySwitched) deps.updateRoot(journal.workspaceId, journal.finalRootPath)
      let next = deps.updateJournal(journal, 'root-switched')
      deps.promotePrivateSessions(resultFromJournal(journal))
      deps.writeTombstone(journal.sourceRootPath, journal.finalRootPath, journal.migrationId)
      next = deps.updateJournal(next, 'source-tombstoned')
      deps.completeDestination(resultFromJournal(journal))
      deps.updateJournal(next, 'complete')
      log.info(`[TeamMigration] Completed interrupted migration ${journal.migrationId}`)
    } catch (error) {
      deps.updateJournal(journal, 'needs-repair', error instanceof Error ? error.message : String(error))
      log.error(`[TeamMigration] Recovery needs repair for ${journal.migrationId}`, error)
    }
  }
}
