import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgent } from '../claude-agent.ts';
import { AbortReason } from '../backend/types.ts';

async function harness(prepare: () => Promise<any>) {
  const root = mkdtempSync(join(tmpdir(), 'claude-gmail-'));
  const agent = new ClaudeAgent({ isHeadless: true, skipConfigWatcher: true,
    workspace: { id: 'gmail-test', name: 'Gmail', rootPath: root } as any,
    session: { id: 'gmail-test', workingDirectory: root } as any,
    mcpPool: { disconnectAll: async () => {}, getConnectedSlugs: () => [], getProxyToolDefs: () => [], prepareGmailDraftSend: prepare } as any,
  }) as any;
  agent.keepBackgroundTasksAlive = true;
  agent.setPermissionMode('allow-all');
  agent.sourceManager.updateActiveState([], ['gmail']);
  agent.prerequisiteManager.checkPrerequisites = () => ({ allowed: true });
  let hook: any;
  // Capture the real production hook without starting any SDK/provider process.
  agent.beginPersistentTurn = (_prompt: unknown, options: any) => {
    hook = options.hooks.PreToolUse[0].hooks[0];
    return (async function* () {})();
  };
  for await (const _event of agent.chatImpl('test')) { /* no provider is invoked */ }
  expect(typeof hook).toBe('function');
  const request = () => hook({ hook_event_name: 'PreToolUse', tool_use_id: 'tool-1',
    tool_name: 'mcp__gmail__api_gmail', tool_input: { method: 'POST', path: '/users/me/drafts/send', params: { id: 'draft-1' } } });
  return { agent, request, dispose: () => { agent.destroy(); rmSync(root, { recursive: true, force: true }); } };
}
const prepared = { input: { method: 'POST', path: '/users/artist%40example.com/drafts/send', params: { id: 'draft-1', message: { raw: 'approved-raw' } } }, description: 'Original reviewed content' };

test('Claude existing approval returns exact prepared SDK updatedInput', async () => {
  const h = await harness(async () => structuredClone(prepared));
  let prompts = 0;
  h.agent.onPermissionRequest = (request: any) => {
    prompts++;
    expect(request.description).toBe(prepared.description);
    h.agent.respondToPermission(request.requestId, true);
  };
  try {
    const result = await h.request();
    expect(prompts).toBe(1);
    expect(result.hookSpecificOutput.updatedInput).toEqual(prepared.input);
  } finally { h.dispose(); }
});

test('Claude denied send has no approved SDK input', async () => {
  const h = await harness(async () => prepared);
  h.agent.onPermissionRequest = (request: any) => h.agent.respondToPermission(request.requestId, false);
  try {
    const result = await h.request();
    expect(result.decision).toBe('block');
    expect(result.hookSpecificOutput).toBeUndefined();
  } finally { h.dispose(); }
});

for (const action of ['stop', 'handoff'] as const) {
  test(`Claude ${action} during preparation suppresses late approval`, async () => {
    let release!: (value: any) => void;
    let started!: () => void;
    const preparing = new Promise<void>(resolve => { started = resolve; });
    const h = await harness(() => { started(); return new Promise(resolve => { release = resolve; }); });
    let prompts = 0;
    h.agent.onPermissionRequest = () => { prompts++; };
    try {
      const request = h.request();
      await Promise.race([preparing, request.then((value: any) => { throw new Error('Returned before preparation: ' + JSON.stringify(value)); })]);
      if (action === 'stop') h.agent.forceAbort();
      else h.agent.interruptForHandoff(AbortReason.AuthRequest);
      release(prepared);
      const result = await request;
      expect(prompts).toBe(0);
      expect(result.decision).toBe('block');
    } finally { h.dispose(); }
  });
}
