/**
 * RPC handlers for Share Intel.
 *
 * Share Intel is internal-only: it reads a chat, distills durable nuggets,
 * and writes targeted workspace context docs. It never triggers external
 * tools or user-visible side effects beyond context writes + a toast result.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  loadAllContextDocs,
  upsertContextDoc,
  type LoadedContextDoc,
} from '@craft-agent/shared/workspace-context'
import {
  loadAllGlobalAgents,
  loadActivatedAgents,
} from '@craft-agent/shared/agent-definitions'
import {
  buildSharedIntelDocs,
  extractSharedIntelCandidates,
  isSharedIntelContextSlug,
  parseSharedIntelNote,
  type ExistingSharedIntelDoc,
  type ShareIntelRequest,
  type ShareIntelResult,
  type SharedIntelAgentCatalogEntry,
} from '@craft-agent/shared/shared-intel'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { refreshHqStateContextDocBestEffort } from '../../hq-state/refresh'

const workspaceMutexes = new Map<string, Promise<void>>()

function withWorkspaceMutex<T>(workspaceRootPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = workspaceMutexes.get(workspaceRootPath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  workspaceMutexes.set(workspaceRootPath, next.then(() => {}, () => {}))
  return next
}

function broadcastContextChanged(deps: HandlerDeps, workspaceId: string, docs: LoadedContextDoc[]): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, docs)
}

function errorResult(message: string): ShareIntelResult {
  return {
    ok: false,
    status: 'error',
    notes: [],
    toast: {
      title: 'Could not share intel',
      description: message,
    },
    error: message,
  }
}

function noIntelResult(): ShareIntelResult {
  return {
    ok: true,
    status: 'no_durable_intel',
    notes: [],
    toast: { title: 'No durable intel found' },
  }
}

function noTargetsResult(): ShareIntelResult {
  return {
    ok: true,
    status: 'no_targets',
    notes: [],
    toast: {
      title: 'No matching workers found',
      description: 'The chat had useful context, but no active worker was a clear target.',
    },
  }
}

function resolveAgentCatalog(
  workspaceRootPath: string,
  provided: SharedIntelAgentCatalogEntry[] | undefined,
): SharedIntelAgentCatalogEntry[] {
  const installed = new Map(loadAllGlobalAgents().map((agent) => [agent.slug, agent]))
  const activeFallback = loadActivatedAgents(workspaceRootPath).map((agent) => ({
    slug: agent.slug,
    name: agent.metadata.name,
    description: agent.metadata.description,
    inputs: agent.metadata.inputs,
    outputs: agent.metadata.outputs,
    tags: agent.metadata.tags ?? [],
    visualAgent: agent.metadata.visualAgent,
    active: true,
  } satisfies SharedIntelAgentCatalogEntry))

  if (!provided?.length) return activeFallback

  const out: SharedIntelAgentCatalogEntry[] = []
  const seen = new Set<string>()
  for (const entry of provided) {
    const installedAgent = installed.get(entry.slug)
    if (!installedAgent || seen.has(entry.slug)) continue
    seen.add(entry.slug)
    out.push({
      slug: installedAgent.slug,
      name: entry.name || installedAgent.metadata.name,
      description: entry.description ?? installedAgent.metadata.description,
      inputs: entry.inputs ?? installedAgent.metadata.inputs,
      outputs: entry.outputs ?? installedAgent.metadata.outputs,
      tags: entry.tags ?? installedAgent.metadata.tags ?? [],
      visualAgent: entry.visualAgent ?? installedAgent.metadata.visualAgent,
      active: entry.active !== false,
    })
  }

  return out.length > 0 ? out : activeFallback
}

function loadExistingSharedIntelDocs(workspaceRootPath: string): ExistingSharedIntelDoc[] {
  return loadAllContextDocs(workspaceRootPath)
    .filter((doc) => isSharedIntelContextSlug(doc.slug))
    .map((doc) => {
      const note = parseSharedIntelNote(doc.body)
      return note ? { slug: doc.slug, note } : null
    })
    .filter((entry): entry is ExistingSharedIntelDoc => Boolean(entry))
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sharedIntel.SHARE,
] as const

export function registerSharedIntelHandlers(server: RpcServer, deps: HandlerDeps): void {
  const { sessionManager } = deps

  server.handle(RPC_CHANNELS.sharedIntel.SHARE, async (_ctx, input: ShareIntelRequest): Promise<ShareIntelResult> => {
    if (!input?.workspaceId || !input.sessionId) {
      return errorResult('workspaceId and sessionId are required.')
    }

    const workspace = getWorkspaceByNameOrId(input.workspaceId)
    if (!workspace) return errorResult(`Workspace not found: ${input.workspaceId}`)

    const session = await sessionManager.getSession(input.sessionId)
    if (!session) return errorResult(`Session not found: ${input.sessionId}`)
    if (session.workspaceId !== input.workspaceId) {
      return errorResult('Session does not belong to this workspace.')
    }

    const agentCatalog = resolveAgentCatalog(workspace.rootPath, input.agentCatalog)
    const sourceAgentSlug = input.sourceAgentSlug ?? session.spawnedFromAgent?.agentSlug ?? session.launchReceipt?.agent?.slug
    const sourceAgentName = input.sourceAgentName ?? session.spawnedFromAgent?.agentName ?? session.launchReceipt?.agent?.name
    const extractionInput = {
      sessionId: input.sessionId,
      sourceAgentSlug,
      sourceAgentName,
      messages: session.messages,
      agentCatalog,
      existingNotes: loadExistingSharedIntelDocs(workspace.rootPath),
      forceNew: input.forceNew,
    }
    const candidates = extractSharedIntelCandidates(extractionInput)
    if (candidates.length === 0) return noIntelResult()

    return withWorkspaceMutex(workspace.rootPath, async () => {
      const docs = buildSharedIntelDocs({
        ...extractionInput,
        existingNotes: loadExistingSharedIntelDocs(workspace.rootPath),
      })

      if (docs.length === 0) return noTargetsResult()

      for (const doc of docs) {
        upsertContextDoc(workspace.rootPath, {
          slug: doc.slug,
          metadata: {
            name: `Shared Intel - ${doc.note.title}`,
            description: `From ${doc.note.sourceAgentName ?? doc.note.sourceAgentSlug ?? 'chat'}. Targets: ${doc.targetAgents.map((agent) => agent.name).join(', ')}.`,
            routing: { mode: 'targeted', agents: doc.note.targetAgents },
            enabled: true,
          },
          body: doc.body,
        })
      }

      refreshHqStateContextDocBestEffort(workspace.rootPath)
      broadcastContextChanged(deps, input.workspaceId, loadAllContextDocs(workspace.rootPath))

      const targetNames = Array.from(new Set(docs.flatMap((doc) => doc.targetAgents.map((agent) => agent.name))))
      const updatedOnly = docs.every((doc) => doc.action === 'updated')
      const created = docs.filter((doc) => doc.action === 'created').length
      const updated = docs.filter((doc) => doc.action === 'updated').length
      return {
        ok: true,
        status: updatedOnly ? 'updated' : 'shared',
        notes: docs.map((doc) => ({
          id: doc.note.id,
          title: doc.note.title,
          summary: doc.note.summary,
          tags: doc.note.tags,
          targetAgents: doc.targetAgents.map((agent) => ({ slug: agent.slug, name: agent.name })),
          action: doc.action,
          contextDocSlug: doc.slug,
          routeReasons: doc.note.routeReasons,
        })),
        audit: {
          sourceSessionId: input.sessionId,
          sourceAgentSlug,
          created,
          updated,
          skipped: candidates.length - docs.length,
        },
        toast: {
          title: updatedOnly ? 'Updated shared intel' : `Shared to ${targetNames.slice(0, 3).join(', ')}`,
          description: targetNames.length > 3 ? `Also routed to ${targetNames.length - 3} more.` : undefined,
        },
      }
    })
  })
}
