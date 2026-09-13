import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import { loadAllContextDocs } from '@craft-agent/shared/workspace-context';
import type { CareerResearchDeliveryInput, CareerResearchSeedInput, CareerResearchView } from '@craft-agent/shared/artist-context';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import { ArtistProfileEnrichmentService, type ArtistProfileEnrichmentMutationInput, type ArtistProfileEnrichmentStartInput } from '../../artist-profile-enrichment/ArtistProfileEnrichmentService';

export const HANDLED_CHANNELS = Object.values(RPC_CHANNELS.artistProfileEnrichment).filter((channel) => channel !== RPC_CHANNELS.artistProfileEnrichment.CHANGED);
let registeredService: ArtistProfileEnrichmentService | null = null;
let resolveRegisteredService: (() => ArtistProfileEnrichmentService | null) | null = null;
export function getArtistProfileEnrichmentService(): ArtistProfileEnrichmentService | null {
  return resolveRegisteredService?.() ?? null;
}

export function registerArtistProfileEnrichmentHandlers(server: RpcServer, deps: HandlerDeps): void {
  registeredService?.dispose();
  registeredService = null;
  resolveRegisteredService = null;
  if (!deps.getDeepResearchRunner) return;
  let service: ArtistProfileEnrichmentService | null = null;
  const resolveService = (): ArtistProfileEnrichmentService | null => {
    if (service) return service;
    // Headless RPC registration precedes SessionManager.initialize(). Desktop
    // hosts that already have a runner still subscribe immediately below.
    const runner = deps.getDeepResearchRunner?.();
    if (!runner) return null;
    service = new ArtistProfileEnrichmentService(runner, (workspaceId) => {
      try {
        const view = service!.get(workspaceId);
        const workspace = getWorkspaceByNameOrId(workspaceId);
        server.push(RPC_CHANNELS.artistProfileEnrichment.CHANGED, { to: 'all' }, workspaceId, view);
        if (workspace) server.push(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, loadAllContextDocs(workspace.rootPath));
      } catch {
        // The canonical write already succeeded. A disconnected/deleted view cannot roll it back.
      }
    });
    registeredService = service;
    return service;
  };
  const requireService = (): ArtistProfileEnrichmentService => {
    const ready = resolveService();
    if (!ready) throw new Error('Artist profile enrichment is not ready on this host.');
    return ready;
  };
  resolveRegisteredService = resolveService;
  resolveService();
  server.handle(RPC_CHANNELS.artistProfileEnrichment.GET, async (_ctx, workspaceId: string): Promise<CareerResearchView> => requireService().get(workspaceId));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UPDATE_SEEDS, async (_ctx, workspaceId: string, expectedRevision: number, input: CareerResearchSeedInput) => requireService().updateSeeds(workspaceId, expectedRevision, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UPDATE_DELIVERY, async (_ctx, workspaceId: string, expectedRevision: number, input: CareerResearchDeliveryInput) => requireService().updateDelivery(workspaceId, expectedRevision, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.START, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentStartInput) => requireService().start(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CANCEL, async (_ctx, workspaceId: string, runId: string, attempt: number) => requireService().cancel(workspaceId, runId, attempt));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CORRECT, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => requireService().correct(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.REMOVE, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => requireService().remove(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UNDO, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => requireService().undo(workspaceId, input));
}
