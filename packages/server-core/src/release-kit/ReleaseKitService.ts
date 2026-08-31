import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  loadArtistVaultManifest,
  type VaultAssetRecord,
} from '@craft-agent/shared/artist-vault'
import {
  loadMissionAssetManifest,
  type MissionAssetRecord,
} from '@craft-agent/shared/mission-assets'
import {
  getReleaseKitRoot,
  loadReleaseKitManifest,
  materializeReleaseKitItem,
  releaseKitContextMetadata,
  releaseKitContextSlug,
  removeReleaseKitItem,
  resolveReleaseKitItemPath,
  serializeReleaseKitContext,
  setReleaseKitPrimary,
  updateReleaseKitItemUsage,
  verifyReleaseKit,
  verifyReleaseKitItem,
  type PromoteToReleaseKitInput,
  type ReleaseKitItem,
  type ReleaseKitItemDetail,
  type ReleaseKitManifest,
  type ReleaseKitMigrationResult,
  type UpdateReleaseKitUsageInput,
} from '@craft-agent/shared/release-kit'
import { readOutputFinalsRegistry } from '@craft-agent/shared/outputs'
import { loadContextDoc, upsertContextDoc } from '@craft-agent/shared/workspace-context'
import { assertTeamPermission } from '@craft-agent/shared/workspaces'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  listReleaseKitItemUses,
  parseScheduledWorkDocResult,
  scheduledWorkMetadata,
  serializeScheduledWorkBody,
  summarizeReleaseKitItemUses,
  type ReleaseKitItemUseSummary,
} from '@craft-agent/shared/scheduled-work'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  campaignCalendarMetadata,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
} from '@craft-agent/shared/campaign-calendar'
import { OutputService } from '../outputs/OutputService'

export interface ReleaseKitServiceOptions {
  onChanged?: (workspaceId: string, manifest: ReleaseKitManifest) => void
  getWorkspaceByNameOrId?: typeof getWorkspaceByNameOrId
  assertWritePermission?: (workspaceRootPath: string) => void
}

interface LegacyMigrationLedger {
  importedLegacyFinalIds: Set<string>
}

export class ReleaseKitService {
  private readonly outputs: OutputService

  constructor(private readonly options: ReleaseKitServiceOptions = {}) {
    this.outputs = new OutputService({
      getWorkspaceRootPath: (workspaceId) => this.getWorkspace(workspaceId).rootPath,
      emitOutputsUpdated: () => {},
      emitWorkflowRunUpdated: () => {},
    })
  }

