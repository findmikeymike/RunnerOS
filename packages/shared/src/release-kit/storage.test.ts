import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
  getReleaseKitManifestPath,
  loadReleaseKitManifest,
  materializeReleaseKitItem,
  releaseKitContextMetadata,
  removeReleaseKitItem,
  resolveReleaseKitItemPath,
  serializeReleaseKitContext,
  setReleaseKitPrimary,
  updateReleaseKitItemUsage,
  verifyReleaseKit,
  withReleaseKitLockAsync,
} from './index.ts';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'release-kit-'));
}

describe('release kit storage', () => {
  test('materializes an independent campaign-asset snapshot with provenance and hash', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'assets', 'audio', 'masters', 'single.wav');
    writeFileWithParents(source, 'master-v1');

    const result = materializeReleaseKitItem(workspace, {
      workspaceId: 'workspace-1',
      campaignId: 'campaign-1',
      source: { type: 'campaign-asset', assetId: 'asset-master' },
      sourcePath: source,
      category: 'audio',
      subtype: 'master',
      title: 'Single Master',
      mimeType: 'audio/wav',
      makePrimary: true,
      promotedBy: 'user',
    });

    const snapshot = resolveReleaseKitItemPath(workspace, result.item.relativePath);
    expect(result.item.source).toEqual({ type: 'campaign-asset', assetId: 'asset-master' });
    expect(result.item.relativePath).toBe('release-kit/audio/master/single.wav');
    expect(result.item.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.item.snapshotMtimeMs).toBeGreaterThan(0);
    expect(result.item.isPrimary).toBe(true);
    expect(readFileSync(snapshot, 'utf8')).toBe('master-v1');

    writeFileSync(source, 'master-v2');
    expect(readFileSync(snapshot, 'utf8')).toBe('master-v1');
  });

  test('preserves multiple finals and scopes Primary to category and subtype', () => {
    const workspace = tempWorkspace();
    const first = join(workspace, 'cover-a.png');
    const second = join(workspace, 'cover-b.png');
    const social = join(workspace, 'social.png');
    writeFileSync(first, 'a');
    writeFileSync(second, 'b');
    writeFileSync(social, 'social');

    const a = promoteOutput(workspace, first, 'output-a', 'artwork', 'single-cover', true);
    const b = promoteOutput(workspace, second, 'output-b', 'artwork', 'single-cover', true);
    const c = promoteOutput(workspace, social, 'output-c', 'images', 'social', true);
    const manifest = loadReleaseKitManifest(workspace, 'workspace-1', 'campaign-1');

    expect(manifest.items).toHaveLength(3);
    expect(manifest.items.find((item) => item.id === a.item.id)?.isPrimary).toBe(false);
    expect(manifest.items.find((item) => item.id === b.item.id)?.isPrimary).toBe(true);
    expect(manifest.items.find((item) => item.id === c.item.id)?.isPrimary).toBe(true);

    const reset = setReleaseKitPrimary(workspace, 'workspace-1', 'campaign-1', a.item.id);
    expect(reset.items.find((item) => item.id === a.item.id)?.isPrimary).toBe(true);
    expect(reset.items.find((item) => item.id === b.item.id)?.isPrimary).toBe(false);
    expect(reset.items.find((item) => item.id === c.item.id)?.isPrimary).toBe(true);
  });

  test('uses collision-safe snapshots and Windows-safe file names', () => {
    const workspace = tempWorkspace();
    const first = join(workspace, 'first', 'CON.txt');
    const second = join(workspace, 'second', 'CON.txt');
    writeFileWithParents(first, 'first');
    writeFileWithParents(second, 'second');

    const a = promoteOutput(workspace, first, 'output-a', 'documents', 'metadata', false);
    const b = promoteOutput(workspace, second, 'output-b', 'documents', 'metadata', false);

    expect(basename(a.item.relativePath)).not.toBe('CON.txt');
    expect(a.item.relativePath).not.toBe(b.item.relativePath);
  });

  test('avoids Unicode-normalization and case-only collisions before a Windows transfer', () => {
    const workspace = tempWorkspace();
    const first = join(workspace, 'first', 'Caf\u00e9 Cover.PNG');
    const second = join(workspace, 'second', 'Cafe\u0301 cover.png');
    writeFileWithParents(first, 'first');
    writeFileWithParents(second, 'second');

    const a = promoteOutput(workspace, first, 'output-a', 'artwork', 'cover', false);
    const b = promoteOutput(workspace, second, 'output-b', 'artwork', 'cover', false);

    expect(a.item.relativePath).not.toBe(b.item.relativePath);
    expect(a.item.relativePath).not.toContain('\\');
    expect(basename(b.item.relativePath)).toMatch(/-2\.png$/i);
  });

  test('rejects symbolic-link destinations beneath release-kit', () => {
    const workspace = tempWorkspace();
    const outside = tempWorkspace();
    const source = join(workspace, 'source.txt');
    writeFileSync(source, 'approved');
    mkdirSync(join(workspace, 'release-kit'), { recursive: true });
    symlinkSync(outside, join(workspace, 'release-kit', 'documents'), 'dir');

    expect(() => promoteOutput(workspace, source, 'output-link', 'documents', 'metadata', false)).toThrow(/symbolic link/i);
    expect(existsSync(join(outside, 'metadata', 'source.txt'))).toBe(false);
  });

  test('marks changed and missing snapshots without silently keeping them Primary', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover.png');
    writeFileSync(source, 'cover');
    const promoted = promoteOutput(workspace, source, 'output-cover', 'artwork', 'single-cover', true);
    const snapshot = resolveReleaseKitItemPath(workspace, promoted.item.relativePath);

    writeFileSync(snapshot, 'tampered');
    const drifted = verifyReleaseKit(workspace, 'workspace-1', 'campaign-1');
    expect(drifted.changed[0]?.status).toBe('needs-review');
    expect(drifted.changed[0]?.isPrimary).toBe(false);

    rmSync(snapshot, { force: true });
    const missing = verifyReleaseKit(workspace, 'workspace-1', 'campaign-1');
    expect(missing.changed[0]?.status).toBe('missing');
  });

  test('accepts a harmless touch after rechecking the snapshot hash', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover.png');
    writeFileSync(source, 'cover');
    const promoted = promoteOutput(workspace, source, 'output-cover', 'artwork', 'single-cover', true);
    const snapshot = resolveReleaseKitItemPath(workspace, promoted.item.relativePath);

    expect(verifyReleaseKit(workspace, 'workspace-1', 'campaign-1').changed).toEqual([]);

    const touched = new Date(Date.now() + 2_000);
    utimesSync(snapshot, touched, touched);
    const refreshed = verifyReleaseKit(workspace, 'workspace-1', 'campaign-1');
    expect(refreshed.changed).toHaveLength(1);
    expect(refreshed.changed[0]?.status).toBe('ready');
    expect(refreshed.changed[0]?.snapshotMtimeMs).not.toBe(promoted.item.snapshotMtimeMs);
    expect(verifyReleaseKit(workspace, 'workspace-1', 'campaign-1').changed).toEqual([]);
  });

  test('detects equal-size tampering even when mtime is restored', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover.png');
    writeFileSync(source, 'cover-a');
    const promoted = promoteOutput(workspace, source, 'output-cover', 'artwork', 'single-cover', true);
    const snapshot = resolveReleaseKitItemPath(workspace, promoted.item.relativePath);
    const original = statSync(snapshot);

    writeFileSync(snapshot, 'cover-b');
    utimesSync(snapshot, original.atime, original.mtime);
    const result = verifyReleaseKit(workspace, 'workspace-1', 'campaign-1');

    expect(result.changed[0]?.status).toBe('needs-review');
    expect(result.changed[0]?.isPrimary).toBe(false);
  });

  test('removes only the snapshot and manifest record', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'plan.md');
    writeFileSync(source, '# plan');
    const promoted = promoteOutput(workspace, source, 'output-plan', 'plans', 'campaign-plan', false);
    const snapshot = resolveReleaseKitItemPath(workspace, promoted.item.relativePath);

    const removed = removeReleaseKitItem(workspace, 'workspace-1', 'campaign-1', promoted.item.id);

    expect(removed.manifest.items).toEqual([]);
    expect(existsSync(snapshot)).toBe(false);
    expect(readFileSync(source, 'utf8')).toBe('# plan');
  });

  test('serializes compact agent context with exact trusted paths', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover.png');
    writeFileSync(source, 'cover');
    const promoted = promoteOutput(workspace, source, 'output-cover', 'artwork', 'single-cover', true);
    const body = serializeReleaseKitContext(promoted.manifest);

    expect(releaseKitContextMetadata().delivery).toBe('always');
    expect(body).toContain('approved campaign Release Kit');
    expect(body).toContain(promoted.item.id);
    expect(body).toContain(promoted.item.relativePath);
    expect(body).toContain('Primary: cover.png');
  });

  test('withholds paths and Track Intelligence for snapshots that are not ready', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'master.wav');
    writeFileSync(source, 'master');
    const promoted = materializeReleaseKitItem(workspace, {
      workspaceId: 'workspace-1',
      campaignId: 'campaign-1',
      source: { type: 'upload', originalFileName: 'master.wav' },
      sourcePath: source,
      category: 'audio',
      subtype: 'master',
      promotedBy: 'user',
      trackIntelligence: {
        id: 'reviewed-1',
        lyrics: {
          lines: [{ id: 'line-1', text: 'private draft lyric', startMs: 0, endMs: 1_000 }],
          timingSource: 'transcription',
          timingStatus: 'ready',
        },
        character: { genre: ['alt-pop'] },
        provenance: {
          processedLocally: true,
          sourceSha256: createHash('sha256').update('master').digest('hex'),
        },
        reviewedAt: '2026-08-31T12:00:00.000Z',
        reviewedBy: { type: 'user', clientId: 'client-1' },
      },
    });
    const unsafePath = promoted.item.relativePath;
    const unsafeManifest = {
      ...promoted.manifest,
      items: promoted.manifest.items.map((item) => ({ ...item, status: 'needs-review' as const })),
    };

    const body = serializeReleaseKitContext(unsafeManifest);

    expect(body).not.toContain(unsafePath);
    expect(body).not.toContain('private draft lyric');
    expect(body).not.toContain('alt-pop');
    expect(body).not.toContain('trackIntelligence');
  });

  test('loads V1 manifests without rewriting or changing asset identity and snapshot trust', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'cover.png');
    writeFileSync(source, 'cover');
    const promoted = promoteOutput(workspace, source, 'output-cover', 'artwork', 'single-cover', true);
    const legacy = JSON.parse(readFileSync(getReleaseKitManifestPath(workspace), 'utf8')) as {
      schemaVersion: number;
      items: Array<Record<string, unknown>>;
    };
    legacy.schemaVersion = 1;
    delete legacy.items[0]?.usage;
    writeFileSync(getReleaseKitManifestPath(workspace), JSON.stringify(legacy));

    const migrated = loadReleaseKitManifest(workspace, 'workspace-1', 'campaign-1');

    expect(migrated.schemaVersion).toBe(1);
    expect(migrated.items[0]?.id).toBe(promoted.item.id);
    expect(migrated.items[0]?.sha256).toBe(promoted.item.sha256);
    expect(migrated.items[0]?.relativePath).toBe(promoted.item.relativePath);
    expect(migrated.items[0]?.usage).toEqual({
      bestFor: [],
      contentRating: 'unknown',
      restrictions: {
        blockedFromUse: false,
        needsRightsClearance: false,
        artistLikenessRestricted: false,
      },
      updatedAt: promoted.item.promotedAt,
      updatedBy: 'migration',
    });
    expect((JSON.parse(readFileSync(getReleaseKitManifestPath(workspace), 'utf8')) as { schemaVersion: number }).schemaVersion).toBe(1);
  });

  test('persists bounded usage metadata and exposes safe fields to agents', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'press.png');
    writeFileSync(source, 'press');
    const promoted = promoteOutput(workspace, source, 'output-press', 'images', 'press', false);

    const manifest = updateReleaseKitItemUsage(workspace, 'workspace-1', 'campaign-1', promoted.item.id, {
      bestFor: ['social', 'press', 'social'],
      contentRating: 'clean',
      notes: 'Best for launch-day posts.',
      restrictions: { needsRightsClearance: true },
    });
    const usage = manifest.items[0]?.usage;

    expect(manifest.schemaVersion).toBe(3);
    expect(usage?.bestFor).toEqual(['social', 'press']);
    expect(usage?.contentRating).toBe('clean');
    expect(usage?.notes).toBe('Best for launch-day posts.');
    expect(usage?.restrictions.needsRightsClearance).toBe(true);
    expect(usage?.updatedBy).toBe('user');
    expect(serializeReleaseKitContext(manifest)).toContain('needsRightsClearance');
  });

  test('keeps full notes in storage but bounds notes injected into agent context', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'press.png');
    writeFileSync(source, 'press');
    const promoted = promoteOutput(workspace, source, 'output-long-notes', 'images', 'press', false);
    const notes = 'n'.repeat(600);
    const manifest = updateReleaseKitItemUsage(workspace, 'workspace-1', 'campaign-1', promoted.item.id, { notes });
    const context = serializeReleaseKitContext(manifest);

    expect(manifest.items[0]?.usage.notes).toBe(notes);
    expect(context).toContain(`${'n'.repeat(277)}...`);
    expect(context).not.toContain(notes);
  });

  test('rejects malformed or unbounded usage metadata', () => {
    const workspace = tempWorkspace();
    const source = join(workspace, 'press.png');
    writeFileSync(source, 'press');
    const promoted = promoteOutput(workspace, source, 'output-press', 'images', 'press', false);

    expect(() => updateReleaseKitItemUsage(workspace, 'workspace-1', 'campaign-1', promoted.item.id, {
      bestFor: ['social', 'unsupported'] as never,
    })).toThrow(/usage metadata is invalid/i);
    expect(() => updateReleaseKitItemUsage(workspace, 'workspace-1', 'campaign-1', promoted.item.id, {
      notes: 'x'.repeat(1_001),
    })).toThrow(/1000 characters or fewer|usage metadata is invalid/i);
    expect(() => updateReleaseKitItemUsage(workspace, 'workspace-1', 'campaign-1', promoted.item.id, {
      restrictions: { blockedFromUse: 'yes' as never },
    })).toThrow(/usage metadata is invalid/i);
  });

  test('rejects invalid manifests and path traversal', () => {
    const workspace = tempWorkspace();
    writeFileWithParents(getReleaseKitManifestPath(workspace), '{"schemaVersion":1,"items":"bad"}');

    expect(() => loadReleaseKitManifest(workspace, 'workspace-1', 'campaign-1')).toThrow(/manifest is invalid/i);
    expect(() => resolveReleaseKitItemPath(workspace, 'release-kit/../private.txt')).toThrow(/invalid|outside|escapes/i);
  });

  test('rejects a valid manifest owned by another workspace', () => {
    const workspace = tempWorkspace();
    writeFileWithParents(getReleaseKitManifestPath(workspace), JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'workspace-b',
      campaignId: 'campaign-b',
      updatedAt: new Date().toISOString(),
      items: [],
    }));

    expect(() => loadReleaseKitManifest(workspace, 'workspace-a', 'campaign-a')).toThrow(/different workspace or campaign/i);
  });

  test('waits for a proven-live async owner and rejects same-process sync reentry', async () => {
    const workspace = tempWorkspace();
    let release!: () => void;
    let entered = false;
    const held = withReleaseKitLockAsync(workspace, async () => {
      entered = true;
      await expect(withReleaseKitLockAsync(workspace, async () => {})).rejects.toThrow(/cannot be re-entered/i);
      await new Promise<void>((resolveHeld) => { release = resolveHeld; });
    });
    while (!entered) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));

    const source = join(workspace, 'waiting.txt');
    writeFileSync(source, 'waiting');
    expect(() => promoteOutput(workspace, source, 'output-waiting', 'documents', 'metadata', false)).toThrow(/busy with another operation/i);

    let secondEntered = false;
    const queued = withReleaseKitLockAsync(workspace, async () => { secondEntered = true; });
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    expect(secondEntered).toBe(false);
    release();
    await Promise.all([held, queued]);
    expect(secondEntered).toBe(true);
  });
});

function promoteOutput(
  workspace: string,
  sourcePath: string,
  outputId: string,
  category: 'artwork' | 'images' | 'documents' | 'plans',
  subtype: string,
  makePrimary: boolean,
) {
  return materializeReleaseKitItem(workspace, {
    workspaceId: 'workspace-1',
    campaignId: 'campaign-1',
    source: { type: 'output', outputId },
    sourcePath,
    category,
    subtype,
    makePrimary,
    promotedBy: 'user',
  });
}

function writeFileWithParents(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}
