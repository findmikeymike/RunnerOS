import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as config from '@craft-agent/shared/config';
import * as workspaces from '@craft-agent/shared/workspaces';
import * as agentRegistration from '../../sessions/agent-registration';
import { createOutputBundle, getOutputDir } from '@craft-agent/shared/outputs';
import { createRunnerVideoProject } from '@craft-agent/shared/video';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerDeps } from '../handler-deps';
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types';

const WORKSPACE = 'video-agent-rpc-test';
const OUTPUT = 'a3370000-1111-4111-8111-111111111111';
const SESSION = 'video-agent-rpc-session';
let root: string;
let path: string;
let active = true;
let remote = false;
let denied: string | null = null;
const drafts = new Map<string, unknown>();
const originalLookup = config.getWorkspaceByNameOrId;
const originalGetDraft = config.getSessionDraft;
const originalSetDraft = config.setSessionDraft;
const originalPermission = workspaces.assertTeamPermission;
const originalActive = agentRegistration.loadActiveAgentsForWorkspace;
mock.module('@craft-agent/shared/config', () => ({ ...config,
  getWorkspaceByNameOrId: (id: string) => id === WORKSPACE
    ? { id, name: 'Video agent fixture', rootPath: root, ...(remote ? { remoteServer: { url: 'https://example.invalid' } } : {}) }
    : originalLookup(id),
  getSessionDraft: (id: string) => id === SESSION ? drafts.get(id) ?? null : originalGetDraft(id),
  setSessionDraft: (id: string, draft: Parameters<typeof originalSetDraft>[1]) => id === SESSION ? void drafts.set(id, draft) : originalSetDraft(id, draft),
}));
const permission = mock((workspaceRoot: string, action: string, ...rest: unknown[]) => {
  if (workspaceRoot === root) {
    if (denied === action) throw new Error(`Denied ${action}`);
    return { allowed: true };
  }
  return (originalPermission as (...args: unknown[]) => unknown)(workspaceRoot, action, ...rest);
});
mock.module('@craft-agent/shared/workspaces', () => ({ ...workspaces, assertTeamPermission: permission }));
mock.module('../../sessions/agent-registration', () => ({ ...agentRegistration,
  loadActiveAgentsForWorkspace: (workspace: Parameters<typeof originalActive>[0], options?: Parameters<typeof originalActive>[1]) => workspace.rootPath === root
    ? active ? [{ slug: 'video-editor-agent' }] : []
    : originalActive(workspace, options),
}));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'video-agent-rpc-'));
  path = join(getOutputDir(root, OUTPUT), 'video.runner-video.json');
  mkdirSync(getOutputDir(root, OUTPUT), { recursive: true });
  writeFileSync(path, JSON.stringify(createRunnerVideoProject({ workspaceId: WORKSPACE, title: 'Agent target' })));
  createOutputBundle(root, { id: OUTPUT, workspaceId: WORKSPACE, title: 'Target', kind: 'video', origin: { source: 'manual' },
    assets: [{ id: 'project', label: 'Project', role: 'primary', path: 'video.runner-video.json', mimeType: 'application/json' }] });
  active = true; remote = false; denied = null; drafts.clear(); permission.mockClear();
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function harness() {
  const resolveOptions = mock(async (..._args: unknown[]) => ({ permissionMode: 'ask', model: 'saved-model' }));
  const create = mock(async (..._args: unknown[]) => ({ id: SESSION }));
  let acknowledge: (() => void) | undefined;
  let sendStarted!: () => void;
  const enteredSend = new Promise<void>(resolve => { sendStarted = resolve; });
  let autoAck = true;
  const send = mock(async (...args: unknown[]) => {
    acknowledge = () => (args[7] as (id: string) => void)('persisted-message');
    sendStarted();
    if (autoAck) acknowledge();
    else await new Promise<void>(() => {});
  });
  const handlers = new Map<string, HandlerFn>();
  const server: RpcServer = { handle(channel, handler) { handlers.set(channel, handler); }, push() {}, async invokeClient() { return undefined; } };
  const { registerVideoStudioHandlers } = await import('./video-studio');
  registerVideoStudioHandlers(server, { sessionManager: { resolveAgentSessionOptions: resolveOptions, createSession: create, sendMessage: send } } as unknown as HandlerDeps);
  const handler = handlers.get(RPC_CHANNELS.videoStudio.RUN_AGENT)!;
  const ctx: RequestContext = { clientId: 'editor', workspaceId: WORKSPACE, webContentsId: 1 };
  return { resolveOptions, create, send, enteredSend, hold: () => { autoAck = false; }, ack: () => acknowledge?.(),
    run: (outputId = OUTPUT, prompt: unknown = 'Add captions') => handler(ctx, WORKSPACE, outputId, prompt) };
}

