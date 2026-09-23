import { expect, test } from 'bun:test';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { CLIENT_OPEN_FILE_DIALOG, CLIENT_CONFIRM_DIALOG, requestClientOpenFileDialog } from '../capabilities';
import { clientCapabilityTimeout, DIALOG_TIMEOUT_MS, rpcHandlerTimeout, rpcRequestTimeout } from '../timeout-policy';
import { WsRpcClient } from '../client';
import { WsRpcServer } from '../server';

test('native dialog waits remain bounded, with both outer deadlines longer than the human wait', () => {
  expect(clientCapabilityTimeout(CLIENT_OPEN_FILE_DIALOG)).toBe(DIALOG_TIMEOUT_MS);
  expect(clientCapabilityTimeout(CLIENT_CONFIRM_DIALOG)).toBe(DIALOG_TIMEOUT_MS);
  for (const channel of [RPC_CHANNELS.file.OPEN_DIALOG, RPC_CHANNELS.dialog.OPEN_FOLDER,
    RPC_CHANNELS.gitbash.BROWSE, RPC_CHANNELS.missionAssets.CHOOSE_FILES,
    RPC_CHANNELS.artistVault.CHOOSE_FILES, RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD,
    RPC_CHANNELS.videoStudio.IMPORT_MEDIA, RPC_CHANNELS.auth.SHOW_LOGOUT_CONFIRMATION,
    RPC_CHANNELS.auth.SHOW_DELETE_SESSION_CONFIRMATION]) {
    expect(rpcHandlerTimeout(channel, 60_000)).toBeGreaterThan(DIALOG_TIMEOUT_MS);
    expect(rpcRequestTimeout(channel, 90_000)).toBeGreaterThan(rpcHandlerTimeout(channel, 60_000));
  }
  expect(clientCapabilityTimeout('client:openExternal')).toBe(30_000);
  expect(rpcHandlerTimeout(RPC_CHANNELS.releaseKit.PROMOTE, 60_000)).toBe(60_000);
  expect(rpcRequestTimeout(RPC_CHANNELS.releaseKit.PROMOTE, 90_000)).toBe(90_000);
});

test('slow dialog response reaches caller past normal request and handler deadlines', async () => {
  const server = new WsRpcServer({ host: '127.0.0.1', port: 0 });
  const previous = (WsRpcServer as any).HANDLER_TIMEOUT_MS;
  (WsRpcServer as any).HANDLER_TIMEOUT_MS = 20;
  let client: WsRpcClient | undefined;
  try {
    server.handle(RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD, ctx => requestClientOpenFileDialog(server, ctx.clientId, {}));
    server.handle('test:ordinary', async () => { await Bun.sleep(80); return 'late'; });
    await server.listen();
    client = new WsRpcClient(`ws://127.0.0.1:${server.port}`, { requestTimeout: 15, autoReconnect: false, clientCapabilities: [CLIENT_OPEN_FILE_DIALOG] });
    client.handleCapability(CLIENT_OPEN_FILE_DIALOG, async () => {
      await Bun.sleep(80);
      return { canceled: false, filePaths: ['/tmp/chosen-after-browsing.mp4'] };
    });
    expect(await client.invoke(RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD)).toEqual({ canceled: false, filePaths: ['/tmp/chosen-after-browsing.mp4'] });
    await expect(client.invoke('test:ordinary')).rejects.toThrow('Request timeout');
    client.handleCapability(CLIENT_OPEN_FILE_DIALOG, () => ({ canceled: true, filePaths: [] }));
    expect(await client.invoke(RPC_CHANNELS.releaseKit.CHOOSE_UPLOAD)).toEqual({ canceled: true, filePaths: [] });
  } finally {
    client?.destroy();
    server.close();
    (WsRpcServer as any).HANDLER_TIMEOUT_MS = previous;
  }
});
