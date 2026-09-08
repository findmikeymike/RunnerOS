import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildDefaultReleaseBoard, type ReleaseBoard } from '@craft-agent/shared/artist-context';
import { defaultReleaseKitUsage, getReleaseKitManifestPath, type ReleaseKitItem } from '@craft-agent/shared/release-kit';
import { normalizeManagerReleaseReadiness } from '@craft-agent/shared/hq-state';
import { loadCampaignReleaseReadiness, nextMissingReleaseEssentials } from './release-readiness';

const roots: string[] = [];
const workspaceId = 'campaign-a';
const updatedAt = '2026-09-07T12:00:00.000Z';
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'manager-release-readiness-'));
  roots.push(root);
  return root;
}
function item(category: ReleaseKitItem['category'], overrides: Partial<ReleaseKitItem> = {}): ReleaseKitItem {
  return {
    id: `kit_${category}`, campaignId: workspaceId, category, subtype: 'approved', title: `${category} final`,
    source: { type: 'upload', originalFileName: 'final.bin' }, relativePath: `release-kit/${category}/final.bin`,
    sha256: 'a'.repeat(64), status: 'ready', isPrimary: true, promotedAt: updatedAt, promotedBy: 'user',
    usage: defaultReleaseKitUsage(updatedAt), ...overrides,
  };
}
function writeKit(root: string, items: ReleaseKitItem[], scope = workspaceId) {
  const path = getReleaseKitManifestPath(root);
  mkdirSync(join(root, 'release-kit'), { recursive: true });
  writeFileSync(path, JSON.stringify({ schemaVersion: 3, workspaceId: scope, campaignId: scope, updatedAt, items }));
}
function read(root: string, board: ReleaseBoard = buildDefaultReleaseBoard(workspaceId)) {
  return loadCampaignReleaseReadiness(root, workspaceId, { ok: true, board }, true);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('campaign release readiness from canon and Essentials', () => {
  test('reports all five actual Kit categories independently of unfinished board items', () => {
    const root = workspace();
    writeKit(root, ['audio', 'artwork', 'video', 'images', 'plans'].map((category) => item(category as ReleaseKitItem['category'])));
    const before = readFileSync(getReleaseKitManifestPath(root), 'utf8');
    const result = read(root);
    expect(result.kit.status).toBe('available');
    expect(result.kit.categories.map((category) => [category.label, category.ready])).toEqual([
      ['Audio', 1], ['Single art / artwork', 1], ['Content video', 1], ['Content images', 1], ['Plans', 1],
    ]);
    expect(result.essentials.done).toBe(0);
    // These fixtures intentionally have no payload files: snapshot reads only saved canon metadata.
    expect(readFileSync(getReleaseKitManifestPath(root), 'utf8')).toBe(before);
  });

  test('missing manifest is valid empty canon and does not write a manifest', () => {
    const root = workspace();
    const result = read(root);
    expect(result.kit.status).toBe('available');
    expect(result.kit.updatedAt).toBeUndefined();
    expect(result.kit.categories).toHaveLength(5);
    expect(result.kit.categories.every((category) => category.ready === 0)).toBe(true);
    expect(existsSync(getReleaseKitManifestPath(root))).toBe(false);
  });

  test('a board Master marked done cannot make an empty Kit approved', () => {
    const board = buildDefaultReleaseBoard(workspaceId);
    board.categories[0]!.items.find((entry) => entry.id === 'master')!.status = 'done';
    const result = read(workspace(), board);
    expect(result.essentials.done).toBe(1);
    expect(result.essentials.items).toContainEqual({ label: 'Master File', status: 'done' });
    expect(result.kit.categories.find((category) => category.label === 'Audio')!.ready).toBe(0);
  });

  test('Canvas and video work survive the old five-item cutoff; excluded optional work does not', () => {
    const board = buildDefaultReleaseBoard(workspaceId);
    const result = read(workspace(), board);
    expect(result.essentials.items).toContainEqual({ label: 'Spotify Canvas', status: 'needed' });
    expect(result.essentials.items).toContainEqual({ label: 'Performance Clips', status: 'needed' });
    expect(result.essentials.items.some((entry) => entry.label === 'Clean Version')).toBe(false);
    expect(result.essentials.items.some((entry) => entry.label === 'Instrumental')).toBe(false);
    expect(nextMissingReleaseEssentials(board)).toContain('Spotify Canvas');
    expect(nextMissingReleaseEssentials(board)).not.toContain('Clean Version');
  });

  test('preserves active statuses and included optional items while skipped work stays outside Essentials', () => {
    const board = buildDefaultReleaseBoard(workspaceId);
    const items = board.categories[0]!.items;
    items[0]!.status = 'done';
    items[1]!.status = 'in-progress';
    items[2]!.status = 'review';
    items[3]!.status = 'skipped';
    items.find((entry) => entry.id === 'clean-version')!.included = true;
    const readiness = read(workspace(), board);
    const result = readiness.essentials;
    expect(result.items.slice(0, 4).map((entry) => entry.status)).toEqual(['done', 'in-progress', 'review', 'needed']);
    expect(result.items.some((entry) => entry.status === 'skipped')).toBe(false);
    expect(normalizeManagerReleaseReadiness(readiness)?.essentials).toEqual(result);
    expect(result.done).toBe(1);
    expect(result.items.some((entry) => entry.label === 'Clean Version')).toBe(true);
    expect(result.total).toBe(result.items.length);
  });

  test('bounds included items and reports exactly how many were omitted', () => {
    const board = buildDefaultReleaseBoard(workspaceId);
    board.categories = [{ ...board.categories[0]!, items: Array.from({ length: 47 }, (_, index) => ({
      id: `essential-${index}`, label: `Essential ${index}`, status: index === 46 ? 'done' : 'needed', tier: 'core',
    })) }];
    const result = read(workspace(), board).essentials;
    expect(result.items).toHaveLength(40);
    expect(result.omitted).toBe(7);
    expect(result.total).toBe(47);
    expect(result.done).toBe(1);
  });

  test('skipped work does not inflate omissions or invalidate an entirely skipped checklist', () => {
    const board = buildDefaultReleaseBoard(workspaceId);
    board.categories = [{ ...board.categories[0]!, items: Array.from({ length: 45 }, (_, index) => ({
      id: `essential-${index}`, label: `Essential ${index}`, status: index >= 40 ? 'skipped' : 'needed', tier: 'core',
    })) }];
    const result = read(workspace(), board);
    expect(result.essentials.total).toBe(40);
    expect(result.essentials.omitted).toBe(0);
    expect(normalizeManagerReleaseReadiness(result)?.essentials).toEqual(result.essentials);
    board.categories[0]!.items.forEach((entry) => { entry.status = 'skipped'; });
    const skipped = read(workspace(), board);
    expect(skipped.essentials).toEqual({ status: 'available', done: 0, total: 0, items: [], omitted: 0 });
    expect(normalizeManagerReleaseReadiness(skipped)?.essentials).toEqual(skipped.essentials);
  });

  test('separates needs-review, missing and restricted assets from ready assets', () => {
    const root = workspace();
    const blocked = item('audio', { id: 'kit_blocked' });
    blocked.usage.restrictions.blockedFromUse = true;
    const rights = item('audio', { id: 'kit_rights' });
    rights.usage.restrictions.needsRightsClearance = true;
    writeKit(root, [item('audio'), item('audio', { id: 'kit_review', status: 'needs-review' }),
      item('audio', { id: 'kit_missing', status: 'missing' }), blocked, rights]);
    expect(read(root).kit.categories[0]).toEqual({ label: 'Audio', ready: 1, needsReview: 1, missing: 1, restricted: 2 });
  });

  test('malformed Kit stays malformed rather than looking like missing assets', () => {
    const root = workspace();
    writeKit(root, []);
    writeFileSync(getReleaseKitManifestPath(root), '{broken');
    expect(read(root).kit).toEqual({ status: 'malformed', categories: [] });
  });

  test('rejects both a foreign campaign manifest and foreign rows in an otherwise matching manifest', () => {
    const root = workspace();
    writeKit(root, [item('audio')], 'campaign-b');
    expect(read(root).kit.status).toBe('malformed');
    writeKit(root, [item('audio', { campaignId: 'campaign-b' })]);
    expect(read(root).kit.status).toBe('malformed');
  });

  test('unavailable or foreign Essentials never masquerade as a valid empty checklist', () => {
    const root = workspace();
    const absent = loadCampaignReleaseReadiness(root, workspaceId, { ok: false, board: null, error: 'No board' }, false);
    expect(absent.essentials.status).toBe('unavailable');
    expect(read(root, buildDefaultReleaseBoard('campaign-b')).essentials.status).toBe('malformed');
  });
});
