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

  test('ingests ready and failed renders incrementally, then replaces only the failed slot', async () => {
    const instance = service();
    const created = await instance.create(WORKSPACE_ID, {
      ...request(),
      requestedByClientId: 'client-1',
    });
    const started = await instance.start(WORKSPACE_ID, created.id, 1);
    const sourceId = started.socialVariantSet!.sources[0]!.id;
    const renderDir = join(root, 'renders');
    mkdirSync(renderDir, { recursive: true });
    const firstPath = join(renderDir, 'first.mp4');
    writeFileSync(firstPath, 'render-one');

    const first = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 2,
      sourceId,
      destinationIndex: 0,
      title: 'Chorus first',
      hook: 'Open on the chorus.',
      editorialMode: 'chorus-first',
      editorialIntent: 'Reach the emotional payoff immediately.',
      filePath: firstPath,
      durationSeconds: 12,
      aspectRatio: '9:16',
    });
    expect(first.socialVariantSet).toMatchObject({ revision: 3, status: 'partially-ready' });
    expect(first.assets.find((asset) => asset.id === first.socialVariantSet!.variants[0]!.assetId)?.sha256).toHaveLength(64);

    const failed = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 3,
      sourceId,
      destinationIndex: 0,
      title: 'Quiet opening',
      hook: 'Start on the quiet look.',
      editorialMode: 'quiet-open',
      editorialIntent: 'Create contrast before the payoff.',
      failureReason: 'FFmpeg could not decode the selected segment.',
    });
    expect(failed.socialVariantSet).toMatchObject({ revision: 4, status: 'partially-ready' });
    const failedVariant = failed.socialVariantSet!.variants.find((variant) => variant.state === 'failed')!;

    const retryPath = join(renderDir, 'retry.mp4');
    writeFileSync(retryPath, 'render-two');
    const retried = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 4,
      sourceId,
      destinationIndex: 0,
      replaceVariantId: failedVariant.id,
      title: 'Quiet opening',
      hook: 'Start on the quiet look.',
      editorialMode: 'quiet-open',
      editorialIntent: 'Create contrast before the payoff.',
      filePath: retryPath,
      durationSeconds: 10,
      aspectRatio: '9:16',
    });
    expect(retried.socialVariantSet).toMatchObject({ revision: 5, status: 'ready' });
    expect(retried.socialVariantSet!.variants).toHaveLength(2);
    expect(retried.socialVariantSet!.variants.every((variant) => variant.state === 'ready')).toBe(true);
  });

  test('rejects result files outside the workspace and sessions other than the bound editor', async () => {
    const instance = service();
    const created = await instance.create(WORKSPACE_ID, { ...request(), requestedByClientId: 'client-1' });
    await instance.start(WORKSPACE_ID, created.id, 1);
    const sourceId = created.socialVariantSet!.sources[0]!.id;
    const outsideRoot = mkdtempSync(join(tmpdir(), 'outside-variant-'));
    const outsidePath = join(outsideRoot, 'render.mp4');
    writeFileSync(outsidePath, 'outside');
    const result = {
      outputId: created.id,
      expectedRevision: 2,
      sourceId,
      destinationIndex: 0,
      title: 'Outside',
      hook: 'Outside hook',
      editorialMode: 'outside',
      editorialIntent: 'This must not be ingested.',
      filePath: outsidePath,
    };
    await expect(instance.recordResult(WORKSPACE_ID, 'wrong-session', 'raw-video-editor', result)).rejects.toThrow(/different Raw Video Editor session/);
    await expect(instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', result)).rejects.toThrow(/inside the current workspace/);
    rmSync(outsideRoot, { recursive: true, force: true });
  });

  test('archives an unscheduled variant with a revision fence and preserves its asset', async () => {
    const instance = service();
    const created = await instance.create(WORKSPACE_ID, {
      ...request(),
      variantsPerSource: 1,
      destinationIntents: [
        { platform: 'instagram', accountRole: 'primary', mode: 'standard' },
        { platform: 'tiktok', accountRole: 'secondary', mode: 'standard' },
      ],
      requestedByClientId: 'client-1',
    });
    const started = await instance.start(WORKSPACE_ID, created.id, 1);
    const sourceId = started.socialVariantSet!.sources[0]!.id;
    const renderDir = join(root, 'renders');
    mkdirSync(renderDir, { recursive: true });
    const filePath = join(renderDir, 'only.mp4');
    writeFileSync(filePath, 'render');
    const rendered = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 2,
      sourceId,
      destinationIndex: 0,
      title: 'Only cut',
      hook: 'Start immediately.',
      editorialMode: 'direct',
      editorialIntent: 'Remove the setup.',
      filePath,
    });
    const variant = rendered.socialVariantSet!.variants[0]!;

    const archived = await instance.archiveVariant(WORKSPACE_ID, {
      outputId: created.id,
      expectedRevision: 3,
      variantId: variant.id,
    });
    expect(archived.socialVariantSet).toMatchObject({ revision: 4, status: 'archived' });
    expect(archived.socialVariantSet!.variants[0]!.state).toBe('archived');
    expect(archived.assets.some((asset) => asset.id === variant.assetId)).toBe(true);

    await expect(instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 4,
      sourceId,
      destinationIndex: 1,
      replaceVariantId: variant.id,
      title: 'Wrong destination',
      hook: 'Wrong destination.',
      editorialMode: 'direct',
      editorialIntent: 'Must remain bound to the original destination.',
      failureReason: 'Render failed.',
    })).rejects.toThrow('exact source and destination');

    const failedRevision = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 4,
      sourceId,
      destinationIndex: 0,
      replaceVariantId: variant.id,
      title: 'Only cut revision',
      hook: 'Start even faster.',
      editorialMode: 'direct',
      editorialIntent: 'Tighten the opening.',
      failureReason: 'FFmpeg failed during the revision.',
    });
    expect(failedRevision.socialVariantSet).toMatchObject({ revision: 5, status: 'needs-attention' });
    expect(failedRevision.socialVariantSet!.variants[0]!.state).toBe('archived');
    expect(failedRevision.assets.some((asset) => asset.id === variant.assetId)).toBe(true);
    const revisedPath = join(renderDir, 'revised.mp4');
    writeFileSync(revisedPath, 'revised-render');
    const revised = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 5,
      sourceId,
      destinationIndex: 0,
      replaceVariantId: variant.id,
      title: 'Only cut revision',
      hook: 'Start even faster.',
      editorialMode: 'direct',
      editorialIntent: 'Tighten the opening.',
      filePath: revisedPath,
    });
    expect(revised.socialVariantSet).toMatchObject({ revision: 6, status: 'ready' });
    expect(revised.socialVariantSet!.variants[0]!.id).not.toBe(variant.id);
    expect(revised.assets.some((asset) => asset.id === variant.assetId)).toBe(true);
    expect(revised.assets.some((asset) => asset.id === revised.socialVariantSet!.variants[0]!.assetId)).toBe(true);
    await expect(instance.archiveVariant(WORKSPACE_ID, {
      outputId: created.id,
      expectedRevision: 3,
      variantId: variant.id,
    })).rejects.toThrow('Expected revision 3, found 6');
  });
});
