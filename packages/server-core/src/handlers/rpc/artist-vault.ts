import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import {
  artistVaultContextMetadata,
  artistVaultContextSlug,
  ensureArtistVaultFolders,
  getArtistVaultRoot,
  importArtistVaultAssetsAsync,
  linkArtistVaultFolderAsync,
  loadArtistVaultManifest,
  planArtistVaultImports,
  scanArtistVaultAsync,
  serializeArtistVaultContext,
  updateArtistVaultAsset,
  type VaultAssetImportCandidate,
  type VaultAssetImportOptions,
  type VaultAssetImportResult,
  type VaultAssetUpdatePatch,
  type VaultFolderLinkResult,
  type VaultKindHint,
  type VaultManifest,
  type VaultAssetScanResult,
} from '@craft-agent/shared/artist-vault'
import {
  loadAllContextDocs,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  requestClientOpenFileDialog,
  requestClientOpenPath,
} from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { OutputService } from '../../outputs/OutputService'
import { refreshHqStateContextDocBestEffort } from '../../hq-state/refresh'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.artistVault.GET,
  RPC_CHANNELS.artistVault.PLAN_IMPORT,
  RPC_CHANNELS.artistVault.CHOOSE_FILES,
  RPC_CHANNELS.artistVault.IMPORT,
  RPC_CHANNELS.artistVault.LINK_FOLDER,
  RPC_CHANNELS.artistVault.UPDATE_ASSET,
  RPC_CHANNELS.artistVault.SAVE_OUTPUT_ASSET,
  RPC_CHANNELS.artistVault.SCAN,
  RPC_CHANNELS.artistVault.OPEN_FOLDER,
] as const

const workspaceMutexes = new Map<string, Promise<void>>()

