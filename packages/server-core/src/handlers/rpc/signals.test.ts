import { expect, mock, test } from 'bun:test';
import { RPC_CHANNELS, LOCAL_ONLY_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerFn, RpcServer } from '../../transport/types';
import type { HandlerDeps } from '../handler-deps';
import { HANDLED_CHANNELS, registerSignalsHandlers } from './signals';

test('Signals RPCs are local, lazy, and preserve all validation inputs', async () => {
  const service = {
    getState: mock(async (...args: unknown[]) => args),
    resolveChannel: mock(async (...args: unknown[]) => args),
    saveConfig: mock(async (...args: unknown[]) => args),
    start: mock(async (...args: unknown[]) => args),
  };
  const getSignalService = mock(() => service);
  const reader = { listIdeas: mock(async (...args: unknown[]) => args), resolveReference: mock(async (...args: unknown[]) => args) };
  const getSignalReader = mock(() => reader);
  const handoffs = {
    findSignalHandoff: mock(async (...args: unknown[]) => args),
    bindSignalHandoff: mock(async (...args: unknown[]) => args),
    getSignalHandoff: mock(async (...args: unknown[]) => args),
    clearSignalHandoff: mock(async (...args: unknown[]) => args),
  };
  const handlers = new Map<string, HandlerFn>();
  const server = { handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler); } } as RpcServer;
  registerSignalsHandlers(server, { sessionManager: { getSignalService, getSignalReader, ...handoffs } } as unknown as HandlerDeps);
  expect(getSignalService).not.toHaveBeenCalled();
  expect(getSignalReader).not.toHaveBeenCalled();
  expect(handlers.size).toBe(10);
  for (const channel of HANDLED_CHANNELS) expect(LOCAL_ONLY_CHANNELS.has(channel)).toBe(true);
  const ctx = { clientId: 'client', workspaceId: 'campaign', webContentsId: 1 };
  expect(await handlers.get(RPC_CHANNELS.signals.GET)!(ctx, 'campaign')).toEqual(['campaign']);
  expect(await handlers.get(RPC_CHANNELS.signals.RESOLVE_CHANNEL)!(ctx, 'hq', 'https://youtube.com/@artist')).toEqual(['hq', 'https://youtube.com/@artist']);
  const config = { revision: 'new' };
  expect(await handlers.get(RPC_CHANNELS.signals.SAVE_CONFIG)!(ctx, 'hq', 'your-world', config, 'previous')).toEqual(['hq', 'your-world', config, 'previous']);
  const request = { track: 'industry', mode: 'links', idempotencyKey: 'same-request', links: ['https://youtu.be/dQw4w9WgXcQ'] };
  expect(await handlers.get(RPC_CHANNELS.signals.START)!(ctx, 'hq', request)).toEqual(['hq', request]);
  const reference = { hqWorkspaceId: 'hq', outputId: 'report', contentHash: 'a'.repeat(64), entryId: 'idea' };
  expect(await handlers.get(RPC_CHANNELS.signals.IDEAS)!(ctx, 'hq', 'report')).toEqual(['hq', 'report']);
  expect(await handlers.get(RPC_CHANNELS.signals.RESOLVE_IDEA)!(ctx, 'campaign', reference)).toEqual(['campaign', reference]);
  expect(await handlers.get(RPC_CHANNELS.signals.FIND_HANDOFF)!(ctx, 'campaign', 'content-genius', reference)).toEqual(['campaign', 'content-genius', reference]);
  expect(await handlers.get(RPC_CHANNELS.signals.BIND_HANDOFF)!(ctx, 'draft', reference)).toEqual(['draft', reference]);
  expect(await handlers.get(RPC_CHANNELS.signals.GET_HANDOFF)!(ctx, 'draft')).toEqual(['draft']);
  expect(await handlers.get(RPC_CHANNELS.signals.CLEAR_HANDOFF)!(ctx, 'draft')).toEqual(['draft']);
});

test('Signals RPCs propagate host validation errors rather than reporting success', async () => {
  const handlers = new Map<string, HandlerFn>();
  const server = { handle(channel: string, handler: HandlerFn) { handlers.set(channel, handler); } } as RpcServer;
  registerSignalsHandlers(server, { sessionManager: { getSignalService: () => ({
    start: async () => { throw new Error('Ambiguous Artist HQ'); },
  }) } } as unknown as HandlerDeps);
  const ctx = { clientId: 'client', workspaceId: 'campaign', webContentsId: 1 };
  await expect(handlers.get(RPC_CHANNELS.signals.START)!(ctx, 'campaign', {})).rejects.toThrow('Ambiguous Artist HQ');
});
