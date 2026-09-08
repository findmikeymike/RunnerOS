import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { previewCampaignCleanup, preserveCampaignForDeletion } from './storage.ts';
import type { CampaignCleanupOptions } from './types.ts';
import { emptyArtistVaultManifest, loadArtistVaultManifest } from '../artist-vault/storage.ts';
import { writeOutputFinalsRegistry } from '../outputs/finals.ts';
import { withArtistVaultMutex } from '../artist-vault/mutex.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(): CampaignCleanupOptions {
  const root = mkdtempSync(join(tmpdir(), 'campaign-preservation-')); roots.push(root);
  const campaignRootPath = join(root, 'campaign'); const hqRootPath = join(root, 'hq');
  mkdirSync(campaignRootPath); mkdirSync(hqRootPath);
  return { campaignRootPath, hqRootPath, campaignId: 'campaign-1', campaignName: 'Summer EP', hqWorkspaceId: 'hq', retainedMemoryCount: 3 };
}
function write(root: string, path: string, body: unknown): void {
  const destination = join(root, path); mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, typeof body === 'string' ? body : JSON.stringify(body));
}
function assetManifest(relativePath: string) {
  return { version: 1, workspaceId: 'campaign-1', files: [{ relativePath, rightsStatus: 'private', notes: 'Artist-owned' }] };
}