function withWorkspaceMutex<T>(workspaceRootPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = workspaceMutexes.get(workspaceRootPath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  workspaceMutexes.set(workspaceRootPath, next.then(() => {}, () => {}))
  return next
}

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function resolveArtistVaultTarget(workspaceId: string): NonNullable<ReturnType<typeof getWorkspaceByNameOrId>> {
  const sourceWorkspace = getWorkspaceByNameOrId(workspaceId)
  if (!sourceWorkspace) throw new Error(`Workspace not found: ${workspaceId}`)
  if (sourceWorkspace.artistWorkspaceScope === 'hq') return sourceWorkspace
  const hq = getWorkspaces().find((workspace) => workspace.artistWorkspaceScope === 'hq')
  if (!hq) throw new Error('Artist HQ workspace is not configured.')
  return hq
}

function outputService(): OutputService {
  return new OutputService({
    getWorkspaceRootPath: resolveRootPath,
    emitOutputsUpdated: () => {},
    emitWorkflowRunUpdated: () => {},
  })
}

function selectOutputAssetPath(workspaceId: string, outputId: string, assetId?: string): string {
  const service = outputService()
  const output = service.get(workspaceId, outputId)
  if (!output) throw new Error(`Output not found: ${outputId}`)
  const asset = assetId
    ? output.assets.find((candidate) => candidate.id === assetId)
    : output.primary ?? output.assets.find((candidate) => candidate.role === 'primary') ?? output.assets[0]
  if (!asset) throw new Error(`Output "${outputId}" has no file asset to save.`)
  return service.resolveAssetPath(workspaceId, outputId, asset.path)
}

function broadcastContextChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

function mirrorManifestToContext(workspaceRootPath: string, workspaceId: string, manifest: VaultManifest, deps: HandlerDeps): void {
  upsertContextDoc(workspaceRootPath, {
    slug: artistVaultContextSlug(),
    metadata: artistVaultContextMetadata(),
    body: serializeArtistVaultContext(manifest),
  })
  refreshHqStateContextDocBestEffort(workspaceRootPath)
  broadcastContextChanged(deps, workspaceId, loadAllContextDocs(workspaceRootPath))
}

export function registerArtistVaultHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.artistVault.GET, async (_ctx, workspaceId: string): Promise<VaultManifest> => {
    const rootPath = resolveRootPath(workspaceId)
    return loadArtistVaultManifest(rootPath, workspaceId)
  })

  server.handle(
    RPC_CHANNELS.artistVault.PLAN_IMPORT,
    async (_ctx, workspaceId: string, filePaths: string[], options?: VaultAssetImportOptions): Promise<{
      candidates: VaultAssetImportCandidate[]
      skipped: Array<{ path: string; reason: string }>
    }> => {
      const rootPath = resolveRootPath(workspaceId)
      return planArtistVaultImports(rootPath, filePaths, options ?? {})
    },
  )

  server.handle(
    RPC_CHANNELS.artistVault.CHOOSE_FILES,
    async (ctx, workspaceId: string, kindHint: VaultKindHint = 'any'): Promise<string[]> => {
      resolveRootPath(workspaceId)
      const result = await requestClientOpenFileDialog(server, ctx.clientId, {
        title: dialogTitle(kindHint),
        properties: ['openFile', 'multiSelections'],
        filters: dialogFilters(kindHint),
      })
      return result.canceled ? [] : result.filePaths
    },
  )

  server.handle(
    RPC_CHANNELS.artistVault.IMPORT,
    async (_ctx, workspaceId: string, filePaths: string[], options?: VaultAssetImportOptions): Promise<VaultAssetImportResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceMutex(rootPath, async () => {
        const result = await importArtistVaultAssetsAsync(rootPath, workspaceId, filePaths, options ?? {})
        mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
        return result
      })
    },
  )

  server.handle(
    RPC_CHANNELS.artistVault.LINK_FOLDER,
    async (_ctx, workspaceId: string, folderPath: string): Promise<VaultFolderLinkResult> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceMutex(rootPath, async () => {
        const result = await linkArtistVaultFolderAsync(rootPath, workspaceId, folderPath)
        mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
        return result
      })
    },
  )

  server.handle(
    RPC_CHANNELS.artistVault.UPDATE_ASSET,
    async (_ctx, workspaceId: string, assetId: string, patch: VaultAssetUpdatePatch): Promise<VaultManifest> => {
      const rootPath = resolveRootPath(workspaceId)
      return withWorkspaceMutex(rootPath, async () => {
        const manifest = updateArtistVaultAsset(rootPath, workspaceId, assetId, patch)
        mirrorManifestToContext(rootPath, workspaceId, manifest, deps)
        return manifest
      })
    },
  )

  server.handle(
    RPC_CHANNELS.artistVault.SAVE_OUTPUT_ASSET,
    async (_ctx, workspaceId: string, outputId: string, assetId?: string, options?: VaultAssetImportOptions): Promise<VaultAssetImportResult> => {
      const target = resolveArtistVaultTarget(workspaceId)
      const rootPath = target.rootPath
      return withWorkspaceMutex(rootPath, async () => {
        const assetPath = selectOutputAssetPath(workspaceId, outputId, assetId)
        const result = await importArtistVaultAssetsAsync(rootPath, target.id, [assetPath], options ?? {})
        mirrorManifestToContext(rootPath, target.id, result.manifest, deps)
        return result
      })
    },
  )

  server.handle(RPC_CHANNELS.artistVault.SCAN, async (_ctx, workspaceId: string): Promise<VaultAssetScanResult> => {
    const rootPath = resolveRootPath(workspaceId)
    return withWorkspaceMutex(rootPath, async () => {
      const result = await scanArtistVaultAsync(rootPath, workspaceId)
      mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
      return result
    })
  })

  server.handle(RPC_CHANNELS.artistVault.OPEN_FOLDER, async (ctx, workspaceId: string): Promise<boolean> => {
    const rootPath = resolveRootPath(workspaceId)
    const vaultRoot = getArtistVaultRoot(rootPath)
    ensureArtistVaultFolders(rootPath)
    const result = await requestClientOpenPath(server, ctx.clientId, vaultRoot)
    return !result.error
  })
}

function dialogTitle(kindHint: VaultKindHint): string {
  if (kindHint === 'master-final') return 'Add Final Master'
  if (kindHint === 'demo') return 'Add Demo'
  if (kindHint === 'raw-footage') return 'Add Raw Footage'
  if (kindHint === 'cover-art') return 'Add Cover Art'
  if (kindHint === 'artist-photo') return 'Add Press Photo'
  if (kindHint === 'face-reference') return 'Add Face Reference'
  if (kindHint === 'contract') return 'Add Contract'
  if (kindHint === 'ad-asset') return 'Add Ad Asset'
  return 'Add Artist Vault Assets'
}

function dialogFilters(kindHint: VaultKindHint): Array<{ name: string; extensions: string[] }> {
  if (kindHint === 'master-final' || kindHint === 'demo') {
    return [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a'] }]
  }
  if (kindHint === 'raw-footage' || kindHint === 'ad-asset') {
    return [{ name: 'Video', extensions: ['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm'] }]
  }
  if (kindHint === 'cover-art' || kindHint === 'artist-photo' || kindHint === 'face-reference') {
    return [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'psd', 'ai', 'tif', 'tiff'] }]
  }
  if (kindHint === 'contract') {
    return [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'rtf'] }]
  }
  return [
    { name: 'Artist Vault Assets', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a', 'mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'psd', 'ai', 'tif', 'tiff', 'txt', 'md', 'docx', 'pdf', 'rtf'] },
    { name: 'All Files', extensions: ['*'] },
  ]
}
