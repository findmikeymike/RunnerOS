import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createOutputBundle,
  getOutputDir,
  readOutput,
  type CreateSocialVariantSetRequest,
} from '@craft-agent/shared/outputs';
import { SocialVariantSetService } from './SocialVariantSetService';

const WORKSPACE_ID = 'hq-workspace';
const SOURCE_OUTPUT_ID = '11111111-1111-4111-8111-111111111111';
let root: string;
let updates: string[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'social-variant-service-'));
  updates = [];
  const sourcePath = join(getOutputDir(root, SOURCE_OUTPUT_ID), 'source.mp4');
  mkdirSync(getOutputDir(root, SOURCE_OUTPUT_ID), { recursive: true });
  writeFileSync(sourcePath, 'source-video');
  createOutputBundle(root, {
    id: SOURCE_OUTPUT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Performance master',
    kind: 'video',
    origin: { source: 'manual' },
    assets: [{
      id: 'source-video',
      label: 'Performance master',
      role: 'primary',
      path: 'source.mp4',
      mimeType: 'video/mp4',
      sha256: createHash('sha256').update('source-video').digest('hex'),
    }],
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function request(overrides: Partial<CreateSocialVariantSetRequest> = {}): CreateSocialVariantSetRequest {
  return {
    editorSessionId: 'editor-session-1',
    sourceSelections: [{ origin: 'output', sourceId: SOURCE_OUTPUT_ID, assetId: 'source-video' }],
    destinationIntents: [{
      platform: 'instagram',
      accountRole: 'secondary',
      profileId: 'artist secondary profile',
      labelSnapshot: '@artist-alt',
      mode: 'standard',
    }],
    variantsPerSource: 2,
    direction: 'Use two genuinely distinct openings.',
    ...overrides,
  };
}

function service(options: { profileReady?: boolean } = {}): SocialVariantSetService {
  return new SocialVariantSetService({
    getWorkspace: (workspaceId) => workspaceId === WORKSPACE_ID
      ? { id: WORKSPACE_ID, name: 'Artist HQ', rootPath: root, artistWorkspaceScope: 'hq' }
      : undefined,
    validateSocialProfile: async () => options.profileReady === false
      ? { ready: false, reason: 'Reconnect this account.' }
      : { ready: true },
    emitOutputsUpdated: (workspaceId) => updates.push(workspaceId),
    now: () => new Date('2026-09-02T12:00:00.000Z'),
  });
}

describe('SocialVariantSetService', () => {
  test('creates a host-owned set from freshly hashed canonical source data', async () => {
    const created = await service().create(WORKSPACE_ID, {
      ...request(),
      requestedByClientId: 'client-1',
    });

    expect(created.socialVariantSet).toMatchObject({
      revision: 1,
      scope: 'hq',
      status: 'queued',
      editorSessionId: 'editor-session-1',
      request: {
        variantsPerSource: 2,
        totalRequested: 2,
        requestedBy: { type: 'user', clientId: 'client-1' },
      },
    });
    expect(created.socialVariantSet?.sources[0]).toMatchObject({
      origin: 'output',
      sourceId: SOURCE_OUTPUT_ID,
      assetId: 'source-video',
      rightsBasis: 'authorized',
    });
    expect(created.socialVariantSet?.request.destinationIntents[0]?.profileId).toBe('artist secondary profile');
    expect(readOutput(root, created.id)).toEqual(created);
    expect(updates).toEqual([WORKSPACE_ID]);
  });

  test('fails before persistence when a selected account is not ready', async () => {
    await expect(service({ profileReady: false }).create(WORKSPACE_ID, {
      ...request(),
      requestedByClientId: 'client-1',
    })).rejects.toThrow('Reconnect this account.');
  });

  test('detects source drift before creating a set', async () => {
    writeFileSync(join(getOutputDir(root, SOURCE_OUTPUT_ID), 'source.mp4'), 'changed-video');
    await expect(service().create(WORKSPACE_ID, {
      ...request(),
      requestedByClientId: 'client-1',
    })).rejects.toThrow(/changed after it was recorded/);
  });

  test('rechecks pinned source bytes at start and records a durable attention reason', async () => {
    const created = await service().create(WORKSPACE_ID, {
      ...request(),
      requestedByClientId: 'client-1',
    });
    updates = [];
    writeFileSync(join(getOutputDir(root, SOURCE_OUTPUT_ID), 'source.mp4'), 'changed-after-setup');

    await expect(service().start(WORKSPACE_ID, created.id, 1)).rejects.toThrow(/changed after it was recorded/);

    const persisted = readOutput(root, created.id);
    expect(persisted?.socialVariantSet).toMatchObject({
      revision: 2,
      status: 'needs-attention',
      attention: {
        code: 'source-unavailable',
        sourceId: created.socialVariantSet?.sources[0]?.id,
      },
    });
    expect(persisted?.summary).toContain('Needs attention:');
    expect(updates).toEqual([WORKSPACE_ID]);
  });

  test('serializes separate service instances and rejects the stale starter', async () => {
    const created = await service().create(WORKSPACE_ID, {
      ...request(),
      destinationIntents: [{ platform: 'x', accountRole: 'primary', mode: 'standard' }],
      requestedByClientId: 'client-1',
    });
    updates = [];

    const [first, second] = await Promise.allSettled([
      service().start(WORKSPACE_ID, created.id, 1),
      service().start(WORKSPACE_ID, created.id, 1),
    ]);
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected']);
    const persisted = readOutput(root, created.id);
    expect(persisted?.socialVariantSet?.revision).toBe(2);
    expect(persisted?.socialVariantSet?.status).toBe('analyzing');
    expect(updates).toEqual([WORKSPACE_ID]);
  });
});
