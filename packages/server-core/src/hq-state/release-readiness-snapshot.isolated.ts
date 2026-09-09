import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'manager-readiness-snapshot-'));
const previousConfigDir = process.env.CRAFT_CONFIG_DIR;
process.env.CRAFT_CONFIG_DIR = join(root, 'config');
let config: typeof import('@craft-agent/shared/config');
let context: typeof import('@craft-agent/shared/workspace-context');
let artistContext: typeof import('@craft-agent/shared/artist-context');
let snapshot: typeof import('./snapshot');
beforeAll(async () => {
  config = await import('@craft-agent/shared/config');
  context = await import('@craft-agent/shared/workspace-context');
  artistContext = await import('@craft-agent/shared/artist-context');
  snapshot = await import('./snapshot');
  config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null });
});
afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
  rmSync(root, { recursive: true, force: true });
});

test('campaign snapshot exposes empty canon separately from done Essentials and filters excluded work', () => {
  const campaignRoot = join(root, 'empty-kit');
  mkdirSync(campaignRoot);
  const campaign = config.addWorkspace({ name: 'Empty Kit Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' });
  const board = artistContext.buildDefaultReleaseBoard(campaign.id);
  board.categories[0]!.items[0]!.status = 'done';
  context.upsertContextDoc(campaignRoot, {
    slug: 'release-board', metadata: artistContext.releaseBoardMetadata(board), body: artistContext.serializeReleaseBoardBody(board),
  });
  const result = snapshot.buildManagerCampaignSnapshot(campaign, true);
  expect(result.releaseReadiness?.essentials.done).toBe(1);
  expect(result.releaseReadiness?.kit.categories[0]?.ready).toBe(0);
  expect(result.readiness?.nextMissing).not.toContain('Clean Version');
  expect(result.readiness?.nextMissing).toContain('Spotify Canvas');
  expect(result.sourceHealth).toContainEqual({ source: `${campaign.id}:release-kit`, status: 'fresh' });
});

test('malformed canon surfaces source health without crashing or claiming known emptiness', () => {
  const campaignRoot = join(root, 'malformed-kit');
  mkdirSync(join(campaignRoot, 'release-kit'), { recursive: true });
  const campaign = config.addWorkspace({ name: 'Malformed Kit Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' });
  writeFileSync(join(campaignRoot, 'release-kit', 'manifest.json'), '{broken');
  const result = snapshot.buildManagerCampaignSnapshot(campaign, true);
  expect(result.releaseReadiness?.kit).toEqual({ status: 'malformed', categories: [] });
  expect(result.sourceHealth).toContainEqual(expect.objectContaining({ source: `${campaign.id}:release-kit`, status: 'malformed' }));
});

test('HQ release advice follows approved campaign files without requiring a populated HQ Vault', async () => {
  const hq = config.addWorkspace({ name: 'Readiness HQ', rootPath: join(root, 'hq'), artistWorkspaceScope: 'hq' });
  const campaign = config.addWorkspace({ name: 'Upcoming Single', rootPath: join(root, 'upcoming'), artistWorkspaceScope: 'campaign' });
  context.upsertContextDoc(campaign.rootPath, {
    slug: 'mission-brief',
    metadata: { name: 'Mission Brief', enabled: true, routing: { mode: 'broadcast' } },
    body: `\`\`\`json\n${JSON.stringify({ version: 1, id: 'mission-brief', workspaceId: campaign.id, status: 'full', completeness: 100, title: 'Upcoming Single', releaseDate: '2026-09-10', updatedAt: '2026-09-08T12:00:00.000Z' })}\n\`\`\``,
  });
  const { buildHqStateOfPlay } = await import('@craft-agent/shared/hq-state');
  const { ReleaseKitService } = await import('../release-kit/ReleaseKitService');
  const now = new Date('2026-09-08T12:00:00.000Z');
  const before = buildHqStateOfPlay(snapshot.buildHqStateInput(hq.rootPath, now));
  expect(before.nextMove.title).toContain('Upcoming Single');
  expect(before.nextMove.why).toContain('Audio');
  expect(before.nextMove.worker).toBe('concierge');

  const kit = new ReleaseKitService();
  for (const [category, file] of [['audio', 'master.wav'], ['artwork', 'cover.png'], ['video', 'clip.mp4'], ['images', 'photo.jpg']] as const) {
    const uploadPath = join(root, file);
    writeFileSync(uploadPath, `${category} fixture`);
    kit.promote(campaign.id, {
      category, subtype: category, makePrimary: true, uploadPath,
      source: { type: 'upload', originalFileName: file },
    }, 'user');
  }
  const after = buildHqStateOfPlay(snapshot.buildHqStateInput(hq.rootPath, now));
  expect(after.nextMove.title).not.toContain('Upcoming Single');
  expect(after.attention.some(item => item.text.includes('Upcoming Single') && item.text.includes('No usable'))).toBe(false);
  expect(context.loadContextDoc(hq.rootPath, 'artist-vault')).toBeNull();
});