describe('campaign preservation', () => {
  test('keeps lyric drafts and timed captions even before they are marked final', () => {
    const options = fixture();
    for (const path of ['outputs/song/lyrics.txt', 'outputs/clip/captions.srt', 'context/lyrics/CONTEXT.md', 'outputs/plan/draft.md']) write(options.campaignRootPath, path, 'draft');
    const kept = previewCampaignCleanup(options).retainedFiles.map(file => file.relativePath);
    expect(kept).toEqual(['context/lyrics/CONTEXT.md', 'outputs/clip/captions.srt', 'outputs/song/lyrics.txt']);
  });
  test('keeps deliberate assets, media, business records and unknown saved docs; removes transient text', async () => {
    const options = fixture();
    for (const path of ['assets/docs/lyrics/song.txt', 'assets/design/source.custom', 'release-kit/copy.txt', 'sessions/one/attachments/demo.wav', 'context/rights-credits/CONTEXT.md', 'notes/my-saved-note.md']) write(options.campaignRootPath, path, path);
    for (const path of ['sessions/one/session.jsonl', 'context/release-plan/CONTEXT.md', 'tasks/done.json', 'logs/trace.txt', 'config.json']) write(options.campaignRootPath, path, 'transient');
    write(options.campaignRootPath, 'assets/manifest.json', assetManifest('assets/design/source.custom'));
    const preview = previewCampaignCleanup(options);
    expect(preview.retainedFileCount).toBe(6); expect(preview.deletedFileCount).toBe(6);
    expect(preview.retainedMemoryCount).toBe(3);
    const result = await preserveCampaignForDeletion(options, preview.previewToken);
    expect(result.pastReleaseLabel).toBe('Summer EP');
    const vault = loadArtistVaultManifest(options.hqRootPath, 'hq');
    expect(vault.assets).toHaveLength(7);
    for (const asset of vault.assets) {
      expect(asset.tags).toEqual(['past-release', 'release:Summer EP']);
      expect(asset.campaigns).toEqual(['campaign-1']); expect(asset.usableByAgents).toBe(false);
      expect(existsSync(join(options.hqRootPath, asset.relativePath!))).toBe(true);
    }
    const record = vault.assets.find(asset => asset.label.includes('release record'))!;
    const parsed = JSON.parse(readFileSync(join(options.hqRootPath, record.relativePath!), 'utf8'));
    expect(parsed.savedAssetMetadata['assets/manifest.json'][0].notes).toBe('Artist-owned');
    expect(existsSync(options.campaignRootPath)).toBe(true);
  });

  test('invalidates confirmation after any changed or added campaign text', async () => {
    const options = fixture(); write(options.campaignRootPath, 'sessions/one/session.jsonl', 'original');
    const first = previewCampaignCleanup(options);
    write(options.campaignRootPath, 'sessions/one/session.jsonl', 'changed!');
    await expect(preserveCampaignForDeletion(options, first.previewToken)).rejects.toThrow('changed');
    const second = previewCampaignCleanup(options);
    write(options.campaignRootPath, 'tasks/new.txt', 'new');
    await expect(preserveCampaignForDeletion(options, second.previewToken)).rejects.toThrow('changed');
    expect(existsSync(join(options.hqRootPath, 'vault/manifest.json'))).toBe(false);
  });

  test('blocks corrupt and missing declared assets instead of silently emptying manifests', async () => {
    const options = fixture(); write(options.campaignRootPath, 'assets/manifest.json', '{broken');
    expect(() => previewCampaignCleanup(options)).toThrow('invalid JSON');
    write(options.campaignRootPath, 'assets/manifest.json', { version: 999, workspaceId: 'campaign-1', files: [] });
    expect(() => previewCampaignCleanup(options)).toThrow('Repair assets/manifest.json');
    write(options.campaignRootPath, 'assets/manifest.json', assetManifest('assets/missing.wav'));
    expect(() => previewCampaignCleanup(options)).toThrow('missing');
    rmSync(join(options.campaignRootPath, 'assets/manifest.json'));
    write(options.hqRootPath, 'vault/manifest.json', { version: 1, assets: [] });
    expect(() => previewCampaignCleanup(options)).toThrow('Repair the Artist Vault');
  });

  test('repairs existing HQ links and preserves original privacy; retries produce no duplicate records', async () => {
    const options = fixture(); write(options.campaignRootPath, 'sessions/one/important.txt', 'keep this');
    const manifest = emptyArtistVaultManifest('hq');
    manifest.assets.push({ id: 'existing', label: 'Important', category: 'business', kind: 'contract', absolutePath: join(options.campaignRootPath, 'sessions/one/important.txt'), source: 'linked-file', status: 'approved', rightsStatus: 'private', usableByAgents: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
    write(options.hqRootPath, 'vault/manifest.json', manifest);
    const preview = previewCampaignCleanup(options);
    expect(preview.retainedFileCount).toBe(1);
    await preserveCampaignForDeletion(options, preview.previewToken);
    const repaired = loadArtistVaultManifest(options.hqRootPath).assets.find(asset => asset.id === 'existing')!;
    expect(repaired.absolutePath).toBeUndefined(); expect(repaired.rightsStatus).toBe('private');
    expect(readFileSync(join(options.hqRootPath, repaired.relativePath!), 'utf8')).toBe('keep this');
    const count = loadArtistVaultManifest(options.hqRootPath).assets.length;
    expect(count).toBe(2); // Original HQ asset plus the release record, no duplicate card.
    await preserveCampaignForDeletion(options, preview.previewToken);
    expect(loadArtistVaultManifest(options.hqRootPath).assets.length).toBe(count);
  });

  test('does not follow symlinks or traverse external relative asset paths', () => {
    const options = fixture(); write(options.hqRootPath, 'private.txt', 'private');
    symlinkSync(join(options.hqRootPath, 'private.txt'), join(options.campaignRootPath, 'linked.txt'));
    expect(() => previewCampaignCleanup(options)).toThrow('symbolic links');
    rmSync(join(options.campaignRootPath, 'linked.txt'));
    write(options.campaignRootPath, 'assets/manifest.json', assetManifest('../hq/private.txt'));
    expect(() => previewCampaignCleanup(options)).toThrow('escapes');
  });

  test('refuses a symlinked archive destination and preserves campaign', async () => {
    const options = fixture(); write(options.campaignRootPath, 'assets/file.wav', 'media');
    mkdirSync(join(options.hqRootPath, 'vault')); symlinkSync(options.campaignRootPath, join(options.hqRootPath, 'vault/past-releases'));
    const preview = previewCampaignCleanup(options);
    await expect(preserveCampaignForDeletion(options, preview.previewToken)).rejects.toThrow('symbolic links');
    expect(readFileSync(join(options.campaignRootPath, 'assets/file.wav'), 'utf8')).toBe('media');
  });

  test('external linked files are recorded without copying or touching their source', async () => {
    const options = fixture(); const external = join(dirname(options.hqRootPath), 'external.wav'); writeFileSync(external, 'outside');
    write(options.campaignRootPath, 'assets/manifest.json', { version: 1, workspaceId: 'campaign-1', files: [{ absolutePath: external }] });
    const preview = previewCampaignCleanup(options); expect(preview.warnings).toHaveLength(1); expect(preview.retainedFileCount).toBe(0);
    await preserveCampaignForDeletion(options, preview.previewToken);
    expect(readFileSync(external, 'utf8')).toBe('outside');
    const record = loadArtistVaultManifest(options.hqRootPath).assets[0]!;
    expect(JSON.parse(readFileSync(join(options.hqRootPath, record.relativePath!), 'utf8')).externalLinks[0].absolutePath).toBe(external);
  });

  test('waits for vault mutation mutex before reading or updating manifest', async () => {
    const options = fixture(); write(options.campaignRootPath, 'assets/file.wav', 'media');
    const preview = previewCampaignCleanup(options);
    let release!: () => void; let entered = false;
    const running = withArtistVaultMutex(options.hqRootPath, async () => { entered = true; await new Promise<void>(resolve => { release = resolve; }); });
    await Promise.resolve(); expect(entered).toBe(true);
    let done = false; const preservation = preserveCampaignForDeletion(options, preview.previewToken).then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false);
    release(); await running; await preservation; expect(done).toBe(true);
  });
  test('keeps approved, published and promoted Final text outputs, but discards draft planning output text', async () => {
    const options = fixture();
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
    for (let index = 0; index < ids.length; index++) {
      const id = ids[index]!;
      write(options.campaignRootPath, `outputs/${id}/copy.md`, 'Valuable press copy');
      write(options.campaignRootPath, `outputs/${id}/output.json`, {
        schemaVersion: 1, id, workspaceId: 'campaign-1', title: 'Press copy', slug: 'press-copy', kind: 'report',
        status: index === 0 ? 'published' : 'draft', summary: '', createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z',
        origin: { source: 'workflow' }, assets: [{ id: 'file', label: 'Press copy', role: 'primary', path: 'copy.md', mimeType: 'text/markdown' }],
        receipts: [], links: [], ...(index === 1 ? { approval: { state: 'approved' } } : {}),
      });
    }
    writeOutputFinalsRegistry(options.campaignRootPath, { schemaVersion: 1, updatedAt: '2026-05-01T10:00:00.000Z', finals: [{ id: 'final', scope: 'campaign', campaignId: 'campaign-1', slot: 'press-copy', outputId: ids[2]!, isPrimary: true, promotedAt: '2026-05-01T10:00:00.000Z', promotedBy: 'user' }] });
    const preview = previewCampaignCleanup(options);
    expect(preview.retainedFiles.map(file => file.relativePath)).toEqual(ids.slice(0, 3).map(id => `outputs/${id}/copy.md`));
    await preserveCampaignForDeletion(options, preview.previewToken);
    expect(loadArtistVaultManifest(options.hqRootPath).assets).toHaveLength(4);
    rmSync(join(options.campaignRootPath, `outputs/${ids[2]}/copy.md`));
    expect(() => previewCampaignCleanup(options)).toThrow('missing');
  });

  test('refuses a corrupt preserved copy on retry instead of claiming success', async () => {
    const options = fixture(); write(options.campaignRootPath, 'assets/source.wav', 'source audio');
    const preview = previewCampaignCleanup(options);
    await preserveCampaignForDeletion(options, preview.previewToken);
    const copied = loadArtistVaultManifest(options.hqRootPath).assets.find(asset => asset.label === 'source.wav')!;
    writeFileSync(join(options.hqRootPath, copied.relativePath!), 'corrupted');
    await expect(preserveCampaignForDeletion(options, preview.previewToken)).rejects.toThrow('differs');
    expect(readFileSync(join(options.campaignRootPath, 'assets/source.wav'), 'utf8')).toBe('source audio');
  });

  test('drops actual runtime stores and nested dependency media without following generated links', () => {
    const options = fixture();
    for (const path of ['runs/done/report.json', 'scheduled-work/jobs.json', 'agenda/done.md', 'records/agenda/task-threads/one.json', 'hooks.json', 'automations-history.jsonl', 'activated-agents.json', 'site/node_modules/package/logo.png', 'site/.git/objects/object']) write(options.campaignRootPath, path, 'runtime');
    write(options.campaignRootPath, 'site/index.html', 'authored site');
    symlinkSync(options.hqRootPath, join(options.campaignRootPath, 'site/node_modules/linked-package'));
    expect(previewCampaignCleanup(options).retainedFiles.map(file => file.relativePath)).toEqual(['site/index.html']);
  });

  test('preserves finished HTML supporting files and their relative layout without caching dependencies', async () => {
    const options = fixture(); const id = '55555555-5555-4555-8555-555555555555';
    const prefix = `outputs/${id}`;
    const contents = {
      'index.html': '<link href="styles/site.css"><script src="scripts/app.js"></script>',
      'styles/site.css': '@font-face { src: url(../fonts/artist.woff2) }',
      'scripts/app.js': 'window.siteReady = true',
      'fonts/artist.woff2': 'font bytes',
      'models/model.bin': 'model buffer',
    };
    for (const [path, body] of Object.entries(contents)) write(options.campaignRootPath, `${prefix}/${path}`, body);
    write(options.campaignRootPath, `${prefix}/node_modules/package/logo.png`, 'disposable dependency');
    write(options.campaignRootPath, `${prefix}/output.json`, {
      schemaVersion: 1, id, workspaceId: 'campaign-1', title: 'Website', slug: 'website', kind: 'report', status: 'published', summary: '',
      createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z', origin: { source: 'workflow' },
      assets: [{ id: 'html', label: 'Website', role: 'primary', path: 'index.html', mimeType: 'text/html' }], receipts: [], links: [],
    });
    const preview = previewCampaignCleanup(options);
    expect(preview.retainedFiles.map(file => file.relativePath).sort()).toEqual(Object.keys(contents).map(path => `${prefix}/${path}`).sort());
    await preserveCampaignForDeletion(options, preview.previewToken);
    const html = loadArtistVaultManifest(options.hqRootPath).assets.find(asset => asset.label === 'index.html')!;
    const copiedBundle = dirname(join(options.hqRootPath, html.relativePath!));
    for (const [path, body] of Object.entries(contents)) expect(readFileSync(join(copiedBundle, path), 'utf8')).toBe(body);
    expect(existsSync(join(copiedBundle, 'node_modules'))).toBe(false);
  });

});