  get(workspaceId: string): ReleaseKitManifest {
    const workspace = this.getCampaignWorkspace(workspaceId)
    return loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id)
  }

  getItem(workspaceId: string, itemId: string): ReleaseKitItemDetail {
    const workspace = this.getCampaignWorkspace(workspaceId)
    const verified = verifyReleaseKitItem(workspace.rootPath, workspace.id, workspace.id, itemId)
    const item = verified.item
    if (item.status !== 'ready') {
      throw new Error(`Release Kit item failed integrity verification: ${item.status}`)
    }
    return {
      item,
      absolutePath: resolveReleaseKitItemPath(workspace.rootPath, item.relativePath),
    }
  }

  listUses(workspaceId: string, itemId: string): ReleaseKitItemUseSummary[] {
    const workspace = this.getCampaignWorkspace(workspaceId)
    const manifest = loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id)
    if (!manifest.items.some((item) => item.id === itemId)) {
      throw new Error(`Release Kit item not found: ${itemId}`)
    }
    const scheduled = parseScheduledWorkDocResult(
      loadContextDoc(workspace.rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspace.id,
    )
    if (!scheduled.ok) throw new Error(`Cannot read Release Kit uses while Scheduled Work is invalid: ${scheduled.error}`)
    return summarizeReleaseKitItemUses(scheduled.work, itemId)
  }

  promote(
    workspaceId: string,
    input: PromoteToReleaseKitInput,
    actor: 'user' | 'agent',
  ): { manifest: ReleaseKitManifest; item: ReleaseKitItem } {
    const workspace = this.getCampaignWorkspace(workspaceId)
    this.assertWritePermission(workspace.rootPath)
    const resolved = this.resolveSource(workspace.id, workspace.rootPath, input, actor)
    this.prepareContextSync(workspace.rootPath)
    const result = materializeReleaseKitItem(workspace.rootPath, {
      workspaceId: workspace.id,
      campaignId: workspace.id,
      source: input.source,
      sourcePath: resolved.path,
      category: input.category,
      subtype: input.subtype,
      title: input.title,
      mimeType: input.mimeType ?? resolved.mimeType,
      makePrimary: input.makePrimary,
      promotedBy: actor,
      note: input.note,
    })
    this.commitContext(workspace.id, workspace.rootPath, result.manifest)
    return result
  }

  remove(workspaceId: string, itemId: string): ReleaseKitManifest {
    const workspace = this.getCampaignWorkspace(workspaceId)
    this.assertWritePermission(workspace.rootPath)
    this.prepareContextSync(workspace.rootPath)
    const result = removeReleaseKitItem(
      workspace.rootPath,
      workspace.id,
      workspace.id,
      itemId,
      (item) => {
        this.assertItemIsUnreferenced(workspace.id, workspace.rootPath, itemId)
        this.recordRemovedLegacyFinal(workspace.rootPath, item)
      },
    )
    this.commitContext(workspace.id, workspace.rootPath, result.manifest)
    return result.manifest
  }

  setPrimary(workspaceId: string, itemId: string): ReleaseKitManifest {
    const workspace = this.getCampaignWorkspace(workspaceId)
    this.assertWritePermission(workspace.rootPath)
    this.prepareContextSync(workspace.rootPath)
    const manifest = setReleaseKitPrimary(workspace.rootPath, workspace.id, workspace.id, itemId)
    this.commitContext(workspace.id, workspace.rootPath, manifest)
    return manifest
  }

  updateUsage(workspaceId: string, itemId: string, input: UpdateReleaseKitUsageInput): ReleaseKitManifest {
    const workspace = this.getCampaignWorkspace(workspaceId)
    this.assertWritePermission(workspace.rootPath)
    this.prepareContextSync(workspace.rootPath)
    const manifest = updateReleaseKitItemUsage(workspace.rootPath, workspace.id, workspace.id, itemId, input)
    const item = manifest.items.find((candidate) => candidate.id === itemId)
    if (item && Object.values(item.usage.restrictions).some(Boolean)) {
      this.reconcileRestrictedUses(workspace.id, workspace.rootPath, itemId)
    }
    this.commitContext(workspace.id, workspace.rootPath, manifest)
    return manifest
  }

  verify(workspaceId: string): ReturnType<typeof verifyReleaseKit> {
    const workspace = this.getCampaignWorkspace(workspaceId)
    this.assertWritePermission(workspace.rootPath)
    this.prepareContextSync(workspace.rootPath)
    const result = verifyReleaseKit(workspace.rootPath, workspace.id, workspace.id)
    this.commitContext(workspace.id, workspace.rootPath, result.manifest)
    return result
  }

  migrateLegacy(workspaceId: string): ReleaseKitMigrationResult {
    const workspace = this.getCampaignWorkspace(workspaceId)
    this.assertWritePermission(workspace.rootPath)
    let manifest = loadReleaseKitManifest(workspace.rootPath, workspace.id, workspace.id)
    const legacyRegistry = readOutputFinalsRegistry(workspace.rootPath, { strict: true })
    const legacy = legacyRegistry.finals.filter((entry) => (
      entry.scope === 'campaign' && entry.campaignId === workspace.id
    ))
    const migration = loadLegacyMigrationLedger(workspace.rootPath)
    if (legacy.length > 0) this.prepareContextSync(workspace.rootPath)
    let migrated = 0
    const skipped: Array<{ finalId: string; reason: string }> = []

    for (const final of legacy) {
      const alreadyMigrated = manifest.items.some((item) => (
        item.source.type === 'legacy-final'
          && (item.source.legacyFinalId === final.id || (
            item.source.outputId === final.outputId
            && (item.source.assetId ?? '') === (final.assetId ?? '')
          ))
      ))
      if (migration.importedLegacyFinalIds.has(final.id)) continue
      if (alreadyMigrated) {
        migration.importedLegacyFinalIds.add(final.id)
        saveLegacyMigrationLedger(workspace.rootPath, migration)
        continue
      }
      try {
        const output = this.outputs.get(workspace.id, final.outputId)
        if (!output) throw new Error(`Output not found: ${final.outputId}`)
        const asset = final.assetId
          ? output.assets.find((candidate) => candidate.id === final.assetId)
          : output.primary ?? output.assets[0]
        if (!asset) throw new Error(`Output has no file asset: ${final.outputId}`)
        const mapped = releaseKitPlacementFromLegacySlot(final.slot)
        const result = materializeReleaseKitItem(workspace.rootPath, {
          workspaceId: workspace.id,
          campaignId: workspace.id,
          source: { type: 'legacy-final', outputId: output.id, assetId: asset.id, legacyFinalId: final.id },
          sourcePath: this.outputs.resolveAssetPath(workspace.id, output.id, asset.path),
          category: mapped.category,
          subtype: mapped.subtype,
          title: output.title,
          mimeType: asset.mimeType,
          makePrimary: final.isPrimary,
          promotedBy: 'migration',
          note: final.note ?? `Migrated from legacy Finals slot: ${final.slot}`,
        })
        manifest = result.manifest
        migration.importedLegacyFinalIds.add(final.id)
        saveLegacyMigrationLedger(workspace.rootPath, migration)
        migrated += 1
      } catch (error) {
        skipped.push({
          finalId: final.id,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (legacy.length > 0) this.commitContext(workspace.id, workspace.rootPath, manifest)
    return { manifest, migrated, skipped }
  }

  getRoot(workspaceId: string): string {
    return getReleaseKitRoot(this.getCampaignWorkspace(workspaceId).rootPath)
  }

  private resolveSource(
    workspaceId: string,
    workspaceRootPath: string,
    input: PromoteToReleaseKitInput,
    actor: 'user' | 'agent',
  ): { path: string; mimeType?: string } {
    const source = input.source
    if (source.type === 'upload') {
      if (actor !== 'user') throw new Error('Agents cannot promote arbitrary upload paths. Import the file first.')
      if (!input.uploadPath?.trim()) throw new Error('A user-selected upload path is required.')
      const path = resolve(input.uploadPath)
      if (basename(path) !== source.originalFileName) throw new Error('Selected upload does not match its source record.')
      assertReadableFile(path)
      return { path }
    }

    if (input.uploadPath) throw new Error('uploadPath is only allowed for user uploads.')
    if (source.type === 'campaign-asset') {
      const record = loadMissionAssetManifest(workspaceRootPath, workspaceId).files.find((asset) => asset.id === source.assetId)
      if (!record) throw new Error(`Campaign Asset not found: ${source.assetId}`)
      if (record.status !== 'available') throw new Error(`Campaign Asset is not available: ${source.assetId}`)
      if (!record.usableByAgents) throw new Error('This Campaign Asset is not approved for agent use.')
      return { path: resolveMissionAssetPath(workspaceRootPath, record), mimeType: record.mimeType }
    }

    if (source.type === 'vault-asset') {
      const vaultWorkspace = this.getWorkspace(source.vaultWorkspaceId)
      if (vaultWorkspace.artistWorkspaceScope !== 'hq') throw new Error('Vault source must belong to the Artist HQ workspace.')
      const record = loadArtistVaultManifest(vaultWorkspace.rootPath, vaultWorkspace.id).assets.find((asset) => asset.id === source.assetId)
      if (!record) throw new Error(`HQ Vault asset not found: ${source.assetId}`)
      assertVaultAssetCanEnterReleaseKit(record)
      return { path: resolveVaultAssetPath(vaultWorkspace.rootPath, record), mimeType: record.mimeType }
    }

    if (source.type === 'legacy-final') throw new Error('Legacy Finals can only be imported by the migration service.')
    if (!source.assetId?.trim()) {
      throw new Error('Output promotion requires an exact assetId. Choose the specific Output asset to promote.')
    }
    const output = this.outputs.get(workspaceId, source.outputId)
    if (!output) throw new Error(`Output not found: ${source.outputId}`)
    const asset = output.assets.find((candidate) => candidate.id === source.assetId)
    if (!asset) throw new Error(`Output has no file asset: ${source.outputId}`)
    return {
      path: this.outputs.resolveAssetPath(workspaceId, output.id, asset.path),
      mimeType: asset.mimeType,
    }
  }

  private commitContext(workspaceId: string, workspaceRootPath: string, manifest: ReleaseKitManifest): void {
    this.syncContext(workspaceRootPath, manifest)
    this.options.onChanged?.(workspaceId, manifest)
  }

  private prepareContextSync(workspaceRootPath: string): void {
    const marker = contextSyncMarkerPath(workspaceRootPath)
    mkdirSync(getReleaseKitRoot(workspaceRootPath), { recursive: true })
    const temp = `${marker}.tmp-${process.pid}`
    writeFileSync(temp, `${JSON.stringify({
      schemaVersion: 1,
      preparedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8')
    renameSync(temp, marker)
  }

  private syncContext(workspaceRootPath: string, manifest: ReleaseKitManifest): void {
    const marker = contextSyncMarkerPath(workspaceRootPath)
    try {
      upsertContextDoc(workspaceRootPath, {
        slug: releaseKitContextSlug(),
        metadata: releaseKitContextMetadata(),
        body: serializeReleaseKitContext(manifest),
      })
      rmSync(marker, { force: true })
    } catch (error) {
      try {
        mkdirSync(getReleaseKitRoot(workspaceRootPath), { recursive: true })
        writeFileSync(marker, `${JSON.stringify({
          schemaVersion: 1,
          manifestUpdatedAt: manifest.updatedAt,
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        }, null, 2)}\n`, 'utf8')
      } catch {
        // The manifest remains canonical even when the repair marker cannot be written.
      }
    }
  }

  private assertItemIsUnreferenced(workspaceId: string, rootPath: string, itemId: string): void {
    const scheduled = parseScheduledWorkDocResult(
      loadContextDoc(rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!scheduled.ok) throw new Error(`Cannot safely remove Release Kit item while Scheduled Work is invalid: ${scheduled.error}`)
    const scheduledRefs = listReleaseKitItemUses(scheduled.work, itemId)
      .filter((order) => order.status !== 'canceled')

    const calendar = parseCampaignCalendarDocResult(
      loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined,
      workspaceId,
    )
    if (!calendar.ok) throw new Error(`Cannot safely remove Release Kit item while Campaign Calendar is invalid: ${calendar.error}`)
    const calendarRefs = calendar.calendar.items.filter((item) => (
      !item.deletedAt
      && item.status !== 'canceled'
      && item.releaseKitRefs.some((ref) => ref.itemId === itemId)
    ))
    if (scheduledRefs.length || calendarRefs.length) {
      throw new Error(`Release Kit item is still referenced by ${scheduledRefs.length} scheduled work order(s) and ${calendarRefs.length} calendar item(s). Cancel or remove those references first.`)
    }
  }

  private reconcileRestrictedUses(workspaceId: string, rootPath: string, itemId: string): void {
    const scheduled = parseScheduledWorkDocResult(loadContextDoc(rootPath, SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!scheduled.ok) throw new Error(`Cannot reconcile restricted Release Kit item while Scheduled Work is invalid: ${scheduled.error}`)
    const affected = listReleaseKitItemUses(scheduled.work, itemId).filter((order) => (
      order.status !== 'done' && order.status !== 'canceled' && order.status !== 'needs-attention'
    ))
    if (!affected.length) return
    const calendar = parseCampaignCalendarDocResult(loadContextDoc(rootPath, CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspaceId)
    if (!calendar.ok) throw new Error(`Cannot reconcile restricted Release Kit item while Campaign Calendar is invalid: ${calendar.error}`)
    const now = new Date().toISOString()
    const affectedIds = new Set(affected.map((order) => order.id))
    const work = {
      ...scheduled.work,
      items: scheduled.work.items.map((order) => affectedIds.has(order.id) ? {
        ...order,
        status: 'needs-attention' as const,
        authorization: undefined,
        socialApproval: undefined,
        attention: {
          reason: 'approval-invalidated' as const,
          message: 'This final is now restricted. Review the asset and schedule the post again after the restriction is cleared.',
        },
        updatedAt: now,
      } : order),
      updatedAt: now,
    }
    const campaignCalendar = {
      ...calendar.calendar,
      items: calendar.calendar.items.map((item) => item.scheduledWorkId && affectedIds.has(item.scheduledWorkId) ? {
        ...item,
        status: 'failed' as const,
        updatedAt: now,
      } : item),
      updatedAt: now,
    }
    upsertContextDoc(rootPath, { slug: SCHEDULED_WORK_CONTEXT_SLUG, metadata: scheduledWorkMetadata(), body: serializeScheduledWorkBody(work) })
    upsertContextDoc(rootPath, { slug: CAMPAIGN_CALENDAR_CONTEXT_SLUG, metadata: campaignCalendarMetadata(), body: serializeCampaignCalendarBody(campaignCalendar) })
  }

  private recordRemovedLegacyFinal(rootPath: string, item: ReleaseKitItem): void {
    if (item.source.type !== 'legacy-final') return
    const source = item.source
    const ids = source.legacyFinalId
      ? [source.legacyFinalId]
      : readOutputFinalsRegistry(rootPath, { strict: true }).finals
        .filter((final) => final.outputId === source.outputId
          && (final.assetId ?? '') === (source.assetId ?? ''))
        .map((final) => final.id)
    if (!ids.length) return
    const ledger = loadLegacyMigrationLedger(rootPath)
    for (const id of ids) ledger.importedLegacyFinalIds.add(id)
    saveLegacyMigrationLedger(rootPath, ledger)
  }

  private assertWritePermission(workspaceRootPath: string): void {
    if (this.options.assertWritePermission) {
      this.options.assertWritePermission(workspaceRootPath)
      return
    }
    assertTeamPermission(workspaceRootPath, 'files.write')
  }

  private getCampaignWorkspace(workspaceId: string): ReturnType<ReleaseKitService['getWorkspace']> {
    const workspace = this.getWorkspace(workspaceId)
    if (workspace.artistWorkspaceScope !== 'campaign') {
      throw new Error('Release Kits belong to campaign workspaces.')
    }
    return workspace
  }

  private getWorkspace(workspaceId: string): NonNullable<ReturnType<typeof getWorkspaceByNameOrId>> {
    const workspace = (this.options.getWorkspaceByNameOrId ?? getWorkspaceByNameOrId)(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    return workspace
  }
}

function contextSyncMarkerPath(workspaceRootPath: string): string {
  return join(getReleaseKitRoot(workspaceRootPath), '.context-sync-pending.json')
}

function legacyMigrationLedgerPath(workspaceRootPath: string): string {
  return join(getReleaseKitRoot(workspaceRootPath), '.legacy-migration.json')
}

function loadLegacyMigrationLedger(workspaceRootPath: string): LegacyMigrationLedger {
  const path = legacyMigrationLedgerPath(workspaceRootPath)
  if (!existsSync(path)) return { importedLegacyFinalIds: new Set() }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`Release Kit legacy migration ledger is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Release Kit legacy migration ledger is invalid.')
  const record = parsed as Record<string, unknown>
  if (record.schemaVersion !== 1 || !Array.isArray(record.importedLegacyFinalIds)
    || record.importedLegacyFinalIds.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('Release Kit legacy migration ledger is invalid.')
  }
  return { importedLegacyFinalIds: new Set(record.importedLegacyFinalIds as string[]) }
}

function saveLegacyMigrationLedger(workspaceRootPath: string, ledger: LegacyMigrationLedger): void {
  const root = getReleaseKitRoot(workspaceRootPath)
  mkdirSync(root, { recursive: true })
  const path = legacyMigrationLedgerPath(workspaceRootPath)
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify({
    schemaVersion: 1,
    importedLegacyFinalIds: [...ledger.importedLegacyFinalIds].sort(),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

function resolveMissionAssetPath(workspaceRootPath: string, asset: MissionAssetRecord): string {
  const path = resolveRegisteredAssetPath(workspaceRootPath, asset.relativePath, asset.absolutePath)
  assertReadableFile(path)
  return path
}

function resolveVaultAssetPath(workspaceRootPath: string, asset: VaultAssetRecord): string {
  const path = resolveRegisteredAssetPath(workspaceRootPath, asset.relativePath, asset.absolutePath)
  assertReadableFile(path)
  return path
}

function resolveRegisteredAssetPath(workspaceRootPath: string, relativePath?: string, absolutePath?: string): string {
  if (relativePath) {
    const root = resolve(workspaceRootPath)
    const candidate = resolve(root, relativePath)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
      throw new Error('Registered asset path escapes its workspace.')
    }
    const realRoot = realpathSync(root)
    const realCandidate = realpathSync(candidate)
    if (realCandidate !== realRoot && !realCandidate.startsWith(`${realRoot}${sep}`)) {
      throw new Error('Registered asset path escapes its workspace through a symbolic link.')
    }
    return realCandidate
  }
  if (absolutePath) return resolve(absolutePath)
  throw new Error('Registered asset has no file path.')
}

function assertReadableFile(path: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Asset file is missing: ${path}`)
}

function assertVaultAssetCanEnterReleaseKit(asset: VaultAssetRecord): void {
  if (asset.status === 'missing' || asset.status === 'archived') throw new Error('This HQ Vault asset is not available.')
  if (!asset.usableByAgents) throw new Error('This HQ Vault asset is not approved for agent use.')
  if (asset.rightsStatus === 'private') throw new Error('Private HQ Vault assets cannot enter an agent-visible Release Kit.')
}

export function releaseKitPlacementFromLegacySlot(slot: string): { category: 'audio' | 'artwork' | 'video' | 'images' | 'copy' | 'plans' | 'merch' | 'documents'; subtype: string } {
  const normalized = slot.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  if (/cover|artwork|single-art/.test(normalized)) return { category: 'artwork', subtype: 'cover-art' }
  if (/video|visualizer|clip/.test(normalized)) return { category: 'video', subtype: normalized || 'final-video' }
  if (/master|audio|clean|instrumental|radio/.test(normalized)) return { category: 'audio', subtype: normalized || 'master' }
  if (/image|photo|press|social|meme/.test(normalized)) return { category: 'images', subtype: normalized || 'general' }
  if (/merch/.test(normalized)) return { category: 'merch', subtype: normalized || 'design' }
  if (/plan|strategy|calendar/.test(normalized)) return { category: 'plans', subtype: normalized || 'plan' }
  if (/copy|caption|bio|pitch|press-release/.test(normalized)) return { category: 'copy', subtype: normalized || 'copy' }
  return { category: 'documents', subtype: normalized || 'final-document' }
}
