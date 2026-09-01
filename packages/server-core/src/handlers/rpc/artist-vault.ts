import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId, getWorkspaces } from '@craft-agent/shared/config'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { relative, resolve } from 'node:path'
import {
  artistVaultContextMetadata,
  artistVaultContextSlug,
  ensureArtistVaultFolders,
  getArtistVaultRoot,
  importArtistVaultAssetsAsync,
  linkArtistVaultFolderAsync,
  loadArtistVaultManifest,
  planArtistVaultImports,
  resolveArtistVaultAssetPath,
  reviewArtistVaultTrackIntelligence,
  saveArtistVaultTrackDraft,
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
  type TrackIntelligenceReviewInput,
  type VaultTrackTranscribeOptions,
  type VaultTrackTranscribeResult,
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
import { transcribeLyricsLocally } from '../../track-intelligence/LyricsTranscriptionService'
import { verifiedArtistVaultManifestForAgents } from '../../track-intelligence/agent-visibility'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.artistVault.GET,
  RPC_CHANNELS.artistVault.PLAN_IMPORT,
  RPC_CHANNELS.artistVault.CHOOSE_FILES,
  RPC_CHANNELS.artistVault.IMPORT,
  RPC_CHANNELS.artistVault.LINK_FOLDER,
  RPC_CHANNELS.artistVault.UPDATE_ASSET,
  RPC_CHANNELS.artistVault.TRANSCRIBE_TRACK,
  RPC_CHANNELS.artistVault.REVIEW_TRACK,
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

function workspaceRelative(workspaceRootPath: string, path?: string | null): string | undefined {
  if (!path) return undefined
  return relative(workspaceRootPath, path).replace(/\\/g, '/')
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
  const agentManifest = verifiedArtistVaultManifestForAgents(workspaceRootPath, manifest)
  upsertContextDoc(workspaceRootPath, {
    slug: artistVaultContextSlug(),
    metadata: artistVaultContextMetadata(),
    body: serializeArtistVaultContext(agentManifest),
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
    RPC_CHANNELS.artistVault.TRANSCRIBE_TRACK,
    async (_ctx, workspaceId: string, options: VaultTrackTranscribeOptions): Promise<VaultTrackTranscribeResult> => {
      const rootPath = resolveRootPath(workspaceId)
      const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
      assertTeamPermission(rootPath, 'files.write')
      return withWorkspaceMutex(rootPath, async () => {
        let manifest = loadArtistVaultManifest(rootPath, workspaceId)
        const asset = manifest.assets.find((candidate) => candidate.id === options.assetId)
        if (!asset) return { ok: false, manifest, error: `Vault asset not found: ${options.assetId}` }
        if (!['master-final', 'demo', 'beat-instrumental', 'mix-reference'].includes(asset.kind)) {
          return { ok: false, manifest, asset, error: 'Track Intelligence is available for audio tracks only.' }
        }
        if (asset.trackIntelligence?.status === 'reviewed' && !options.force) {
          return { ok: false, manifest, asset, error: 'Reviewed track lyrics already exist. Choose re-analyze to replace the machine draft.' }
        }
        const audioFile = resolveArtistVaultAssetPath(rootPath, asset)
        if (!audioFile || !existsSync(audioFile)) {
          return { ok: false, manifest, asset, error: `Audio file is missing: ${asset.relativePath ?? asset.absolutePath ?? asset.id}` }
        }
        manifest = saveArtistVaultTrackDraft(rootPath, workspaceId, asset.id, {
          status: 'pending',
          schemaVersion: 1,
        })
        mirrorManifestToContext(rootPath, workspaceId, manifest, deps)

        try {
          const outDir = resolve(rootPath, 'vault', '.track-intelligence', asset.id)
          const payload = await transcribeLyricsLocally({
            workspaceRootPath: rootPath,
            audioFile,
            outDir,
            model: options.model,
          })
          if (!payload.ok) {
            manifest = saveArtistVaultTrackDraft(rootPath, workspaceId, asset.id, {
              status: 'failed',
              schemaVersion: 1,
              failureReason: payload.error ?? 'Transcription did not return lyrics.',
            })
            mirrorManifestToContext(rootPath, workspaceId, manifest, deps)
            return { ok: false, manifest, asset: manifest.assets.find((candidate) => candidate.id === asset.id), error: payload.error, blockers: payload.blockers }
          }
          const approvedLines = new Map((asset.trackIntelligence?.approved?.lyrics?.lines ?? []).map((line) => [line.id, line]))
          const machineLines: Array<{ text: string; startMs?: number; endMs?: number }> = payload.lyricLines?.length
            ? payload.lyricLines.map((line) => ({
              text: line.text,
              startMs: Math.max(0, Math.round(line.start_time * 1000)),
              endMs: Math.max(0, Math.round(line.end_time * 1000)),
            }))
            : (payload.lyricsText ?? '').split(/\r?\n/).map((text) => ({ text: text.trim() })).filter((line) => line.text)
          manifest = saveArtistVaultTrackDraft(rootPath, workspaceId, asset.id, {
            status: 'draft',
            schemaVersion: 1,
            draft: {
              id: `draft-${randomUUID()}`,
              lyrics: {
                timingSource: 'transcription',
                timingStatus: payload.lyricLines?.length ? 'ready' : 'needs-alignment',
                lines: machineLines.map((line, index) => {
                  const id = `line-${index + 1}`
                  const approved = approvedLines.get(id)
                  return {
                    id,
                    text: approved?.corrected ? approved.text : line.text,
                    startMs: line.startMs,
                    endMs: line.endMs,
                    corrected: approved?.corrected,
                  }
                }),
              },
              character: asset.trackIntelligence?.approved?.character,
              technical: asset.trackIntelligence?.approved?.technical,
              provenance: {
                engine: payload.engine,
                processedLocally: true,
                analyzedAt: new Date().toISOString(),
                transcriptRelativePath: workspaceRelative(rootPath, payload.transcriptJson),
                sourceSha256: payload.sourceSha256,
              },
            },
          })
          mirrorManifestToContext(rootPath, workspaceId, manifest, deps)
          return { ok: true, manifest, asset: manifest.assets.find((candidate) => candidate.id === asset.id) }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          manifest = saveArtistVaultTrackDraft(rootPath, workspaceId, asset.id, {
            status: 'failed',
            schemaVersion: 1,
            failureReason: message,
          })
          mirrorManifestToContext(rootPath, workspaceId, manifest, deps)
          return { ok: false, manifest, asset: manifest.assets.find((candidate) => candidate.id === asset.id), error: message }
        }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.artistVault.REVIEW_TRACK,
    async (ctx, workspaceId: string, input: TrackIntelligenceReviewInput): Promise<VaultManifest> => {
      const rootPath = resolveRootPath(workspaceId)
      const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
      assertTeamPermission(rootPath, 'files.write')
      return withWorkspaceMutex(rootPath, async () => {
        const manifest = reviewArtistVaultTrackIntelligence(rootPath, workspaceId, input, ctx.clientId)
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
