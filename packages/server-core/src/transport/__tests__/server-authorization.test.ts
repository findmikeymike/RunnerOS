import { describe, expect, test } from 'bun:test';
import { WsRpcServer } from '../server.ts';

describe('WsRpcServer request authorization', () => {
  test('authorizes before the handler and denies without side effects', async () => {
    const order: string[] = [];
    const server = new WsRpcServer({
      authorizeRequest: async () => {
        order.push('authorize');
        const error = new Error('LICENSE_REQUIRED');
        (error as Error & { code?: string }).code = 'LICENSE_REQUIRED';
        throw error;
      },
    });
    server.handle('paid:write', () => order.push('handler'));
    let response: { code?: string; message?: string } | null = null;
    (server as any).sendResponseError = (_ws: unknown, _id: string, _channel: string, code: string, message: string) => {
      response = { code, message };
    };

    await (server as any).onRequest(
      { id: 'client', workspaceId: null, webContentsId: null, ws: {}, eventBuffer: [] },
      { id: 'request', type: 'request', channel: 'paid:write', args: [] },
    );

    expect(order).toEqual(['authorize']);
    expect(response as unknown).toEqual({ code: 'LICENSE_REQUIRED', message: 'LICENSE_REQUIRED' });
  });
});
