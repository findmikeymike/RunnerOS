import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  getMissionAssetsRoot,
  ensureMissionAssetsFolders,
  importMissionAssetsAsync,
  loadMissionAssetManifest,
  missionAssetContextMetadata,
  missionAssetContextSlug,
  planMissionAssetImports,
  saveMissionLyricsAsync,
  scanMissionAssetsAsync,
  selectMissionAudioForLyrics,
  serializeMissionAssetContext,
  type MissionAssetImportCandidate,
  type MissionAssetImportOptions,
  type MissionAssetImportResult,
  type MissionAssetKindHint,
  type MissionAssetManifest,
  type MissionAssetSaveLyricsInput,
  type MissionAssetSaveLyricsResult,
  type MissionAssetScanResult,
  type MissionAssetTranscribeLyricsOptions,
  type MissionAssetTranscribeLyricsResult,
} from '@craft-agent/shared/mission-assets'
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
import { refreshArtistManagerStateForWorkspaceBestEffort } from '../../hq-state/refresh'
import { transcribeLyricsLocally } from '../../track-intelligence/LyricsTranscriptionService'
import { verifiedMissionAssetManifestForAgents } from '../../track-intelligence/agent-visibility'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.missionAssets.GET,
  RPC_CHANNELS.missionAssets.PLAN_IMPORT,
  RPC_CHANNELS.missionAssets.CHOOSE_FILES,
  RPC_CHANNELS.missionAssets.IMPORT,
  RPC_CHANNELS.missionAssets.TRANSCRIBE_LYRICS,
  RPC_CHANNELS.missionAssets.SAVE_LYRICS,
  RPC_CHANNELS.missionAssets.SCAN,
  RPC_CHANNELS.missionAssets.OPEN_FOLDER,
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

function broadcastContextChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

function mirrorManifestToContext(workspaceRootPath: string, workspaceId: string, manifest: MissionAssetManifest, deps: HandlerDeps): void {
  const agentManifest = verifiedMissionAssetManifestForAgents(workspaceRootPath, manifest)
  upsertContextDoc(workspaceRootPath, {
    slug: missionAssetContextSlug(),
    metadata: missionAssetContextMetadata(),
    body: serializeMissionAssetContext(agentManifest),
  })
  refreshArtistManagerStateForWorkspaceBestEffort(workspaceRootPath)
  broadcastContextChanged(deps, workspaceId, loadAllContextDocs(workspaceRootPath))
}

function workspaceRelative(workspaceRootPath: string, path?: string | null): string | undefined {
  if (!path) return undefined
  return relative(workspaceRootPath, path).replace(/\\/g, '/')
}

function missionAssetAbsolutePath(workspaceRootPath: string, asset: { relativePath?: string; absolutePath?: string }): string | null {
  if (asset.relativePath) return resolve(workspaceRootPath, asset.relativePath)
  return asset.absolutePath ?? null
}

