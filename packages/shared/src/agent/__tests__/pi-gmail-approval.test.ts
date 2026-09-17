import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';
import { prepareGmailDraftSend } from '../../sources/gmail-send-snapshot.ts';

const raw = Buffer.from('To: first@example.com\r\n\r\nApproved body').toString('base64url');
function harness(prepare?: (input: Record<string, unknown>) => Promise<any>) {
  const root = mkdtempSync(join(tmpdir(), 'pi-gmail-'));
  const agent = new PiAgent({ provider: 'pi', isHeadless: true, skipConfigWatcher: true,
    workspace: { id: 'gmail-test', name: 'Gmail test', rootPath: root } as any,
    session: { id: 'gmail-test', workingDirectory: root } as any,
    mcpPool: { prepareGmailDraftSend: (_tool: string, input: Record<string, unknown>) => prepare
      ? prepare(input) : prepareGmailDraftSend(input, async path => path.endsWith('/profile')
        ? { emailAddress: 'artist@example.com' }
        : { id: 'draft-1', message: { id: 'm1', raw, payload: { mimeType: 'text/plain', body: { data: Buffer.from('Approved body').toString('base64url') } } } }) } as any,
  });
  const sent: any[] = [];
  (agent as any).send = (value: any) => sent.push(value);
  (agent as any).emitAutomationEvent = async () => {};
  (agent as any).sourceManager.updateActiveState([], ['gmail-work']);
  (agent as any).prerequisiteManager.checkPrerequisites = () => ({ allowed: true });
  const request = (toolName = 'mcp__gmail-work__api_gmail-work', input: Record<string, unknown> = { method: 'POST', path: '/users/me/drafts/send', params: { id: 'draft-1' }, _intent: 'Send reviewed email' }) => (agent as any).handlePreToolUseRequest({ requestId: 'tool-1', toolName, input });
  return { agent, sent, request, dispose: () => { agent.destroy(); rmSync(root, { recursive: true, force: true }); } };
}

test('Pi emits one existing approval and dispatches its frozen exact input', async () => {
  const h = harness();
  let prompts = 0;
  h.agent.onPermissionRequest = request => {
    prompts++;
    expect(request.description).toContain('Approved body');
    h.agent.respondToPermission(request.requestId, true);
  };
  try {
    await h.request();
    expect(prompts).toBe(1);
    expect(h.sent.at(-1).action).toBe('modify');
    expect(h.sent.at(-1).input.path).toBe('/users/artist%40example.com/drafts/send');
    expect(h.sent.at(-1).input.params.message.raw).toBe(raw);
    expect(h.sent.at(-1).input._intent).toBe('Send reviewed email');
  } finally { h.dispose(); }
});

test('Pi cancellation and missing handler never dispatch an approved Gmail send', async () => {
  for (const handler of [true, false]) {
    const h = harness();
    if (handler) h.agent.onPermissionRequest = request => h.agent.respondToPermission(request.requestId, false);
    try {
      await h.request();
      expect(h.sent.at(-1).action).toBe('block');
      expect(h.sent.some(message => ['allow', 'modify'].includes(message.action))).toBe(false);
    } finally { h.dispose(); }
  }
});

test('Pi stop during preparation cannot emit a late approval request', async () => {
  let release!: (value: any) => void;
  let started!: () => void;
  const preparing = new Promise<void>(resolve => { started = resolve; });
  const h = harness(() => { started(); return new Promise(resolve => { release = resolve; }); });
  let prompts = 0;
  h.agent.onPermissionRequest = () => { prompts++; };
  try {
    const pending = h.request();
    await preparing;
    await h.agent.abort();
    release({ input: { method: 'POST', path: '/users/artist%40example.com/drafts/send', params: { id: 'draft-1', message: { raw } } }, description: 'Approved body' });
    await pending;
    expect(prompts).toBe(0);
    expect(h.sent.some(message => ['allow', 'modify'].includes(message.action))).toBe(false);
  } finally { h.dispose(); }
});

const composioMessage = { accountId: 'ca-reviewed-account', accountEmail: 'sender@example.com', to: 'recipient@example.com',
  cc: ['copy@example.com'], bcc: ['private@example.com'], subject: 'Reviewed subject', body: 'Reviewed Composio body' };

test('Pi Composio send prompts in allow-all and retains exact reviewed input without native draft preparation', async () => {
  let nativePreparations = 0;
  const h = harness(async () => { nativePreparations++; throw new Error('Native Gmail must not handle Composio'); });
  h.agent.setPermissionMode('allow-all');
  let prompts = 0;
  h.agent.onPermissionRequest = request => {
    prompts++;
    expect(request.toolName).toBe('mcp__session__composio_gmail_send');
    for (const value of [composioMessage.accountId, composioMessage.accountEmail, composioMessage.to,
      composioMessage.cc[0]!, composioMessage.bcc[0]!, composioMessage.subject, composioMessage.body]) expect(request.description).toContain(value);
    h.agent.respondToPermission(request.requestId, true);
  };
  try {
    const input = structuredClone(composioMessage);
    await h.request('mcp__session__composio_gmail_send', input);
    expect(prompts).toBe(1);
    expect(nativePreparations).toBe(0);
    const decisions = h.sent.filter(message => message.type === 'pre_tool_use_response');
    expect(decisions).toHaveLength(1);
    expect(['allow', 'modify']).toContain(decisions[0].action);
    expect(decisions[0].input ?? input).toEqual(composioMessage);
  } finally { h.dispose(); }
});

test('Pi Composio denial or missing permission handler blocks dispatch even in allow-all', async () => {
  for (const handler of [true, false]) {
    let nativePreparations = 0;
    const h = harness(async () => { nativePreparations++; throw new Error('No native preparation'); });
    h.agent.setPermissionMode('allow-all');
    if (handler) h.agent.onPermissionRequest = request => h.agent.respondToPermission(request.requestId, false);
    try {
      await h.request('mcp__session__composio_gmail_send', structuredClone(composioMessage));
      expect(h.sent.at(-1).action).toBe('block');
      expect(h.sent.some(message => ['allow', 'modify'].includes(message.action))).toBe(false);
      expect(nativePreparations).toBe(0);
    } finally { h.dispose(); }
  }
});