describe('registered Video Studio agent handoff gates', () => {
  test('validates target and permission before creating saved-agent session', async () => {
    const h = await harness();
    const result = await h.run();
    expect(result).toMatchObject({ ok: true, outputId: OUTPUT, sessionId: SESSION, status: 'started' });
    expect(permission.mock.calls.map(call => call[1])).toEqual(['agent.chat', 'files.write']);
    expect(h.resolveOptions).toHaveBeenCalledWith(WORKSPACE, 'video-editor-agent', { referenceMode: 'strict', taskModeSelectionSource: 'handoff' });
    expect(h.create).toHaveBeenCalledWith(WORKSPACE, expect.objectContaining({ permissionMode: 'ask', model: 'saved-model', workingDirectory: realpathSync(getOutputDir(root, OUTPUT)) }));
    expect(h.send.mock.calls[0]?.[1]).toContain(realpathSync(path));
    expect(h.send.mock.calls[0]?.[4]).toMatchObject({ inputOrigin: 'human' });
  });

  test.each(['agent.chat', 'files.write'])('denies %s without creating an orphan session', async action => {
    const h = await harness(); denied = action;
    await expect(h.run()).rejects.toThrow(`Denied ${action}`);
    expect(h.create).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
  });
  test('inactive saved agent does not resolve/create/send', async () => {
    const h = await harness(); active = false;
    await expect(h.run()).rejects.toThrow('Activate Video Editor Agent');
    expect(h.resolveOptions).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  test('remote workspace is rejected before session creation', async () => {
    const h = await harness(); remote = true;
    await expect(h.run()).rejects.toThrow('remote workspaces');
    expect(h.create).not.toHaveBeenCalled();
  });
  test('missing Output is rejected before session creation', async () => {
    const h = await harness();
    await expect(h.run('a3370000-1111-4111-8111-222222222222')).rejects.toThrow('Output not found');
    expect(h.create).not.toHaveBeenCalled();
  });
  test.each(['', '   ', 42])('invalid prompt %j is rejected before creation', async prompt => {
    const h = await harness();
    await expect(h.run(OUTPUT, prompt)).rejects.toThrow('prompt is required');
    expect(h.create).not.toHaveBeenCalled();
  });
  test('invalid project is rejected before session creation', async () => {
    const h = await harness(); writeFileSync(path, '{}');
    await expect(h.run()).rejects.toThrow();
    expect(h.resolveOptions).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  test('unsafe symlink target is denied before project read or launch', async () => {
    const h = await harness(); unlinkSync(path); symlinkSync('/etc/hosts', path);
    await expect(h.run()).rejects.toThrow(/Access denied/);
    expect(h.resolveOptions).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled();
  });
  test('concurrent handoff is rejected rather than queued into a duplicate session', async () => {
    const h = await harness(); h.hold();
    const first = h.run();
    await h.enteredSend;
    try {
      await expect(h.run()).rejects.toThrow('busy');
      expect(h.create).toHaveBeenCalledTimes(1); expect(h.send).toHaveBeenCalledTimes(1);
    } finally { h.ack(); }
    expect(await first).toMatchObject({ status: 'started' });
  });
});
