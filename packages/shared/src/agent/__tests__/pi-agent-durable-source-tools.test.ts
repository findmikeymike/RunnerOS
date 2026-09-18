import { expect, test } from 'bun:test';
import { PiAgent } from '../pi-agent';
import { DURABLE_RUNTIME_MANIFEST } from '../../protocol/durable-execution';
const name = 'mcp__calendar__api_calendar';
function fixture(executeReadTool: (request: any) => Promise<{ content: string; isError: boolean }>, writeMethods?: string[]) {
 const agent = new PiAgent({ provider: 'pi', workspace: { id: 'ws', name: 'fixture', rootPath: '/tmp/durable-proxy-fixture' }, isHeadless: true,
  durableExecution: { descriptor: { credentialIdentity: 'a'.repeat(64), runtimeManifest: { ...DURABLE_RUNTIME_MANIFEST }, engine: 'sqlite-v2-readonly-1', runId: 'r', workspaceId: 'ws', createdAt: 1, model: 'fixture', maxOutputTokens: 128, allowedTools: [name], sourceTools: [{ name, sourceSlug: 'calendar', description: 'Read calendar', inputSchema: { type: 'object', ...(writeMethods ? { properties: { method: { enum: ['GET', ...writeMethods] } } } : {}) }, ...(writeMethods ? { writeMethods } : {}) }] }, checkpoint: async () => ({}), cancel: async () => {}, fail: async () => {}, executeReadTool } } as any);
 const sent: any[] = []; (agent as any).send = (message: any) => sent.push(message);
 return { agent, sent, invoke: (extra: any = {}) => (agent as any).handleToolExecuteRequest({ requestId: 'req', toolName: name, toolCallId: 'call', turn: 0, args: { method: 'GET', path: '/events' }, ...extra }) };
}
test('durable proxies reject undeclared tools, writes and missing call identities', async () => {
 let calls = 0; const f = fixture(async () => { calls++; return { content: 'saved', isError: false }; });
 try {
  for (const extra of [{ toolName: 'mcp__session__send' }, { toolCallId: undefined }, { turn: -1 }, { args: { method: 'POST', path: '/events' } }]) {
   await f.invoke(extra); expect(f.sent.at(-1).result.isError).toBe(true);
  }
  expect(calls).toBe(0);
 } finally { f.agent.destroy(); }
});
test('duplicate in-flight source proxy messages share one host dispatch and reject changed inputs', async () => {
 let release!: () => void, calls = 0; const waiting = new Promise<void>(resolve => { release = resolve; });
 const f = fixture(async request => { calls++; expect(request.callId).toBe('call'); await waiting; return { content: 'saved', isError: false }; });
 try {
  const first = f.invoke(), second = f.invoke({ requestId: 'duplicate' }); await Promise.resolve(); expect(calls).toBe(1);
  await f.invoke({ requestId: 'changed', args: { method: 'GET', path: '/other' } }); expect(f.sent.at(-1).result.isError).toBe(true);
  release(); await Promise.all([first, second]); expect(calls).toBe(1); expect(f.sent.filter(item => !item.result.isError)).toHaveLength(2);
 } finally { release(); f.agent.destroy(); }
});

test('declared source POST reaches the host journal callback but an undeclared DELETE does not', async () => {
 let calls = 0; const f = fixture(async request => { calls++; expect(request.input.method).toBe('POST'); return { content: 'saved write receipt', isError: false }; }, ['POST']);
 try {
  await f.invoke({ args: { method: 'POST', path: '/events' } }); expect(f.sent.at(-1).result.isError).toBe(false);
  await f.invoke({ toolCallId: 'delete', args: { method: 'DELETE', path: '/events' } }); expect(f.sent.at(-1).result.isError).toBe(true);
  expect(calls).toBe(1);
 } finally { f.agent.destroy(); }
});
