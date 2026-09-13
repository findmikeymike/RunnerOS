import { afterEach, expect, test } from 'bun:test';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { RpcServer } from '@craft-agent/server-core/transport';
import type { HandlerDeps } from '../handler-deps';
import type { DeepResearchRunner } from '../../deep-research/DeepResearchRunner';
import { getArtistProfileEnrichmentService, registerArtistProfileEnrichmentHandlers } from './artist-profile-enrichment';

const handlers = new Map<string, (...args: any[]) => any>();
const server = { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler), push: () => {} } as unknown as RpcServer;
afterEach(() => {
  registerArtistProfileEnrichmentHandlers(server, {} as HandlerDeps);
  handlers.clear();
});

test('registers before headless runner initialization and subscribes once before the first handler executes', async () => {
  let runner: DeepResearchRunner | undefined;
  let subscriptions = 0;
  let disposed = 0;
  registerArtistProfileEnrichmentHandlers(server, { getDeepResearchRunner: () => runner } as HandlerDeps);
  expect(handlers.has(RPC_CHANNELS.artistProfileEnrichment.GET)).toBe(true);
  expect(getArtistProfileEnrichmentService()).toBeNull();
  await expect(handlers.get(RPC_CHANNELS.artistProfileEnrichment.GET)!({}, 'absent-workspace')).rejects.toThrow('not ready');
  runner = { subscribe: () => { subscriptions++; return () => { disposed++; }; } } as unknown as DeepResearchRunner;
  // Invalid workspace is deliberate: no live profile data is read or changed.
  await expect(handlers.get(RPC_CHANNELS.artistProfileEnrichment.GET)!({}, 'absent-workspace')).rejects.toThrow('WORKSPACE_NOT_FOUND');
  const service = getArtistProfileEnrichmentService();
  expect(service).not.toBeNull();
  expect(getArtistProfileEnrichmentService()).toBe(service);
  expect(subscriptions).toBe(1);
  registerArtistProfileEnrichmentHandlers(server, {} as HandlerDeps);
  expect(disposed).toBe(1);
  expect(getArtistProfileEnrichmentService()).toBeNull();
});

test('already-initialized hosts retain eager subscription and replacement disposes the previous listener', () => {
  let subscriptions = 0;
  let disposed = 0;
  const runner = { subscribe: () => { subscriptions++; return () => { disposed++; }; } } as unknown as DeepResearchRunner;
  const deps = { getDeepResearchRunner: () => runner } as HandlerDeps;
  registerArtistProfileEnrichmentHandlers(server, deps);
  expect(subscriptions).toBe(1);
  registerArtistProfileEnrichmentHandlers(server, deps);
  expect(subscriptions).toBe(2);
  expect(disposed).toBe(1);
});
