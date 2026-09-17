import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyMissionBrief, serializeMissionBriefBody } from '@craft-agent/shared/artist-context';
import { getContextDocFile, upsertContextDoc } from '@craft-agent/shared/workspace-context';
import { getReleaseKitManifestPath, materializeReleaseKitItem, resolveReleaseKitItemPath, updateReleaseKitItemUsage } from '@craft-agent/shared/release-kit';
import { getWebsiteCampaignContext, resolveWebsiteCampaignTarget, resolveWebsiteCampaignAssetContext, resolveWebsiteAssetContext, type WebsiteCampaignActor } from './website-campaign-context';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'website-campaign-'));
  roots.push(root);
  const campaign = { id: 'campaign-1', name: 'Release', rootPath: root, artistWorkspaceScope: 'campaign' };
  const hq = { id: 'hq', name: 'Artist HQ', rootPath: root, artistWorkspaceScope: 'hq' };
  const actor: WebsiteCampaignActor = { workspaces: [hq, campaign], currentWorkspaceId: hq.id, agentSlug: 'website-agent' };
  return { root, campaign, hq, actor };
}
function doc(root: string, slug: string, body: string, extra = {}) {
  upsertContextDoc(root, { slug, body, metadata: { name: slug, enabled: true, routing: { mode: 'broadcast' }, ...extra } });
}
function asset(root: string, title: string) {
  const source = join(root, `${title}.png`);
  writeFileSync(source, `image-${title}`);
  return materializeReleaseKitItem(root, { workspaceId: 'campaign-1', campaignId: 'campaign-1',
    source: { type: 'upload', originalFileName: `${title}.png` }, sourcePath: source,
    category: 'artwork', subtype: 'cover', title, promotedBy: 'user' }).item;
}

test('lists exact IDs without loading bodies and scopes Campaign callers to their own release', async () => {
  const { actor, campaign } = fixture();
  actor.workspaces = [...actor.workspaces, { ...campaign, id: 'campaign-2', name: 'Other' }];
  const list = await getWebsiteCampaignContext(actor);
  expect(list.campaigns?.map(item => item.campaignWorkspaceId)).toEqual(['campaign-1', 'campaign-2']);
  expect(list).not.toHaveProperty('release');
  const own = await getWebsiteCampaignContext({ ...actor, currentWorkspaceId: campaign.id });
  expect(own.campaigns).toHaveLength(1);
  expect((await getWebsiteCampaignContext({ ...actor, currentWorkspaceId: campaign.id }, { campaignWorkspaceId: 'campaign-2' })).ok).toBe(false);
});

test('rejects other agents, scopes, unknown IDs, paths and fuzzy names', async () => {
  const { actor, root } = fixture();
  for (const agentSlug of ['site-builder', 'concierge', 'other', undefined]) {
    expect((await getWebsiteCampaignContext({ ...actor, agentSlug })).ok).toBe(false);
  }
  expect((await getWebsiteCampaignContext({ ...actor, currentWorkspaceId: 'missing' })).ok).toBe(false);
  for (const id of ['Release', root, '', 'hq', '../campaign-1', 'campaign-1 ']) {
    expect((await getWebsiteCampaignContext(actor, { campaignWorkspaceId: id })).ok).toBe(false);
  }
  for (const agentSlug of ['site-builder', 'concierge', 'website-agent']) {
    expect(resolveWebsiteCampaignTarget({ ...actor, agentSlug }, 'campaign-1').id).toBe('campaign-1');
  }
  expect(() => resolveWebsiteCampaignTarget({ ...actor, agentSlug: 'other' }, 'campaign-1')).toThrow();
});

test('returns only narrow release fields, accepted direction and usable exact asset IDs', async () => {
  const { actor, root } = fixture();
  doc(root, 'mission-brief', serializeMissionBriefBody({ ...emptyMissionBrief('campaign-1'), title: 'My Release',
    releaseDate: '2026-10-01', campaignDateStatuses: { release: 'locked' }, promoBudget: 'SECRET BUDGET', rawNotes: 'PRIVATE NOTES',
    goal: 'SECRET STRATEGY', targetListener: 'PRIVATE SEGMENT', genre: 'pop' }));
  doc(root, 'campaign-creative-direction', 'Direction status: accepted\n\nA public celebration.');
  const approved = asset(root, 'approved');
  const restricted = asset(root, 'restricted');
  updateReleaseKitItemUsage(root, 'campaign-1', 'campaign-1', restricted.id, { restrictions: { blockedFromUse: true } });
  const result = await getWebsiteCampaignContext(actor, { campaignWorkspaceId: 'campaign-1' });
  expect(result.ok).toBe(true);
  expect(result.release?.title).toBe('My Release');
  expect(result.release?.releaseDateStatus).toBe('locked');
  expect(result.creativeDirection?.body).toContain('celebration');
  expect(result.assets?.map(item => item.itemId)).toEqual([approved.id]);
  expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE|rootPath|absolutePath|relativePath/);
});

