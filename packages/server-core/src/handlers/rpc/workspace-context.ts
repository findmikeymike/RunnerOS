import { rebuildCareerResearchProjection } from '@craft-agent/shared/artist-context/career-research-storage';
/**
 * RPC handlers for per-workspace context docs.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  loadAllContextDocs,
  loadContextDoc,
  upsertContextDoc,
  deleteContextDoc,
  type UpsertContextDocInput,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadGlobalAgent, resolveAgentTaskMode, isAgentAllowedInArtistWorkspace, type ResolvedAgentTaskMode } from '@craft-agent/shared/agent-definitions'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { prepareAgentLaunchContext } from '../../agent-launch/context'
export { selectContextDocsForAgentLaunch } from '../../agent-launch/context'
import { withWorkspaceContextLock } from '../../scheduled-work/workspace-context-lock'
import { ARTIST_CAREER_RESEARCH_CONTEXT_SLUG } from '@craft-agent/shared/artist-context'
import { FEATURE_FLAGS } from '@craft-agent/shared/feature-flags'
import { getArtistProfileEnrichmentService } from './artist-profile-enrichment'
import {
  refreshArtistManagerStateForWorkspaceBestEffort,
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

export function visibleContextDocs(docs: LoadedContextDoc[]): LoadedContextDoc[] {
  return FEATURE_FLAGS.artistProfileEnrichmentV2
    ? docs
    : docs.filter(doc => doc.slug !== ARTIST_CAREER_RESEARCH_CONTEXT_SLUG)
}

function resolveRootPath(workspaceId: string): string {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
  return workspace.rootPath
}

function refreshManagedProjection(rootPath: string): void {
  if (FEATURE_FLAGS.artistProfileEnrichmentV2) rebuildCareerResearchProjection(rootPath)
}

export function registerWorkspaceContextHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.workspaceContext.LIST, async (_ctx, workspaceId: string): Promise<LoadedContextDoc[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return []
    refreshManagedProjection(workspace.rootPath)
    return visibleContextDocs(loadAllContextDocs(workspace.rootPath))
  })

  server.handle(RPC_CHANNELS.workspaceContext.GET, async (_ctx, workspaceId: string, slug: string): Promise<LoadedContextDoc | null> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null
    if (!FEATURE_FLAGS.artistProfileEnrichmentV2 && slug === ARTIST_CAREER_RESEARCH_CONTEXT_SLUG) return null
    if (slug === ARTIST_CAREER_RESEARCH_CONTEXT_SLUG) refreshManagedProjection(workspace.rootPath)
    return loadContextDoc(workspace.rootPath, slug)
  })

  server.handle(RPC_CHANNELS.workspaceContext.LIST_FOR_AGENT, async (_ctx, workspaceId: string, agentSlug: string | null, taskModeId?: string): Promise<LoadedContextDoc[]> => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      if (taskModeId !== undefined) throw new Error(`Workspace not found: ${workspaceId}`)
      return []
    }
    refreshManagedProjection(workspace.rootPath)
    let taskMode: ResolvedAgentTaskMode | undefined
    if (taskModeId !== undefined) {
      if (!agentSlug || typeof taskModeId !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(taskModeId)) {
        throw new Error('Choose a valid agent and focus before loading focused context.')
      }
      if (!isAgentAllowedInArtistWorkspace(agentSlug, workspace.artistWorkspaceScope)) throw new Error('This worker is unavailable in this workspace.')
      const agent = loadGlobalAgent(agentSlug)
      if (!agent) throw new Error(`Agent not found: ${agentSlug}`)
      taskMode = resolveAgentTaskMode(agent, taskModeId)
    }
    return prepareAgentLaunchContext(workspace, agentSlug, taskMode)
  })

  server.handle(RPC_CHANNELS.workspaceContext.UPSERT, async (_ctx, workspaceId: string, payload: UpsertContextDocPayload): Promise<LoadedContextDoc> => {
    const rootPath = resolveRootPath(workspaceId)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(rootPath, 'files.write')
    if (payload.slug === ARTIST_CAREER_RESEARCH_CONTEXT_SLUG) {
      if (!FEATURE_FLAGS.artistProfileEnrichmentV2) throw new Error('Artist profile enrichment is parked for V2.')
      const current = loadContextDoc(rootPath, payload.slug)
      if (!Object.prototype.hasOwnProperty.call(payload, 'expectedBody')) throw new Error('MANAGED_CONTEXT: Expected body is required for career context settings.');
      assertExpectedContextBody(payload.slug, current?.body ?? null, payload.expectedBody ?? null)
      if (!current || payload.body !== current.body) throw new Error('MANAGED_CONTEXT: Career findings must be edited from Profile.');
      const service = getArtistProfileEnrichmentService()
      if (!service) throw new Error('Artist profile enrichment is unavailable on this host.')
      const view = service.get(workspaceId)
      await service.updateDelivery(workspaceId, view.revision, {
        enabled: payload.metadata.enabled,
        routing: payload.metadata.routing,
        delivery: payload.metadata.delivery,
      })
      return loadContextDoc(rootPath, payload.slug)!
    }
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
      broadcastChanged(deps, workspaceId, visibleContextDocs(loadAllContextDocs(rootPath)))
      return loaded
    })
  })

  server.handle(RPC_CHANNELS.workspaceContext.DELETE, async (_ctx, workspaceId: string, slug: string): Promise<boolean> => {
    const rootPath = resolveRootPath(workspaceId)
    const { assertTeamPermission } = await import('@craft-agent/shared/workspaces')
    assertTeamPermission(rootPath, 'files.write')
    if (slug === ARTIST_CAREER_RESEARCH_CONTEXT_SLUG) throw new Error('MANAGED_CONTEXT: Career context can be disabled or edited from Profile, not deleted here.')
    return withWorkspaceContextLock(rootPath, async () => {
      const ok = deleteContextDoc(rootPath, slug)
      if (ok) {
        if (shouldRefreshHqStateForContextSlug(slug)) {
          refreshArtistManagerStateForWorkspaceBestEffort(rootPath)
        }
        broadcastChanged(deps, workspaceId, visibleContextDocs(loadAllContextDocs(rootPath)))
      }
      return ok
    })
  })
}
