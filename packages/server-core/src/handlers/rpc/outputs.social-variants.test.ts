import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as actualConfig from '@craft-agent/shared/config';
import * as actualWorkspaces from '@craft-agent/shared/workspaces';
import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
import { createOutputBundle, getOutputDir, type OutputManifest } from '@craft-agent/shared/outputs';
import type { HandlerDeps } from '../handler-deps';
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types';

const WORKSPACE_ID = 'hq-workspace';
const SOURCE_OUTPUT_ID = '11111111-1111-4111-8111-111111111111';
let root: string;

const getWorkspaceByNameOrId = mock((workspaceId: string) => workspaceId === WORKSPACE_ID
  ? { id: WORKSPACE_ID, name: 'Artist HQ', rootPath: root, artistWorkspaceScope: 'hq' as const }
  : null);
const assertTeamPermission = mock(() => undefined);

mock.module('@craft-agent/shared/config', () => ({ ...actualConfig, getWorkspaceByNameOrId }));
mock.module('@craft-agent/shared/workspaces', () => ({ ...actualWorkspaces, assertTeamPermission }));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'social-variant-rpc-'));
  const sourceDir = getOutputDir(root, SOURCE_OUTPUT_ID);
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, 'source.mp4'), 'source-video');
  createOutputBundle(root, {
    id: SOURCE_OUTPUT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Source',
    kind: 'video',
    origin: { source: 'manual' },
    assets: [{
      id: 'video',
      label: 'Source video',
      role: 'primary',
      path: 'source.mp4',
      mimeType: 'video/mp4',
      sha256: createHash('sha256').update('source-video').digest('hex'),
    }],
  });
  getWorkspaceByNameOrId.mockClear();
  assertTeamPermission.mockClear();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function harness() {
  const handlers = new Map<string, HandlerFn>();
  const pushes: string[] = [];
  const server: RpcServer = {
    handle(channel, handler) { handlers.set(channel, handler); },
    push(channel) { pushes.push(channel); },
    async invokeClient() { return undefined; },
  };
  return { handlers, pushes, server };
}

function context(): RequestContext {
  return { clientId: 'real-client', workspaceId: WORKSPACE_ID, webContentsId: 1 };
}

function deps(sessionWorkspaceId = WORKSPACE_ID, missingSessionIds = new Set<string>()): HandlerDeps {
  return {
    sessionManager: {
      async getSession(sessionId: string) {
        if (missingSessionIds.has(sessionId)) return null;
        return {
          id: sessionId,
          workspaceId: sessionWorkspaceId,
          workspaceName: 'Artist HQ',
          lastMessageAt: 0,
          messages: [],
          isProcessing: false,
          spawnedFromAgent: { agentSlug: 'raw-video-editor', agentName: 'Raw Video Editor' },
        };
      },
    },
    validateSocialProfile: async () => ({ ready: true }),
  } as unknown as HandlerDeps;
}

describe('social variant Output RPC', () => {
  test('derives request identity from the caller and registers start', async () => {
    const { handlers, pushes, server } = harness();
    const { registerOutputsHandlers } = await import('./outputs');
    registerOutputsHandlers(server, deps());
    const create = handlers.get(RPC_CHANNELS.outputs.CREATE_SOCIAL_VARIANT_SET);
    const start = handlers.get(RPC_CHANNELS.outputs.START_SOCIAL_VARIANT_SET);
    if (!create || !start) throw new Error('social variant handlers not registered');

    const created = await create(context(), WORKSPACE_ID, {
      editorSessionId: 'editor-session',
      sourceSelections: [{ origin: 'output', sourceId: SOURCE_OUTPUT_ID, assetId: 'video' }],
      destinationIntents: [{ platform: 'x', accountRole: 'primary', mode: 'standard' }],
      variantsPerSource: 1,
      requestedByClientId: 'forged-client',
    }) as OutputManifest;
    expect(created.socialVariantSet?.request.requestedBy.clientId).toBe('real-client');

    const started = await start(context(), WORKSPACE_ID, { outputId: created.id, expectedRevision: 1 }) as OutputManifest;
    expect(started?.socialVariantSet).toMatchObject({ revision: 2, status: 'analyzing' });
    expect(assertTeamPermission).toHaveBeenCalledTimes(2);
    expect(pushes).toEqual([RPC_CHANNELS.outputs.UPDATED, RPC_CHANNELS.outputs.UPDATED]);
  });

  test('rejects a session from another workspace before creating anything', async () => {
    const { handlers, server } = harness();
    const { registerOutputsHandlers } = await import('./outputs');
    registerOutputsHandlers(server, deps('other-workspace'));
    const create = handlers.get(RPC_CHANNELS.outputs.CREATE_SOCIAL_VARIANT_SET)!;
    await expect(create(context(), WORKSPACE_ID, {
      editorSessionId: 'editor-session',
      sourceSelections: [{ origin: 'output', sourceId: SOURCE_OUTPUT_ID, assetId: 'video' }],
      destinationIntents: [{ platform: 'x', accountRole: 'primary', mode: 'standard' }],
      variantsPerSource: 1,
    })).rejects.toThrow(/does not belong/);
  });

  test('validates and binds a replacement editor session', async () => {
    const { handlers, server } = harness();
    const { registerOutputsHandlers } = await import('./outputs');
    const missing = new Set<string>();
    registerOutputsHandlers(server, deps(WORKSPACE_ID, missing));
    const create = handlers.get(RPC_CHANNELS.outputs.CREATE_SOCIAL_VARIANT_SET)!;
    const rebind = handlers.get(RPC_CHANNELS.outputs.REBIND_SOCIAL_VARIANT_SET)!;
    const created = await create(context(), WORKSPACE_ID, {
      editorSessionId: 'editor-session',
      sourceSelections: [{ origin: 'output', sourceId: SOURCE_OUTPUT_ID, assetId: 'video' }],
      destinationIntents: [{ platform: 'x', accountRole: 'primary', mode: 'standard' }],
      variantsPerSource: 1,
    }) as OutputManifest;
    missing.add('editor-session');
    const rebound = await rebind(context(), WORKSPACE_ID, {
      outputId: created.id,
      expectedRevision: 1,
      editorSessionId: 'replacement-editor',
    }) as OutputManifest;
    expect(rebound.socialVariantSet).toMatchObject({ revision: 2, editorSessionId: 'replacement-editor' });
  });

  test('refuses to replace an editor session that still exists', async () => {
    const { handlers, server } = harness();
    const { registerOutputsHandlers } = await import('./outputs');
    registerOutputsHandlers(server, deps());
    const create = handlers.get(RPC_CHANNELS.outputs.CREATE_SOCIAL_VARIANT_SET)!;
    const rebind = handlers.get(RPC_CHANNELS.outputs.REBIND_SOCIAL_VARIANT_SET)!;
    const created = await create(context(), WORKSPACE_ID, {
      editorSessionId: 'editor-session',
      sourceSelections: [{ origin: 'output', sourceId: SOURCE_OUTPUT_ID, assetId: 'video' }],
      destinationIntents: [{ platform: 'x', accountRole: 'primary', mode: 'standard' }],
      variantsPerSource: 1,
    }) as OutputManifest;
    await expect(rebind(context(), WORKSPACE_ID, {
      outputId: created.id,
      expectedRevision: 1,
      editorSessionId: 'replacement-editor',
    })).rejects.toThrow('original Raw Video Editor session is still available');
  });
});
