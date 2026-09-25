import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actualConfig from '@craft-agent/shared/config';
import * as actualWorkspaces from '@craft-agent/shared/workspaces';
import { createOutputBundle, getOutputDir } from '@craft-agent/shared/outputs';
import { createRunnerVideoProject } from '@craft-agent/shared/video';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import type { HandlerDeps } from '../handler-deps';
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types';

const WORKSPACE = 'video-save-test-workspace';
const OUTPUT = 'c1370000-1111-4111-8111-111111111111';
let root: string;
let path: string;
let baseline: string;
let denied = false;
const originalLookup = actualConfig.getWorkspaceByNameOrId;
const originalPermission = actualWorkspaces.assertTeamPermission;
const assertPermission = mock((workspaceRoot: string, ...args: unknown[]) => {
  if (workspaceRoot === root) {
    if (denied) throw new Error('Video save permission denied');
    return { allowed: true };
  }
  return (originalPermission as (...values: unknown[]) => unknown)(workspaceRoot, ...args);
});
mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (id: string) => id === WORKSPACE
    ? { id, name: 'Video save fixture', rootPath: root }
    : originalLookup(id),
}));
mock.module('@craft-agent/shared/workspaces', () => ({ ...actualWorkspaces, assertTeamPermission: assertPermission }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'video-save-rpc-'));
  denied = false;
  const outputDir = getOutputDir(root, OUTPUT);
  mkdirSync(outputDir, { recursive: true });
  path = join(outputDir, 'video.runner-video.json');
  baseline = JSON.stringify(createRunnerVideoProject({ workspaceId: WORKSPACE, title: 'Original' }), null, 2) + '\n';
  writeFileSync(path, baseline);
  writeFileSync(join(outputDir, 'notes.txt'), 'Not an editable project');
  createOutputBundle(root, {
    id: OUTPUT, workspaceId: WORKSPACE, title: 'Video fixture', kind: 'video', origin: { source: 'manual' },
    assets: [
      { id: 'project', label: 'Project', role: 'primary', path: 'video.runner-video.json', mimeType: 'application/json' },
      { id: 'notes', label: 'Notes', role: 'attachment', path: 'notes.txt', mimeType: 'text/plain' },
    ],
  });
  assertPermission.mockClear();
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

async function harness() {
  const handlers = new Map<string, HandlerFn>();
  const pushes: string[] = [];
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler); },
    push(channel) { pushes.push(channel); },
    async invokeClient() { return undefined; },
  };
  const { registerOutputsHandlers } = await import('./outputs');
  registerOutputsHandlers(server, { sessionManager: {} } as HandlerDeps);
  const handler = handlers.get(RPC_CHANNELS.outputs.WRITE_ASSET_TEXT);
  if (!handler) throw new Error('WRITE_ASSET_TEXT was not registered');
  const context: RequestContext = { clientId: 'video-editor-client', workspaceId: WORKSPACE, webContentsId: 1 };
  return {
    pushes,
    save: (content: unknown, expected?: unknown, asset = 'project') => handler(context, WORKSPACE, OUTPUT, asset, content, expected),
  };
}

function revised(title: string): string { return JSON.stringify({ ...JSON.parse(baseline), title }); }

describe('Video Studio registered save RPC', () => {
  test('saves the expected revision and backs up exactly the previous bytes', async () => {
    const { save, pushes } = await harness();
    expect(await save(revised('Human edit'), baseline)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8')).title).toBe('Human edit');
    expect(readFileSync(`${path}.bak`, 'utf-8')).toBe(baseline);
    expect(assertPermission).toHaveBeenCalledWith(root, 'files.write');
    expect(pushes).toEqual([RPC_CHANNELS.outputs.UPDATED]);
  });

  test('rejects a stale human save without replacing an agent edit or its backup', async () => {
    const { save, pushes } = await harness();
    const agentEdit = revised('Newer agent edit');
    const priorBackup = 'backup bytes must remain untouched';
    writeFileSync(path, agentEdit);
    writeFileSync(`${path}.bak`, priorBackup);
    await expect(save(revised('Stale human edit'), baseline)).rejects.toMatchObject({ code: 'VIDEO_PROJECT_CONFLICT' });
    expect(readFileSync(path, 'utf-8')).toBe(agentEdit);
    expect(readFileSync(`${path}.bak`, 'utf-8')).toBe(priorBackup);
    expect(pushes).toEqual([]);
  });

  test('two simultaneous saves from one revision produce exactly one winner', async () => {
    const { save, pushes } = await harness();
    const results = await Promise.allSettled([save(revised('First'), baseline), save(revised('Second'), baseline)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'VIDEO_PROJECT_CONFLICT' } });
    expect(['First', 'Second']).toContain(JSON.parse(readFileSync(path, 'utf-8')).title);
    expect(readFileSync(`${path}.bak`, 'utf-8')).toBe(baseline);
    expect(pushes).toEqual([RPC_CHANNELS.outputs.UPDATED]);
  });

  test.each([undefined, null, 17])('requires the expected raw revision (%j)', async expected => {
    const { save, pushes } = await harness();
    await expect(save(revised('Unchecked'), expected)).rejects.toThrow();
    expect(readFileSync(path, 'utf-8')).toBe(baseline);
    expect(existsSync(`${path}.bak`)).toBe(false);
    expect(pushes).toEqual([]);
  });

  test.each(['not JSON', '{}', JSON.stringify({ version: 999 }), 42])('rejects invalid content (%j)', async content => {
    const { save, pushes } = await harness();
    await expect(save(content, baseline)).rejects.toThrow();
    expect(readFileSync(path, 'utf-8')).toBe(baseline);
    expect(existsSync(`${path}.bak`)).toBe(false);
    expect(pushes).toEqual([]);
  });

  test.each(['missing', '../video.runner-video.json', '/tmp/unregistered.runner-video.json', 'notes'])('rejects non-project asset identifiers (%s)', async asset => {
    const { save, pushes } = await harness();
    await expect(save(revised('Wrong target'), baseline, asset)).rejects.toThrow();
    expect(readFileSync(path, 'utf-8')).toBe(baseline);
    expect(readFileSync(join(getOutputDir(root, OUTPUT), 'notes.txt'), 'utf-8')).toBe('Not an editable project');
    expect(pushes).toEqual([]);
  });

  test('denies a valid revision when files.write permission is absent', async () => {
    const { save, pushes } = await harness();
    denied = true;
    await expect(save(revised('Forbidden'), baseline)).rejects.toThrow('permission denied');
    expect(readFileSync(path, 'utf-8')).toBe(baseline);
    expect(existsSync(`${path}.bak`)).toBe(false);
    expect(pushes).toEqual([]);
  });
});
