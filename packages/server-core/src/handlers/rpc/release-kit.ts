import { mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  type PromoteToReleaseKitInput,
  type ReleaseKitItemDetail,
  type ReleaseKitManifest,
  type ReleaseKitMigrationResult,
  type ReleaseKitVerificationResult,
} from '@craft-agent/shared/release-kit'
import { loadAllContextDocs } from '@craft-agent/shared/workspace-context'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  requestClientOpenFileDialog,
  requestClientOpenPath,
} from '@craft-agent/server-core/transport'
import { ReleaseKitService } from '../../release-kit/ReleaseKitService'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.releaseKit.GET,
  RPC_CHANNELS.releaseKit.GET_ITEM,
  RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD,
  RPC_CHANNELS.releaseKit.PROMOTE,
  RPC_CHANNELS.releaseKit.REMOVE,
  RPC_CHANNELS.releaseKit.SET_PRIMARY,
  RPC_CHANNELS.releaseKit.VERIFY,
  RPC_CHANNELS.releaseKit.MIGRATE_LEGACY,
  RPC_CHANNELS.releaseKit.OPEN_FOLDER,
] as const

export function registerReleaseKitHandlers(server: RpcServer, deps: HandlerDeps): void {
  const service = new ReleaseKitService({
    onChanged: (workspaceId, manifest) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      const wsServerLike = deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } }
      wsServerLike.wsServer?.push?.(RPC_CHANNELS.releaseKit.CHANGED, { to: 'all' }, workspaceId, manifest)
      if (workspace?.rootPath) {
        wsServerLike.wsServer?.push?.(
          RPC_CHANNELS.workspaceContext.CHANGED,
          { to: 'all' },
          workspaceId,
          loadAllContextDocs(workspace.rootPath),
        )
      }
    },
  })

  server.handle(RPC_CHANNELS.releaseKit.GET, async (_ctx, workspaceId: string): Promise<ReleaseKitManifest> => (
    service.get(workspaceId)
  ))

  server.handle(
    RPC_CHANNELS.releaseKit.GET_ITEM,
    async (_ctx, workspaceId: string, itemId: string): Promise<ReleaseKitItemDetail> => service.getItem(workspaceId, itemId),
  )

  server.handle(
    RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD,
    async (ctx, workspaceId: string): Promise<{ path: string; originalFileName: string } | null> => {
      service.get(workspaceId)
      const result = await requestClientOpenFileDialog(server, ctx.clientId, {
        title: 'Add to Release Kit',
        properties: ['openFile'],
        filters: [
          { name: 'Release Assets', extensions: ['wav', 'aiff', 'aif', 'flac', 'mp3', 'm4a', 'mov', 'mp4', 'm4v', 'webm', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'psd', 'ai', 'tif', 'tiff', 'txt', 'md', 'docx', 'pdf', 'rtf', 'csv', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      const path = result.canceled ? undefined : result.filePaths[0]
      return path ? { path, originalFileName: basename(path) } : null
    },
  )

  server.handle(
    RPC_CHANNELS.releaseKit.PROMOTE,
    async (_ctx, workspaceId: string, input: PromoteToReleaseKitInput) => {
      await assertReleaseKitWrite(workspaceId)
      return service.promote(workspaceId, input, 'user')
    },
  )

  server.handle(
    RPC_CHANNELS.releaseKit.REMOVE,
    async (_ctx, workspaceId: string, itemId: string): Promise<ReleaseKitManifest> => {
      await assertReleaseKitWrite(workspaceId)
      return service.remove(workspaceId, itemId)
    },
  )

  server.handle(
    RPC_CHANNELS.releaseKit.SET_PRIMARY,
    async (_ctx, workspaceId: string, itemId: string): Promise<ReleaseKitManifest> => {
      await assertReleaseKitWrite(workspaceId)
      return service.setPrimary(workspaceId, itemId)
    },
  )

  server.handle(
    RPC_CHANNELS.releaseKit.VERIFY,
    async (_ctx, workspaceId: string): Promise<ReleaseKitVerificationResult> => {
      await assertReleaseKitWrite(workspaceId)
      return service.verify(workspaceId)
    },
  )

  server.handle(
    RPC_CHANNELS.releaseKit.MIGRATE_LEGACY,
    async (_ctx, workspaceId: string): Promise<ReleaseKitMigrationResult> => {
      await assertReleaseKitWrite(workspaceId)
      return service.migrateLegacy(workspaceId)
    },
  )

  server.handle(RPC_CHANNELS.releaseKit.OPEN_FOLDER, async (ctx, workspaceId: string): Promise<boolean> => {
    const root = service.getRoot(workspaceId)
    mkdirSync(root, { recursive: true })
    const result = await requestClientOpenPath(server, ctx.clientId, root)
    return !result.error
  })
}

async function assertReleaseKitWrite(workspaceId: string): Promise<void> {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
  assertTeamPermission(workspace.rootPath, 'files.write')
}
