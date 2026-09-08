import { existsSync, lstatSync, realpathSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Workspace } from '@craft-agent/core/types'
import { CONFIG_DIR, deleteSessionDraft, getWorkspaces, loadStoredConfig, saveConfig } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { deleteWorkspaceSessionLogEntries } from '@craft-agent/shared/sessions-log'
import { listSessions } from '@craft-agent/shared/sessions'
import { RUNTIME_IDENTITY } from '@craft-agent/shared/config/runtime-identity'
import { previewCampaignCleanup, preserveCampaignForDeletion, type CampaignCleanupOptions, type CampaignCleanupPreview, type CampaignCleanupResult } from '@craft-agent/shared/campaign-cleanup'
import type { WorkspaceMigrationRuntimeLease } from '@craft-agent/server-core/handlers'

export interface CampaignCleanupRuntime {
  quiesceCampaignForDeletion(workspaceId: string): Promise<WorkspaceMigrationRuntimeLease>
  resumeWorkspaceAfterMigration(lease: WorkspaceMigrationRuntimeLease): Promise<void>
  disposeCampaignSessions(lease: WorkspaceMigrationRuntimeLease): Promise<void>
  finishCampaignDeletion(lease: WorkspaceMigrationRuntimeLease): void
}

interface Dependencies {
  acquireRequestFence?(): () => void
  runtime: CampaignCleanupRuntime
  stopMessaging(workspaceId: string): Promise<void>
  resumeMessaging(workspaceId: string): Promise<void>
  onDeleted(result: CampaignCleanupResult): void
  workspaces?: typeof getWorkspaces
  preview?: typeof previewCampaignCleanup
  preserve?: typeof preserveCampaignForDeletion
  clearPrivateState?: (workspace: Workspace) => Promise<void>
  removeFilesAndRegistration?: (workspace: Workspace, hq: Workspace) => void
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && rel !== '..' && !isAbsolute(rel))
}

/** Only an actual, isolated, local campaign folder is eligible for physical deletion. */
export function resolveCampaignCleanup(workspaces: Workspace[], workspaceId: string): { campaign: Workspace; hq: Workspace; options: CampaignCleanupOptions } {
  const campaign = workspaces.find((workspace) => workspace.id === workspaceId)
  if (!campaign || campaign.artistWorkspaceScope !== 'campaign') throw new Error('Only campaign workspaces can be deleted here.')
  if (!/^[a-zA-Z0-9_-]+$/.test(campaign.id)) throw new Error('The campaign identifier is invalid. Nothing was deleted.')
  if (campaign.remoteServer) throw new Error('Remote campaigns must be managed on their owning computer. Nothing was deleted.')
  const config = loadWorkspaceConfig(campaign.rootPath)
  if (!config) throw new Error('The campaign folder could not be read safely. Nothing was deleted.')
  if (config.storage?.mode && config.storage.mode !== 'solo') throw new Error('Shared and Git campaigns cannot be deleted here. Manage the shared folder with its owner.')
  if (existsSync(join(campaign.rootPath, '.git'))) throw new Error('This campaign is a Git checkout. Manage its files through Git instead of campaign cleanup.')
  const legacyRoot = join(RUNTIME_IDENTITY.workspacesRoot, campaign.id)
  if (resolve(legacyRoot) !== resolve(campaign.rootPath) && existsSync(legacyRoot) && readdirSync(legacyRoot).length > 0) {
    throw new Error('This campaign has older files outside its main folder. Bring those files into the campaign before deleting it so useful media can be saved.')
  }
  const hq = workspaces.find((workspace) => workspace.artistWorkspaceScope === 'hq' && !workspace.remoteServer)
  if (!hq) throw new Error('A local Artist HQ is required to save the campaign’s useful files.')
  const hqConfig = loadWorkspaceConfig(hq.rootPath)
  if (!hqConfig || (hqConfig.storage?.mode && hqConfig.storage.mode !== 'solo')) throw new Error('Campaign cleanup currently needs a local solo Artist HQ for its saved files.')
  if (lstatSync(campaign.rootPath).isSymbolicLink() || lstatSync(hq.rootPath).isSymbolicLink()) throw new Error('Campaign cleanup cannot operate on linked workspace folders.')
  const root = realpathSync(campaign.rootPath)
  const hqRoot = realpathSync(hq.rootPath)
  const protectedPaths = [homedir(), tmpdir(), CONFIG_DIR, RUNTIME_IDENTITY.workspacesRoot, process.cwd()].map((path) => existsSync(path) ? realpathSync(path) : resolve(path))
  if (protectedPaths.some((path) => contains(root, path))) throw new Error('This campaign folder contains app or system data and cannot be deleted safely.')
  for (const other of workspaces) {
    if (other.id === campaign.id) continue
    const otherRoot = existsSync(other.rootPath) ? realpathSync(other.rootPath) : resolve(other.rootPath)
    if (contains(root, otherRoot) || contains(otherRoot, root)) throw new Error('This campaign shares or overlaps another workspace folder and cannot be deleted safely.')
  }
  return { campaign, hq, options: { campaignRootPath: root, hqRootPath: hqRoot, campaignId: campaign.id, campaignName: campaign.name, hqWorkspaceId: hq.id } }
}

