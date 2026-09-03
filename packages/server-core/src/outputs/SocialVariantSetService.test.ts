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

function service(options: { profileReady?: boolean; scope?: 'hq' | 'campaign' } = {}): SocialVariantSetService {
  return new SocialVariantSetService({
    getWorkspace: (workspaceId) => workspaceId === WORKSPACE_ID
      ? { id: WORKSPACE_ID, name: 'Artist workspace', rootPath: root, artistWorkspaceScope: options.scope ?? 'hq' }
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

  test('rejects exact source copies and duplicate rendered variants without consuming a slot', async () => {
    const instance = service();
    const created = await instance.create(WORKSPACE_ID, {
      ...request({ variantsPerSource: 2 }),
      requestedByClientId: 'client-1',
    });
    const started = await instance.start(WORKSPACE_ID, created.id, 1);
    const sourceId = started.socialVariantSet!.sources[0]!.id;
    const renderDir = join(root, 'renders');
    mkdirSync(renderDir, { recursive: true });
    const sourceCopy = join(renderDir, 'source-copy.mp4');
    writeFileSync(sourceCopy, 'source-video');
    const result = {
      outputId: created.id,
      expectedRevision: 2,
      sourceId,
      destinationIndex: 0,
      title: 'First cut',
      hook: 'Open immediately.',
      editorialMode: 'chorus-first',
      editorialIntent: 'Move the payoff to the opening.',
      filePath: sourceCopy,
    };

    await expect(instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', result)).rejects.toThrow(/identical to its source/);
    expect(readOutput(root, created.id)?.socialVariantSet).toMatchObject({ revision: 2, variants: [] });

    const firstRender = join(renderDir, 'first-render.mp4');
    writeFileSync(firstRender, 'meaningfully-different-render');
    const saved = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', { ...result, filePath: firstRender });
    expect(saved.socialVariantSet).toMatchObject({ revision: 3, status: 'partially-ready' });

    const duplicateRender = join(renderDir, 'duplicate-render.mp4');
    writeFileSync(duplicateRender, 'meaningfully-different-render');
    await expect(instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      ...result,
      expectedRevision: 3,
      destinationIndex: 0,
      title: 'Duplicate cut',
      filePath: duplicateRender,
    })).rejects.toThrow(/duplicates the saved variant/);
    expect(readOutput(root, created.id)?.socialVariantSet).toMatchObject({ revision: 3 });
    expect(readOutput(root, created.id)?.socialVariantSet?.variants).toHaveLength(1);
  });

  test('restores partial success from disk and resumes through the exact bound editor session', async () => {
    const created = await service().create(WORKSPACE_ID, {
      ...request({ variantsPerSource: 2 }),
      requestedByClientId: 'client-1',
    });
    const started = await service().start(WORKSPACE_ID, created.id, 1);
    const renderDir = join(root, 'renders');
    mkdirSync(renderDir, { recursive: true });
    const firstPath = join(renderDir, 'before-restart.mp4');
    writeFileSync(firstPath, 'render-before-restart');
    const partial = await service().recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 2,
      sourceId: started.socialVariantSet!.sources[0]!.id,
      destinationIndex: 0,
      title: 'Saved before restart',
      hook: 'Open on the payoff.',
      editorialMode: 'payoff-first',
      editorialIntent: 'Preserve this completed version across restart.',
      filePath: firstPath,
    });
    expect(partial.socialVariantSet).toMatchObject({ revision: 3, status: 'partially-ready' });

    const restarted = service();
    const restored = restarted.getForEditor(WORKSPACE_ID, created.id, 'editor-session-1', 'raw-video-editor');
    expect(restored.socialVariantSet).toMatchObject({
      revision: 3,
      editorSessionId: 'editor-session-1',
      status: 'partially-ready',
    });
    expect(restored.socialVariantSet?.variants.filter((variant) => variant.state === 'ready')).toHaveLength(1);

    const secondPath = join(renderDir, 'after-restart.mp4');
    writeFileSync(secondPath, 'render-after-restart');
    const completed = await restarted.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 3,
      sourceId: started.socialVariantSet!.sources[0]!.id,
      destinationIndex: 0,
      title: 'Finished after restart',
      hook: 'Open somewhere else.',
      editorialMode: 'alternate-open',
      editorialIntent: 'Finish only the remaining authorized slot.',
      filePath: secondPath,
    });
    expect(completed.socialVariantSet).toMatchObject({ revision: 4, status: 'ready' });
    expect(completed.socialVariantSet?.variants).toHaveLength(2);
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

  test('rebinds a live set to a replacement editor with a revision fence', async () => {
    const instance = service();
    const created = await instance.create(WORKSPACE_ID, { ...request(), requestedByClientId: 'client-1' });
    const rebound = await instance.rebindEditor(WORKSPACE_ID, {
      outputId: created.id,
      expectedRevision: 1,
      editorSessionId: 'replacement-editor',
    });
    expect(rebound.socialVariantSet).toMatchObject({ revision: 2, editorSessionId: 'replacement-editor' });
    expect(rebound.origin).toMatchObject({ sessionId: 'replacement-editor', agentSlug: 'raw-video-editor' });
    await expect(instance.rebindEditor(WORKSPACE_ID, {
      outputId: created.id,
      expectedRevision: 1,
      editorSessionId: 'another-editor',
    })).rejects.toThrow('Expected revision 1, found 2');

    const readyCandidate = await instance.create(WORKSPACE_ID, {
      ...request({ variantsPerSource: 1 }),
      requestedByClientId: 'client-1',
    });
    const started = await instance.start(WORKSPACE_ID, readyCandidate.id, 1);
    const readyPath = join(root, 'renders', 'ready.mp4');
    mkdirSync(join(root, 'renders'), { recursive: true });
    writeFileSync(readyPath, 'ready-render');
    const ready = await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: readyCandidate.id,
      expectedRevision: 2,
      sourceId: started.socialVariantSet!.sources[0]!.id,
      destinationIndex: 0,
      title: 'Ready cut',
      hook: 'Open immediately.',
      editorialMode: 'direct',
      editorialIntent: 'Use the strongest moment.',
      filePath: readyPath,
    });
    expect(ready.socialVariantSet?.status).toBe('ready');
    await expect(instance.rebindEditor(WORKSPACE_ID, {
      outputId: ready.id,
      expectedRevision: ready.socialVariantSet!.revision,
      editorSessionId: 'replacement-editor',
    })).rejects.toThrow('ready Variant Set cannot be continued');
  });

  test('lists only intact ready variants for an exact ready campaign profile', async () => {
    const instance = service({ scope: 'campaign' });
    const created = await instance.create(WORKSPACE_ID, {
      ...request({ variantsPerSource: 1 }),
      requestedByClientId: 'client-1',
    });
    const started = await instance.start(WORKSPACE_ID, created.id, 1);
    const renderDir = join(root, 'renders');
    mkdirSync(renderDir, { recursive: true });
    const filePath = join(renderDir, 'usable.mp4');
    writeFileSync(filePath, 'usable-render');
    await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 2,
      sourceId: started.socialVariantSet!.sources[0]!.id,
      destinationIndex: 0,
      title: 'Usable cut',
      hook: 'Open on the chorus.',
      editorialMode: 'fast-cut',
      editorialIntent: 'Lead with the strongest beat.',
      filePath,
    });
    const query = {
      campaignId: WORKSPACE_ID,
      platform: 'instagram' as const,
      profileId: 'artist secondary profile',
      accountRole: 'secondary' as const,
      unscheduledOnly: true,
    };
    const usable = await instance.listUsable(WORKSPACE_ID, query);
    expect(usable).toHaveLength(1);
    expect(usable[0]).toMatchObject({ outputId: created.id, status: 'ready-to-use', scheduledWorkOrderIds: [] });
    expect(await instance.listUsable(WORKSPACE_ID, { ...query, accountRole: 'primary' })).toEqual([]);
    await expect(service({ scope: 'campaign', profileReady: false }).listUsable(WORKSPACE_ID, query)).rejects.toThrow('Reconnect this account');
  });

  test('never assigns an unbound ready variant to a profile during discovery', async () => {
    const instance = service({ scope: 'campaign' });
    const created = await instance.create(WORKSPACE_ID, {
      ...request({
        variantsPerSource: 1,
        destinationIntents: [{ platform: 'instagram', accountRole: 'secondary', mode: 'standard' }],
      }),
      requestedByClientId: 'client-1',
    });
    const started = await instance.start(WORKSPACE_ID, created.id, 1);
    const renderDir = join(root, 'renders');
    mkdirSync(renderDir, { recursive: true });
    const filePath = join(renderDir, 'unbound.mp4');
    writeFileSync(filePath, 'unbound-render');
    await instance.recordResult(WORKSPACE_ID, 'editor-session-1', 'raw-video-editor', {
      outputId: created.id,
      expectedRevision: 2,
      sourceId: started.socialVariantSet!.sources[0]!.id,
      destinationIndex: 0,
      title: 'Unbound cut', hook: 'Open strong.', editorialMode: 'direct', editorialIntent: 'A clean cut.', filePath,
    });

    expect(await instance.listUsable(WORKSPACE_ID, {
      campaignId: WORKSPACE_ID,
      platform: 'instagram',
      profileId: 'artist secondary profile',
      accountRole: 'secondary',
    })).toEqual([]);
  });
});