export function registerMissionAssetsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.missionAssets.GET, async (_ctx, workspaceId: string): Promise<MissionAssetManifest> => {
    const rootPath = resolveRootPath(workspaceId)
    return loadMissionAssetManifest(rootPath, workspaceId)
  })

  server.handle(
    RPC_CHANNELS.missionAssets.PLAN_IMPORT,
    async (_ctx, workspaceId: string, filePaths: string[], options?: MissionAssetImportOptions): Promise<{
      candidates: MissionAssetImportCandidate[]
      skipped: Array<{ path: string; reason: string }>
    }> => {
      const rootPath = resolveRootPath(workspaceId)
      return planMissionAssetImports(rootPath, filePaths, options ?? {})
    },
  )

  server.handle(
    RPC_CHANNELS.missionAssets.CHOOSE_FILES,
    async (ctx, workspaceId: string, kindHint: MissionAssetKindHint = 'any'): Promise<string[]> => {
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
    RPC_CHANNELS.missionAssets.IMPORT,
    async (_ctx, workspaceId: string, filePaths: string[], options?: MissionAssetImportOptions): Promise<MissionAssetImportResult> => {
      const rootPath = resolveRootPath(workspaceId)
      const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
      assertTeamPermission(rootPath, 'files.write')
      return withWorkspaceMutex(rootPath, async () => {
        const result = await importMissionAssetsAsync(rootPath, workspaceId, filePaths, options ?? {})
        mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
        return result
      })
    },
  )

  server.handle(
    RPC_CHANNELS.missionAssets.TRANSCRIBE_LYRICS,
    async (_ctx, workspaceId: string, options?: MissionAssetTranscribeLyricsOptions): Promise<MissionAssetTranscribeLyricsResult> => {
      const rootPath = resolveRootPath(workspaceId)
      const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
      assertTeamPermission(rootPath, 'files.write')
      return withWorkspaceMutex(rootPath, async () => {
        const manifest = loadMissionAssetManifest(rootPath, workspaceId)
        const audioAsset = selectMissionAudioForLyrics(manifest, options?.audioAssetId)
        if (!audioAsset) {
          return { ok: false, manifest, error: 'Add a master or demo before transcribing lyrics.' }
        }
        const lyricsForAudio = manifest.files.filter((asset) => (
          asset.kind === 'lyrics'
            && asset.status === 'available'
            && asset.lyrics?.sourceAudioAssetId === audioAsset.id
        ))
        const approvedLyrics = lyricsForAudio.find((asset) => !asset.lyrics?.reviewRequired)
        const draftLyrics = lyricsForAudio.find((asset) => asset.lyrics?.reviewRequired)
        if (approvedLyrics && !options?.force) {
          return {
            ok: false,
            manifest,
            lyricsAsset: approvedLyrics,
            audioAsset,
            error: 'Approved lyrics already exist for this audio. Choose re-analyze to create a new draft.',
          }
        }
        const audioFile = missionAssetAbsolutePath(rootPath, audioAsset)
        if (!audioFile || !existsSync(audioFile)) {
          return { ok: false, manifest, audioAsset, error: `Audio file is missing: ${audioAsset.relativePath ?? audioAsset.absolutePath ?? audioAsset.id}` }
        }
        const outDir = resolve(rootPath, 'assets', 'docs', 'lyrics', `${audioAsset.id}-transcript`)
        try {
          const payload = await transcribeLyricsLocally({
            workspaceRootPath: rootPath,
            audioFile,
            outDir,
            model: options?.model,
          })
          if (!payload.ok) {
            return { ok: false, manifest, audioAsset, error: payload.error ?? 'Transcription did not return lyrics.', blockers: payload.blockers }
          }
          const saved = await saveMissionLyricsAsync(rootPath, workspaceId, {
            lyricsText: payload.lyricsText ?? '',
            lyricLines: payload.lyricLines,
            assetId: draftLyrics?.id,
            sourceAudioAssetId: audioAsset.id,
            transcriptRelativePath: workspaceRelative(rootPath, payload.transcriptJson),
            model: payload.model,
            engine: payload.engine,
            generatedAt: new Date().toISOString(),
            sourceSha256: payload.sourceSha256,
            reviewRequired: true,
            status: 'machine',
          })
          mirrorManifestToContext(rootPath, workspaceId, saved.manifest, deps)
          return { ok: true, manifest: saved.manifest, lyricsAsset: saved.lyricsAsset, audioAsset }
        } catch (err) {
          return { ok: false, manifest, audioAsset, error: err instanceof Error ? err.message : String(err) }
        }
      })
    },
  )

  server.handle(
    RPC_CHANNELS.missionAssets.SAVE_LYRICS,
    async (ctx, workspaceId: string, input: MissionAssetSaveLyricsInput): Promise<MissionAssetSaveLyricsResult> => {
      const rootPath = resolveRootPath(workspaceId)
      const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
      assertTeamPermission(rootPath, 'files.write')
      return withWorkspaceMutex(rootPath, async () => {
        const { sourceSha256: _untrustedSourceSha256, ...reviewInput } = input
        const result = await saveMissionLyricsAsync(rootPath, workspaceId, {
          ...reviewInput,
          reviewRequired: false,
          status: 'approved',
        }, ctx.clientId)
        mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
        return result
      })
    },
  )

  server.handle(RPC_CHANNELS.missionAssets.SCAN, async (_ctx, workspaceId: string): Promise<MissionAssetScanResult> => {
    const rootPath = resolveRootPath(workspaceId)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(rootPath, 'files.write')
    return withWorkspaceMutex(rootPath, async () => {
      const result = await scanMissionAssetsAsync(rootPath, workspaceId)
      mirrorManifestToContext(rootPath, workspaceId, result.manifest, deps)
      return result
    })
  })

  server.handle(RPC_CHANNELS.missionAssets.OPEN_FOLDER, async (ctx, workspaceId: string): Promise<boolean> => {
    const rootPath = resolveRootPath(workspaceId)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(rootPath, 'files.write')
    const assetsRoot = getMissionAssetsRoot(rootPath)
    ensureMissionAssetsFolders(rootPath)
    const result = await requestClientOpenPath(server, ctx.clientId, assetsRoot)
    return !result.error
  })
}

function dialogTitle(kindHint: MissionAssetKindHint): string {
  if (kindHint === 'master') return 'Add Master'
  if (kindHint === 'lyrics') return 'Add Lyrics'
  if (kindHint === 'cover-art') return 'Add Cover Art'
  return 'Add Mission Assets'
}

function dialogFilters(kindHint: MissionAssetKindHint): Array<{ name: string; extensions: string[] }> {
  if (kindHint === 'master') {
    return [{ name: 'Audio', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a'] }]
  }
  if (kindHint === 'lyrics') {
    return [{ name: 'Lyrics/Documents', extensions: ['txt', 'md', 'docx', 'pdf', 'rtf'] }]
  }
  if (kindHint === 'cover-art') {
    return [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'psd', 'ai', 'tif', 'tiff'] }]
  }
  return [
    { name: 'Mission Assets', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a', 'mov', 'mp4', 'm4v', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'psd', 'ai', 'txt', 'md', 'docx', 'pdf', 'rtf'] },
    { name: 'All Files', extensions: ['*'] },
  ]
}
