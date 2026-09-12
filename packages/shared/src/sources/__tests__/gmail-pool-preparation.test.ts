import { expect, test } from 'bun:test';
import { createApiServer } from '../api-tools.ts';
import { McpClientPool } from '../../mcp/mcp-pool.ts';

const raw = Buffer.from('To: original@example.com\r\n\r\nOriginal body').toString('base64url');
test('private Gmail alias preparation pins bytes and mailbox across token reconnect', async () => {
  const oldFetch = globalThis.fetch;
  const pool = new McpClientPool();
  const requests: Array<{ url: string; method?: string; body?: unknown; auth?: string }> = [];
  let token = 'first-account';
  let remoteRaw = raw;
  globalThis.fetch = (async (url, init) => {
    const request = { url: String(url), method: init?.method, body: init?.body, auth: (init?.headers as any)?.Authorization };
    requests.push(request);
    if (init?.method === 'POST') {
      if (token === 'other-account') return Response.json({ error: 'wrong mailbox' }, { status: 403 });
      return Response.json({ id: 'sent-message' });
    }
    if (String(url).endsWith('/profile')) return Response.json({ emailAddress: 'artist@example.com' });
    return Response.json({ id: 'draft-1', message: { id: 'm1', raw: remoteRaw,
      payload: { mimeType: 'text/plain', body: { data: Buffer.from('Original body').toString('base64url') } } } });
  }) as typeof fetch;
  try {
    const server = createApiServer({ name: 'gmail-work', baseUrl: 'https://gmail.googleapis.com/gmail/v1', auth: { type: 'bearer' } } as any, async () => token);
    await pool.connectInProcess('gmail-work', server.instance);
    const tools = pool.getProxyToolDefs();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('mcp__gmail-work__api_gmail-work');
    const prepared = await pool.prepareGmailDraftSend(tools[0]!.name, {
      method: 'POST', path: '/users/me/drafts/send', params: { id: 'draft-1' }, _intent: 'Send approved email',
    });
    remoteRaw = Buffer.from('To: changed@example.com\r\n\r\nChanged after approval').toString('base64url');
    token = 'other-account';
    const result = await pool.callTool(tools[0]!.name, prepared.input);
    expect(result.isError).toBe(true);
    expect(requests.at(-1)?.url).toBe('https://gmail.googleapis.com/gmail/v1/users/artist%40example.com/drafts/send');
    expect(JSON.parse(String(requests.at(-1)?.body)).message.raw).toBe(raw);
    token = 'refreshed-same-account';
    expect((await pool.callTool(tools[0]!.name, prepared.input)).isError).toBe(false);
    expect(requests.filter(request => request.method === 'GET').map(request => request.auth)).toEqual([
      'Bearer first-account', 'Bearer first-account', 'Bearer first-account',
    ]);
  } finally { globalThis.fetch = oldFetch; await pool.disconnectAll(); }
});
