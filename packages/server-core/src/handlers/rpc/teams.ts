/**
 * RPC handlers for the global Teams library.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  deleteGlobalTeam,
  listTeamRuns,
  loadAllGlobalTeams,
  loadGlobalTeam,
  writeGlobalTeam,
  type CreateTeamInput,
  type LoadedTeam,
} from '@craft-agent/shared/teams'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

let libraryMutex: Promise<void> = Promise.resolve()
function withLibraryMutex<T>(fn: () => Promise<T>): Promise<T> {
  const next = libraryMutex.then(fn, fn)
  libraryMutex = next.then(() => {}, () => {})
  return next
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.teams.LIST_ALL,
  RPC_CHANNELS.teams.GET,
  RPC_CHANNELS.teams.UPSERT,
  RPC_CHANNELS.teams.DELETE,
] as const

export interface UpsertTeamPayload {
  slug: string
  metadata: CreateTeamInput['metadata']
  body: string
}

function broadcastChanged(deps: HandlerDeps): void {
  const wsServerLike = (deps as unknown as { wsServer?: { push?: (...args: unknown[]) => void } })
  wsServerLike.wsServer?.push?.(RPC_CHANNELS.teams.CHANGED, { to: 'all' }, loadAllGlobalTeams())
}

function assertNoActiveTeamRuns(deps: HandlerDeps, slug: string): void {
  const activeStates = new Set(['created', 'running', 'paused', 'blocked', 'review'])
  for (const workspace of deps.sessionManager.getWorkspaces()) {
    const activeRun = listTeamRuns(workspace.rootPath).find((run) => (
      run.teamSlug === slug && activeStates.has(run.state)
    ))
    if (activeRun) {
      throw new Error(`Cannot delete team "${slug}" while run "${activeRun.id}" is ${activeRun.state}. Cancel or complete active runs first.`)
    }
  }
}

export function registerTeamsHandlers(server: RpcServer, deps: HandlerDeps): void {
  server.handle(RPC_CHANNELS.teams.LIST_ALL, async (): Promise<LoadedTeam[]> => {
    return loadAllGlobalTeams()
  })

  server.handle(RPC_CHANNELS.teams.GET, async (_ctx, slug: string): Promise<LoadedTeam | null> => {
    return loadGlobalTeam(slug)
  })

  server.handle(RPC_CHANNELS.teams.UPSERT, async (_ctx, payload: UpsertTeamPayload): Promise<LoadedTeam> => {
    return withLibraryMutex(async () => {
      const loaded = writeGlobalTeam({
        slug: payload.slug,
        metadata: payload.metadata,
        body: payload.body,
      })
      broadcastChanged(deps)
      return loaded
    })
  })

  server.handle(RPC_CHANNELS.teams.DELETE, async (_ctx, slug: string): Promise<boolean> => {
    return withLibraryMutex(async () => {
      assertNoActiveTeamRuns(deps, slug)
      const ok = deleteGlobalTeam(slug)
      if (ok) broadcastChanged(deps)
      return ok
    })
  })
}