async function clearPrivateState(workspace: Workspace): Promise<void> {
  const sessionIds = listSessions(workspace.rootPath).map(session => session.id)
  deleteWorkspaceSessionLogEntries(workspace.id, sessionIds)
  for (const id of sessionIds) deleteSessionDraft(id)
  await getCredentialManager().deleteWorkspaceCredentials(workspace.id)
}

/** No asynchronous gap between unregistering and deleting; failed deletion restores discoverability. */
function removeFilesAndRegistration(workspace: Workspace, hq: Workspace): void {
  const config = loadStoredConfig()
  const current = config?.workspaces.find((item) => item.id === workspace.id)
  if (!config || current?.rootPath !== workspace.rootPath) throw new Error('Campaign registration changed. Reopen the cleanup preview.')
  const legacyRoot = join(RUNTIME_IDENTITY.workspacesRoot, workspace.id)
  if (resolve(legacyRoot) !== resolve(workspace.rootPath) && existsSync(legacyRoot)
    && config.workspaces.some((item) => item.id !== workspace.id && (contains(resolve(legacyRoot), resolve(item.rootPath)) || contains(resolve(item.rootPath), resolve(legacyRoot))))) {
    throw new Error('The legacy campaign data folder overlaps another workspace. Its files were left untouched.')
  }
  const previousActiveWorkspaceId = config.activeWorkspaceId
  const previousActiveSessionId = config.activeSessionId
  config.workspaces = config.workspaces.filter((item) => item.id !== workspace.id)
  if (config.activeWorkspaceId === workspace.id) {
    config.activeWorkspaceId = hq.id
    config.activeSessionId = null
  }
  saveConfig(config)
  try {
    if (resolve(legacyRoot) !== resolve(workspace.rootPath) && existsSync(legacyRoot)) {
      rmSync(legacyRoot, { recursive: true, force: true })
    }
    rmSync(workspace.rootPath, { recursive: true, force: true })
  } catch (error) {
    const latest = loadStoredConfig()
    if (latest && !latest.workspaces.some((item) => item.id === workspace.id)) {
      latest.workspaces.push(workspace)
      latest.activeWorkspaceId = previousActiveWorkspaceId
      latest.activeSessionId = previousActiveSessionId
      saveConfig(latest)
    }
    throw error
  }
}

export function createCampaignCleanupController(deps: Dependencies) {
  const pending = new Set<string>()
  const resolveInput = (id: string) => resolveCampaignCleanup((deps.workspaces ?? getWorkspaces)(), id)
  return {
    async preview(workspaceId: string): Promise<CampaignCleanupPreview> {
      const { options } = resolveInput(workspaceId)
      const result = await (deps.preview ?? previewCampaignCleanup)(options)
      result.warnings = [...new Set([...result.warnings, 'Local campaign schedules will stop. Posts, ads, emails, or events already scheduled on outside services are not canceled by deleting this campaign.'])]
      return result
    },
    async delete(workspaceId: string, previewToken: string): Promise<CampaignCleanupResult> {
      if (typeof previewToken !== 'string' || !previewToken) throw new Error('Review the campaign cleanup preview before deleting.')
      if (pending.has(workspaceId)) throw new Error('This campaign is already being cleaned up.')
      pending.add(workspaceId)
      let lease: WorkspaceMigrationRuntimeLease | undefined
      let releaseRequestFence: (() => void) | undefined
      let removed = false
      let messagingStopped = false
      try {
        releaseRequestFence = deps.acquireRequestFence?.()
        const { campaign, hq, options } = resolveInput(workspaceId)
        lease = await deps.runtime.quiesceCampaignForDeletion(workspaceId)
        await deps.stopMessaging(workspaceId)
        messagingStopped = true
        const receipt = await (deps.preserve ?? preserveCampaignForDeletion)(options, previewToken)
        // Refresh root/registration guards after asynchronous preservation.
        resolveInput(workspaceId)
        await (deps.clearPrivateState ?? clearPrivateState)(campaign)
        await deps.runtime.disposeCampaignSessions(lease)
        // This last inventory check and folder removal are synchronous: no renderer
        // callback may change files between confirmation validation and deletion.
        const finalPreview = (deps.preview ?? previewCampaignCleanup)(options)
        if (finalPreview.previewToken !== previewToken) throw new Error('Campaign changed during cleanup. Review a fresh preview; it has not been deleted.')
        ;(deps.removeFilesAndRegistration ?? removeFilesAndRegistration)(campaign, hq)
        removed = true
        deps.runtime.finishCampaignDeletion(lease)
        const result: CampaignCleanupResult = { ...receipt, workspaceId, hqWorkspaceId: hq.id }
        try { deps.onDeleted(result) } catch (error) { console.error('Campaign deleted; window refresh failed:', error) }
        return result
      } catch (error) {
        if (lease && !removed) {
          await deps.runtime.resumeWorkspaceAfterMigration(lease)
          if (messagingStopped) await deps.resumeMessaging(workspaceId)
        }
        throw error
      } finally {
        releaseRequestFence?.()
        pending.delete(workspaceId)
      }
    },
  }
}
