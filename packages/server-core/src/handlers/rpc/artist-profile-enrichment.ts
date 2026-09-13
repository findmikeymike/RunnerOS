import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config';
import { loadAllContextDocs } from '@craft-agent/shared/workspace-context';
import type { CareerResearchDeliveryInput, CareerResearchSeedInput, CareerResearchView } from '@craft-agent/shared/artist-context';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import { ArtistProfileEnrichmentService, type ArtistProfileEnrichmentMutationInput, type ArtistProfileEnrichmentStartInput } from '../../artist-profile-enrichment/ArtistProfileEnrichmentService';

export const HANDLED_CHANNELS = Object.values(RPC_CHANNELS.artistProfileEnrichment).filter((channel) => channel !== RPC_CHANNELS.artistProfileEnrichment.CHANGED);
let registeredService: ArtistProfileEnrichmentService | null = null;
export function getArtistProfileEnrichmentService(): ArtistProfileEnrichmentService | null { return registeredService; }

export function registerArtistProfileEnrichmentHandlers(server: RpcServer, deps: HandlerDeps): void {
  if (!deps.getDeepResearchRunner) return;
  let service!: ArtistProfileEnrichmentService;
  service = new ArtistProfileEnrichmentService(deps.getDeepResearchRunner(), (workspaceId) => {
    try {
      const view = service.get(workspaceId);
      const workspace = getWorkspaceByNameOrId(workspaceId);
      server.push(RPC_CHANNELS.artistProfileEnrichment.CHANGED, { to: 'all' }, workspaceId, view);
      if (workspace) server.push(RPC_CHANNELS.workspaceContext.CHANGED, { to: 'all' }, workspaceId, loadAllContextDocs(workspace.rootPath));
    } catch {
      // The canonical write already succeeded. A disconnected/deleted view cannot roll it back.
    }
  });
  registeredService = service;
  server.handle(RPC_CHANNELS.artistProfileEnrichment.GET, async (_ctx, workspaceId: string): Promise<CareerResearchView> => service.get(workspaceId));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UPDATE_SEEDS, async (_ctx, workspaceId: string, expectedRevision: number, input: CareerResearchSeedInput) => service.updateSeeds(workspaceId, expectedRevision, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UPDATE_DELIVERY, async (_ctx, workspaceId: string, expectedRevision: number, input: CareerResearchDeliveryInput) => service.updateDelivery(workspaceId, expectedRevision, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.START, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentStartInput) => service.start(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CANCEL, async (_ctx, workspaceId: string, runId: string, attempt: number) => service.cancel(workspaceId, runId, attempt));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CORRECT, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => service.correct(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.REMOVE, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => service.remove(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UNDO, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => service.undo(workspaceId, input));
}
