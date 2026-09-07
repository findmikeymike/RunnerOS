import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { SignalMode, SignalTrack, SignalTrackConfig } from '@craft-agent/shared/shared-intel';
import type { RpcServer } from '../../transport';
import type { HandlerDeps } from '../handler-deps';

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.signals.GET,
  RPC_CHANNELS.signals.RESOLVE_CHANNEL,
  RPC_CHANNELS.signals.SAVE_CONFIG,
  RPC_CHANNELS.signals.START,
] as const;

export function registerSignalsHandlers(server: RpcServer, deps: HandlerDeps): void {
  // The service validates scope, permissions, revisions, and request identity.
  // Resolve lazily so registering RPCs never starts work or touches artist data.
  server.handle(RPC_CHANNELS.signals.GET, (_ctx, workspaceId: string) =>
    deps.sessionManager.getSignalService().getState(workspaceId));
  server.handle(RPC_CHANNELS.signals.RESOLVE_CHANNEL, (_ctx, workspaceId: string, url: string) =>
    deps.sessionManager.getSignalService().resolveChannel(workspaceId, url));
  server.handle(RPC_CHANNELS.signals.SAVE_CONFIG, (_ctx, workspaceId: string, track: SignalTrack, config: SignalTrackConfig, expectedRevision: string) =>
    deps.sessionManager.getSignalService().saveConfig(workspaceId, track, config, expectedRevision));
  server.handle(RPC_CHANNELS.signals.START, (_ctx, workspaceId: string, input: { track: SignalTrack; mode: SignalMode; idempotencyKey: string; links?: string[] }) =>
    deps.sessionManager.getSignalService().start(workspaceId, input));
}
