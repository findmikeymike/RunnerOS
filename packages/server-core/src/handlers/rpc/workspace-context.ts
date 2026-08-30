/**
 * RPC handlers for per-workspace context docs.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadAllContextDocs,
  loadContextDoc,
  loadPromptContextDocsForAgent,
  upsertContextDoc,
  deleteContextDoc,
  type UpsertContextDocInput,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { CONCIERGE_SLUG } from '@craft-agent/shared/agent-definitions'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'
import {
  refreshArtistManagerStateForWorkspaceBestEffort,
  refreshCampaignStateContextDocBestEffort,
  refreshHqStateContextDocBestEffort,
  shouldRefreshHqStateForContextSlug,
} from '../../hq-state/refresh'

/**
 * One mutex per workspace. Context docs are tiny and the contention surface
 * is small, but two concurrent upserts to the same workspace could still
 * race the loader. A per-workspace lock matches the agent-definitions style.
 */

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.workspaceContext.LIST,
  RPC_CHANNELS.workspaceContext.GET,
  RPC_CHANNELS.workspaceContext.LIST_FOR_AGENT,
  RPC_CHANNELS.workspaceContext.UPSERT,
  RPC_CHANNELS.workspaceContext.DELETE,
] as const

export interface UpsertContextDocPayload {
  slug: string
  metadata: UpsertContextDocInput['metadata']
  body: string
  expectedBody?: string | null
}

export function assertExpectedContextBody(
  slug: string,
  currentBody: string | null,
  expectedBody: string | null,
): void {
  if (currentBody !== expectedBody) {
    throw new Error(`CONTEXT_DOC_CONFLICT: ${slug} changed before this update was saved.`)
  }
}

function broadcastChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

export function registerWorkspaceContextHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.workspaceContext.LIST, async (_ctx, workspaceId: string): Promise<LoadedContextDoc[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    return loadAllContextDocs(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.workspaceContext.GET, async (_ctx, workspaceId: string, slug: string): Promise<LoadedContextDoc | null> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null
    return loadContextDoc(workspace.rootPath, slug)
  })

  server.handle(RPC_CHANNELS.workspaceContext.LIST_FOR_AGENT, async (_ctx, workspaceId: string, agentSlug: string | null): Promise<LoadedContextDoc[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    if (agentSlug?.trim().toLowerCase() === CONCIERGE_SLUG && workspace.artistWorkspaceScope === 'hq') {
      refreshHqStateContextDocBestEffort(workspace.rootPath)
    } else if (agentSlug?.trim().toLowerCase() === CONCIERGE_SLUG && workspace.artistWorkspaceScope === 'campaign') {
      refreshCampaignStateContextDocBestEffort(workspace.rootPath)
    }
    return loadPromptContextDocsForAgent(workspace.rootPath, agentSlug)
  })

  server.handle(RPC_CHANNELS.workspaceContext.UPSERT, async (_ctx, workspaceId: string, payload: UpsertContextDocPayload): Promise<LoadedContextDoc> => {
    const rootPath = resolveRootPath(workspaceId)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(rootPath, 'files.write')
    return withWorkspaceContextLock(rootPath, async () => {
      if (Object.prototype.hasOwnProperty.call(payload, 'expectedBody')) {
        const currentBody = loadContextDoc(rootPath, payload.slug)?.body ?? null
        assertExpectedContextBody(payload.slug, currentBody, payload.expectedBody ?? null)
      }
      const loaded = upsertContextDoc(rootPath, {
        slug: payload.slug,
        metadata: payload.metadata,
        body: payload.body,
      })
      if (shouldRefreshHqStateForContextSlug(payload.slug)) {
        refreshArtistManagerStateForWorkspaceBestEffort(rootPath)
      }
      broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
      return loaded
    })
  })

  server.handle(RPC_CHANNELS.workspaceContext.DELETE, async (_ctx, workspaceId: string, slug: string): Promise<boolean> => {
    const rootPath = resolveRootPath(workspaceId)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(rootPath, 'files.write')
    return withWorkspaceContextLock(rootPath, async () => {
      const ok = deleteContextDoc(rootPath, slug)
      if (ok) {
        if (shouldRefreshHqStateForContextSlug(slug)) {
          refreshArtistManagerStateForWorkspaceBestEffort(rootPath)
        }
        broadcastChanged(deps, workspaceId, loadAllContextDocs(rootPath))
      }
      return ok
    })
  })
}
