import { expect, mock, test } from 'bun:test';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerFn, RpcServer } from '../../transport/types';
import type { HandlerDeps } from '../handler-deps';

const read = mock(async (_workspaceId: string, _outputId: string, _expectedBriefing: string) => ({ audioDataUrl: 'data:audio/mpeg;base64,test' }));
const construct = mock((_deps: unknown) => {});
mock.module('../../outputs/SignalBriefingAudio', () => ({
  SignalBriefingAudio: class { constructor(deps: unknown) { construct(deps); } read = read; },
}));
const { registerOutputsHandlers, HANDLED_CHANNELS } = await import('./outputs');

test('registers one persistent Signals audio service and forwards all three API arguments', async () => {
  const handlers = new Map<string, HandlerFn>();
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler); },
    push() {}, async invokeClient() { return undefined; },
  };
  registerOutputsHandlers(server, {} as HandlerDeps);
  const channel = RPC_CHANNELS.outputs.READ_SIGNAL_BRIEFING_AUDIO;
  expect(HANDLED_CHANNELS).toContain(channel);
  const handler = handlers.get(channel)!;
  const context = { clientId: 'client', workspaceId: 'ws', webContentsId: 1 };
  expect(await handler(context, 'ws', 'output', 'visible briefing')).toEqual({ audioDataUrl: 'data:audio/mpeg;base64,test' });
  await handler(context, 'ws', 'output', 'visible briefing');
  expect(construct).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith('ws', 'output', 'visible briefing');
  expect(construct.mock.calls[0]![0]).toMatchObject({ getWorkspace: expect.any(Function), getOutput: expect.any(Function), safeOutputPath: expect.any(Function) });
});