test('honors private, disabled, targeted and malformed documents without leaking bodies', async () => {
  const { actor, root } = fixture();
  for (const metadata of [{ private: true }, { enabled: false }, { routing: { mode: 'targeted', agents: ['branding-agent'] } }]) {
    doc(root, 'mission-brief', serializeMissionBriefBody({ ...emptyMissionBrief('campaign-1'), title: 'Hidden' }), metadata);
    doc(root, 'campaign-creative-direction', 'Direction status: accepted\n\nHidden', metadata);
    doc(root, 'release-kit', 'Kit', metadata);
    asset(root, `hidden-${Object.keys(metadata)[0]}`);
    const result = await getWebsiteCampaignContext(actor, { campaignWorkspaceId: 'campaign-1' });
    expect(result.release).toBeNull();
    expect(result.creativeDirection).toBeNull();
    expect(result.assets).toEqual([]);
    expect(result.assetsUnavailable).toBe(true);
  }
  writeFileSync(getContextDocFile(root, 'campaign-creative-direction'), '---\nenabled: [broken\n---\nDirection status: accepted\n\nHidden');
  expect((await getWebsiteCampaignContext(actor, { campaignWorkspaceId: 'campaign-1' })).creativeDirection).toBeNull();
});

test('never presents proposed creative direction as accepted', async () => {
  const { actor, root } = fixture();
  doc(root, 'campaign-creative-direction', 'Direction status: proposed\n\nAn idea.');
  expect((await getWebsiteCampaignContext(actor, { campaignWorkspaceId: 'campaign-1' })).creativeDirection).toBeNull();
});

test('build/preview source resolution enforces kit privacy and actual worker routing', () => {
  const { actor, root } = fixture();
  expect(resolveWebsiteCampaignAssetContext(actor, 'campaign-1')).toEqual({ workspaceRootPath: root });
  for (const metadata of [{ private: true }, { enabled: false }, { routing: { mode: 'targeted', agents: ['branding-agent'] } }]) {
    doc(root, 'release-kit', 'Kit', metadata);
    for (const agentSlug of ['website-agent', 'site-builder']) {
      expect(() => resolveWebsiteCampaignAssetContext({ ...actor, agentSlug }, 'campaign-1')).toThrow('unavailable');
    }
  }
  doc(root, 'release-kit', 'Kit', { routing: { mode: 'targeted', agents: ['website-agent'] } });
  expect(resolveWebsiteCampaignAssetContext(actor, 'campaign-1').workspaceRootPath).toBe(root);
  expect(() => resolveWebsiteCampaignAssetContext({ ...actor, agentSlug: 'site-builder' }, 'campaign-1')).toThrow();
});

test('remote workspaces cannot be discovered or resolved through local files', async () => {
  const { actor, campaign } = fixture();
  actor.workspaces = [...actor.workspaces, { ...campaign, id: 'remote', remoteServer: { url: 'https://example.invalid' } }];
  expect((await getWebsiteCampaignContext(actor)).campaigns).toHaveLength(1);
  expect((await getWebsiteCampaignContext(actor, { campaignWorkspaceId: 'remote' })).ok).toBe(false);
  expect(() => resolveWebsiteCampaignAssetContext(actor, 'remote')).toThrow();
  expect((await getWebsiteCampaignContext({ ...actor, currentWorkspaceId: 'remote' })).ok).toBe(false);
});

test('omitting a Campaign source cannot bypass its explicit source access rules', () => {
  const { actor, root } = fixture();
  for (const metadata of [{ private: true }, { enabled: false }, { routing: { mode: 'targeted', agents: ['branding-agent'] } }]) {
    doc(root, 'release-kit', 'Kit', metadata);
    for (const agentSlug of ['website-agent', 'site-builder', 'concierge']) {
      const campaignActor = { ...actor, currentWorkspaceId: 'campaign-1', agentSlug };
      // Manager retains its existing non-private routing override; both forms must agree.
      if ('routing' in metadata && agentSlug === 'concierge') {
        expect(resolveWebsiteAssetContext(campaignActor)).toEqual(resolveWebsiteAssetContext(campaignActor, 'campaign-1'));
      } else {
        expect(() => resolveWebsiteAssetContext(campaignActor)).toThrow();
        expect(() => resolveWebsiteAssetContext(campaignActor, 'campaign-1')).toThrow();
      }
    }
    expect(resolveWebsiteAssetContext(actor)).toEqual({ workspaceRootPath: root });
    expect(resolveWebsiteAssetContext({ ...actor, currentWorkspaceId: 'campaign-1', agentSlug: 'other' }))
      .toEqual({ workspaceRootPath: root });
  }
});

test('byte-verifies approved assets without changing saved manifests and rejects symlinks', async () => {
  const { actor, root } = fixture();
  const changed = asset(root, 'changed');
  const linked = asset(root, 'linked');
  writeFileSync(resolveReleaseKitItemPath(root, changed.relativePath), 'tampered bytes');
  const linkedPath = resolveReleaseKitItemPath(root, linked.relativePath);
  unlinkSync(linkedPath);
  symlinkSync(join(root, 'linked.png'), linkedPath);
  const manifestBefore = readFileSync(getReleaseKitManifestPath(root), 'utf8');
  const result = await getWebsiteCampaignContext(actor, { campaignWorkspaceId: 'campaign-1' });
  expect(result.assets).toEqual([]);
  expect(readFileSync(getReleaseKitManifestPath(root), 'utf8')).toBe(manifestBefore);
});
