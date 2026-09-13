import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { CareerResearchDeliveryInput, CareerResearchSeedInput, CareerResearchView } from '@craft-agent/shared/artist-context';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import type { ArtistProfileEnrichmentMutationInput, ArtistProfileEnrichmentStartInput } from '../../artist-profile-enrichment/ArtistProfileEnrichmentService';

export const HANDLED_CHANNELS = Object.values(RPC_CHANNELS.artistProfileEnrichment).filter((channel) => channel !== RPC_CHANNELS.artistProfileEnrichment.CHANGED);
export function registerArtistProfileEnrichmentHandlers(server: RpcServer, deps: HandlerDeps): void {
  if (!deps.getArtistProfileEnrichmentService) return;
  const service = async () => {
    await deps.sessionManager.waitForInit();
    return deps.getArtistProfileEnrichmentService!();
  };
  server.handle(RPC_CHANNELS.artistProfileEnrichment.GET, async (_ctx, workspaceId: string): Promise<CareerResearchView> => (await service()).get(workspaceId));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UPDATE_SEEDS, async (_ctx, workspaceId: string, expectedRevision: number, input: CareerResearchSeedInput) => (await service()).updateSeeds(workspaceId, expectedRevision, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UPDATE_DELIVERY, async (_ctx, workspaceId: string, expectedRevision: number, input: CareerResearchDeliveryInput) => (await service()).updateDelivery(workspaceId, expectedRevision, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.START, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentStartInput) => (await service()).start(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CANCEL, async (_ctx, workspaceId: string, runId: string, attempt: number) => (await service()).cancel(workspaceId, runId, attempt));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CLEAR, async (_ctx, workspaceId: string, expectedRevision: number, expectedRecoveryToken?: string) => (await service()).clear(workspaceId, expectedRevision, expectedRecoveryToken));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.CORRECT, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => (await service()).correct(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.REMOVE, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => (await service()).remove(workspaceId, input));
  server.handle(RPC_CHANNELS.artistProfileEnrichment.UNDO, async (_ctx, workspaceId: string, input: ArtistProfileEnrichmentMutationInput) => (await service()).undo(workspaceId, input));
}
