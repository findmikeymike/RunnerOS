import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { LabInspirationSaveInput, LabInspirationStartInput } from '@craft-agent/shared/lab'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer, RequestContext } from '@craft-agent/server-core/transport'
import { LabInspirationService } from '../../lab/LabInspirationService'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.lab.INSPIRATION_START,
  RPC_CHANNELS.lab.INSPIRATION_LIST,
  RPC_CHANNELS.lab.INSPIRATION_CANCEL,
  RPC_CHANNELS.lab.INSPIRATION_SAVE,
] as const

export function registerLabInspirationHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Registration is inert: no source access, research or artist-data writes.
  const service = new LabInspirationService({
    getWorkspace: (id) => getWorkspaceByNameOrId(id) ?? undefined,
    getRunner: () => {
      if (!deps.getDeepResearchRunner) throw new Error('Research is unavailable on this host.')
      return deps.getDeepResearchRunner()
    },
  })
  const assertBoundWorkspace = (ctx: RequestContext, workspaceId: string) => {
    if (!workspaceId || ctx.workspaceId !== workspaceId) throw new Error('Open this Lab before accessing its inspiration journal.')
  }
  server.handle(RPC_CHANNELS.lab.INSPIRATION_START, (ctx, workspaceId: string, input: LabInspirationStartInput) => {
    assertBoundWorkspace(ctx, workspaceId)
    return service.start(workspaceId, input)
  })
  server.handle(RPC_CHANNELS.lab.INSPIRATION_LIST, (ctx, workspaceId: string) => {
    assertBoundWorkspace(ctx, workspaceId)
    return service.list(workspaceId)
  })
  server.handle(RPC_CHANNELS.lab.INSPIRATION_CANCEL, (ctx, workspaceId: string, editionId: string) => {
    assertBoundWorkspace(ctx, workspaceId)
    return service.cancel(workspaceId, editionId)
  })
  server.handle(RPC_CHANNELS.lab.INSPIRATION_SAVE, (ctx, workspaceId: string, input: LabInspirationSaveInput) => {
    assertBoundWorkspace(ctx, workspaceId)
    const result = service.save(workspaceId, input)
    // A lost client must not turn a completed save into an apparent failed write.
    try { server.push(RPC_CHANNELS.lab.UPDATED, { to: 'workspace', workspaceId }, workspaceId) }
    catch (error) { deps.platform.logger.warn('Lab inspiration saved; update notification was unavailable', error) }
    return result
  })
}
