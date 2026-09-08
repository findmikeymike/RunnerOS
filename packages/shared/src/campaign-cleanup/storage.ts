import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { classifyVaultAsset, inferVaultMimeType } from '../artist-vault/classify.ts';
import { emptyArtistVaultManifest, getArtistVaultManifestPath, loadArtistVaultManifest, resolveArtistVaultAssetPath } from '../artist-vault/storage.ts';
import { withArtistVaultMutex } from '../artist-vault/mutex.ts';
import type { VaultAssetRecord, VaultManifest } from '../artist-vault/types.ts';
import { hashFileSha256 } from '../utils/hash-file.ts';
import { assertPathWithinRealRoot, verifiedCopyFileSync } from '../workspaces/verified-copy.ts';
import { readOutputFinalsRegistry } from '../outputs/finals.ts';
import { isOutputManifest } from '../outputs/validation.ts';
import type { CampaignCleanupOptions, CampaignCleanupPreview, CampaignCleanupResult, CampaignRetainedFile } from './types.ts';

const MEDIA = new Set('.wav .aiff .aif .flac .mp3 .m4a .ogg .opus .aac .mp4 .mov .m4v .webm .avi .mkv .png .jpg .jpeg .webp .gif .svg .heic .tif .tiff .psd .ai .eps .indd .fig .blend .glb .gltf .obj .fbx .aep .prproj .drp .als .logicx .band .flp .ptx .mid .midi'.split(' '));
const TRANSIENT_ROOTS = new Set(['sessions', 'context', 'outputs', 'workflows', 'workflow-runs', 'automations', 'tasks', 'plans', 'logs', 'tmp', 'temp', '.cache', 'cache', '.git', 'node_modules', 'browser', 'sources', 'skills', 'agents', 'statuses', 'permissions', 'runs', 'scheduled-work', 'agenda', '.claude-plugin']);
const BUSINESS = /(^|[\/_. -])(contracts?|splits?|rights|royalt(?:y|ies)|credits|invoices?|receipts?|licenses?|agreements?|registrations?)([\/_. -]|$)/i;
const METADATA = new Set(['assets/manifest.json', 'release-kit/manifest.json', 'vault/manifest.json', 'config.json', 'workspace.json', 'automations.json', 'agent-library.json', 'hooks.json', 'activated-agents.json', 'activated-workflows.json', 'automations-history.jsonl', 'automations-retry-queue.jsonl', 'automations-scheduler-state.json', 'events.jsonl', 'webhook-deliveries.jsonl']);
const GENERATED_DIRS = new Set(['node_modules', '.git', '.cache', 'cache', 'caches']);
type InventoryFile = CampaignRetainedFile & { retained: boolean };
type DeclaredRecord = { relativePath?: string; absolutePath?: string; [key: string]: unknown };

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function inside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function readJson(path: string): any {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`Cannot safely finish campaign: invalid JSON in ${basename(dirname(path))}/${basename(path)}.`); }
}
function strictVault(options: CampaignCleanupOptions): VaultManifest {
  const path = assertPathWithinRealRoot(options.hqRootPath, getArtistVaultManifestPath(options.hqRootPath));
  if (!existsSync(path)) return emptyArtistVaultManifest(options.hqWorkspaceId);
  const raw = readJson(path);
  const parsed = loadArtistVaultManifest(options.hqRootPath, options.hqWorkspaceId);
  // The normal read API falls back to an empty manifest on corruption. Deletion must never do that.
  if (JSON.stringify(raw) !== JSON.stringify(parsed)) throw new Error('Repair the Artist Vault manifest before finishing this campaign.');
  return parsed;
}
function retentionReason(path: string): string | undefined {
  if (path.split('/').some(part => GENERATED_DIRS.has(part))) return undefined;
  if (/^records\/(agenda|scheduled-work|tasks|runs)\//.test(path)) return undefined;
  if (METADATA.has(path) || /(^|\/)(output\.json|\.DS_Store)$/.test(path)) return undefined;
  if (path.startsWith('assets/') || path.startsWith('release-kit/')) return 'Saved campaign asset';
  if (MEDIA.has(extname(path).toLowerCase())) return 'Creative media or project file';
  if (['.lrc', '.srt', '.vtt'].includes(extname(path).toLowerCase())
    || /(^|[\/_. -])lyrics?([\/_. -]|$)/i.test(path)) return 'Lyrics or timed captions';
  if (BUSINESS.test(path)) return 'Business, rights or credit record';
  if (path.startsWith('vault/')) return 'Saved vault asset';
  if (!TRANSIENT_ROOTS.has(path.split('/')[0]!)) return 'Other saved file';
  return undefined;
}
function validateRoots(options: CampaignCleanupOptions): void {
  const campaign = realpathSync(options.campaignRootPath);
  const hq = realpathSync(options.hqRootPath);
  if (inside(campaign, hq) || inside(hq, campaign)) throw new Error('Campaign and Artist HQ must be separate folders.');
  if (!options.campaignId.trim() || !options.campaignName.trim()) throw new Error('Campaign identity is required.');
}

function buildPlan(options: CampaignCleanupOptions) {
  validateRoots(options);
  const root = options.campaignRootPath;
  const files: InventoryFile[] = [];
  function walk(folder: string): void {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      const stat = lstatSync(path);
      const generatedPath = relative(root, path).split(sep).some(part => GENERATED_DIRS.has(part));
      if (generatedPath && (stat.isDirectory() || stat.isSymbolicLink())) {
        // Dependency trees and caches are disposable. Never traverse their links or import bundled media.
        files.push({ relativePath: relative(root, path).split(sep).join('/'), sizeBytes: 0, sha256: digest(stat.isSymbolicLink() ? readlinkSync(path) : { mtime: stat.mtimeMs, ctime: stat.ctimeMs }), retained: false, reason: 'Generated dependency or cache folder' });
        continue;
      }
      assertPathWithinRealRoot(root, path);
      if (stat.isDirectory()) { walk(path); continue; }
      if (!stat.isFile()) throw new Error(`Cannot safely finish campaign with non-regular file: ${relative(root, path)}`);
      const before = lstatSync(path, { bigint: true });
      const sha256 = hashFileSha256(path);
      const after = lstatSync(path, { bigint: true });
      if (before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size) {
        throw new Error('Campaign files changed while preparing the preview. Try again when work has stopped.');
      }
      const relativePath = relative(root, path).split(sep).join('/');
      const reason = retentionReason(relativePath);
      files.push({ relativePath, sizeBytes: stat.size, sha256, reason: reason ?? 'Campaign working data', retained: !!reason });
    }
  }
  walk(root);
  const byPath = new Map(files.map(file => [file.relativePath, file]));
  const externalLinks: DeclaredRecord[] = [];
  const savedMetadata: Record<string, unknown> = {};
  function retainDeclaredFile(record: DeclaredRecord, base: string, reason: string): void {
    const raw = record.relativePath ?? record.absolutePath;
    if (typeof raw !== 'string' || !raw || raw.includes('\0')) throw new Error('A saved campaign asset has no valid file path. Repair it before finishing.');
    const path = resolve(base, raw);
    if (!inside(root, path)) {
      if (record.relativePath || !isAbsolute(raw)) throw new Error('A campaign asset path escapes the campaign folder.');
      externalLinks.push(record);
      return;
    }
    assertPathWithinRealRoot(root, path);
    const file = byPath.get(relative(root, path).split(sep).join('/'));
    if (!file) throw new Error(`A saved campaign asset is missing: ${raw}. Restore or remove its broken record before finishing.`);
    file.retained = true;
    file.reason = reason;
  }
  for (const [manifestPath, field] of [['assets/manifest.json', 'files'], ['release-kit/manifest.json', 'items'], ['vault/manifest.json', 'assets']] as const) {
    if (!byPath.has(manifestPath)) continue;
    const manifest = readJson(join(root, manifestPath));
    if (!manifest || typeof manifest.workspaceId !== 'string'
      || (field === 'items' ? ![1, 2, 3].includes(manifest.schemaVersion) || typeof manifest.campaignId !== 'string' : manifest.version !== 1)
      || !Array.isArray(manifest[field]) || manifest[field].some((record: unknown) => !record || typeof record !== 'object')) {
      throw new Error(`Repair ${manifestPath} before finishing the campaign.`);
    }
    for (const record of manifest[field]) retainDeclaredFile(record, root, 'Saved campaign asset');
    savedMetadata[manifestPath] = manifest[field];
  }
  const finals = readOutputFinalsRegistry(root, { strict: true });
  const finalIds = new Set(finals.finals.map(final => final.outputId));
  for (const finalId of finalIds) {
    if (!byPath.has(`outputs/${finalId}/output.json`)) throw new Error('A saved Final output is missing. Restore or remove its broken Final record before finishing.');
  }
  if (finals.finals.length) savedMetadata.finals = finals.finals;
  for (const file of files.filter(file => /^outputs\/[^/]+\/output\.json$/.test(file.relativePath))) {
    const output = readJson(join(root, file.relativePath));
    if (!isOutputManifest(output)) throw new Error(`Repair ${file.relativePath} before finishing the campaign.`);
    const finished = finalIds.has(output.id) || output.status === 'published' || output.approval?.state === 'approved';
    for (const asset of output.assets) {
      // Missing output attachments also block deletion: a missing file might be the only finished copy.
      const path = asset.path;
      const local = { relativePath: path };
      retainDeclaredFile(local, dirname(join(root, file.relativePath)), finished ? 'Finished output' : 'Saved output attachment');
      const resolved = relative(root, resolve(dirname(join(root, file.relativePath)), path)).split(sep).join('/');
      const inventoryFile = byPath.get(resolved)!;
      if (!finished && !retentionReason(resolved)) { inventoryFile.retained = false; inventoryFile.reason = 'Campaign working data'; }
    }
    if (finished) {
      // A finished HTML/model/project may depend on siblings absent from output.assets.
      // Preserve its directory layout so CSS, fonts, scripts and binary buffers still resolve.
      const bundlePrefix = `${dirname(file.relativePath)}/`;
      for (const dependency of files) {
        if (!dependency.relativePath.startsWith(bundlePrefix)
          || dependency.relativePath === file.relativePath
          || dependency.relativePath.split('/').some(part => GENERATED_DIRS.has(part))
          || basename(dependency.relativePath) === '.DS_Store') continue;
        dependency.retained = true;
        dependency.reason = 'Finished output bundle';
      }
      savedMetadata[file.relativePath] = { id: output.id, title: output.title, status: output.status, assets: output.assets, links: output.links, completedAt: output.completedAt };
    }
  }
  const vault = strictVault(options);
  const repairedLinks: Array<{ id: string; relativePath: string }> = [];
  for (const asset of vault.assets) {
    const path = resolveArtistVaultAssetPath(options.hqRootPath, asset);
    if (!path || !inside(root, path)) continue;
    retainDeclaredFile({ absolutePath: path }, root, 'Existing Artist Vault link');
    repairedLinks.push({ id: asset.id, relativePath: relative(root, path).split(sep).join('/') });
  }
  const warnings = externalLinks.length ? [`${externalLinks.length} externally linked file(s) stay in their original locations; their references are retained.`] : [];
  const retainedFiles = files.filter(file => file.retained).map(({ retained: _retained, ...file }) => file);
  const preview: CampaignCleanupPreview = {
    workspaceId: options.campaignId, campaignName: options.campaignName,
    previewToken: digest({ campaign: realpathSync(root), hq: realpathSync(options.hqRootPath), id: options.campaignId, name: options.campaignName, files: files.map(({ relativePath, sizeBytes, sha256 }) => ({ relativePath, sizeBytes, sha256 })) }),
    retainedFileCount: retainedFiles.length, retainedBytes: retainedFiles.reduce((sum,file) => sum + file.sizeBytes, 0),
    retainedMemoryCount: options.retainedMemoryCount ?? 0, retainedFiles,
    deletedFileCount: files.length - retainedFiles.length, warnings,
  };
  return { preview, vault, repairedLinks, externalLinks, savedMetadata };
}

export function previewCampaignCleanup(options: CampaignCleanupOptions): CampaignCleanupPreview {
  return buildPlan(options).preview;
}

function durableJson(root: string, path: string, value: unknown): void {
  assertPathWithinRealRoot(root, path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = assertPathWithinRealRoot(root, `${path}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  assertPathWithinRealRoot(root, path);
  renameSync(temporary, path);
  const directoryFd = openSync(dirname(path), 'r');
  try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
}

/** Durable preservation only. The lifecycle owner must quiesce writers and delete the campaign afterward. */
export async function preserveCampaignForDeletion(options: CampaignCleanupOptions, expectedToken: string): Promise<CampaignCleanupResult> {
  return withArtistVaultMutex(options.hqRootPath, async () => {
    const plan = buildPlan(options);
    if (!expectedToken || plan.preview.previewToken !== expectedToken) throw new Error('Campaign changed since the preview. Review the updated files before finishing.');
    const safeId = `${options.campaignId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48)}-${digest(options.campaignId).slice(0, 12)}`;
    // Content-addressed batches permit safe retries without overwriting a previous preservation attempt.
    const archiveRelative = `vault/past-releases/${safeId}/${expectedToken.slice(0, 16)}`;
    const now = new Date().toISOString();
    const additions: VaultAssetRecord[] = [];
    for (const file of plan.preview.retainedFiles) {
      const relativePath = `${archiveRelative}/files/${file.relativePath}`;
      const destination = assertPathWithinRealRoot(options.hqRootPath, join(options.hqRootPath, relativePath));
      if (existsSync(destination)) {
        if (!lstatSync(destination).isFile() || hashFileSha256(destination) !== file.sha256) throw new Error('An existing preserved file differs. The campaign has not been deleted.');
      } else {
        verifiedCopyFileSync(join(options.campaignRootPath, file.relativePath), destination, { sourceRootPath: options.campaignRootPath, destinationRootPath: options.hqRootPath });
        if (hashFileSha256(destination) !== file.sha256) throw new Error('Preserved file verification failed. The campaign has not been deleted.');
      }
      const classification = classifyVaultAsset(file.relativePath);
      additions.push({
        id: `past-release-${digest({ campaign: options.campaignId, path: file.relativePath, hash: file.sha256 }).slice(0, 32)}`,
        category: classification.category, kind: classification.kind, label: basename(file.relativePath),
        relativePath, sizeBytes: file.sizeBytes, sha256: file.sha256, mimeType: inferVaultMimeType(file.relativePath),
        source: 'copy', status: 'archived', rightsStatus: 'unknown', usableByAgents: false,
        campaigns: [options.campaignId], tags: ['past-release', `release:${options.campaignName}`],
        notes: `Preserved from ${options.campaignName}: ${file.relativePath}`, createdAt: now, updatedAt: now,
      });
    }
    if (buildPlan(options).preview.previewToken !== expectedToken) throw new Error('Campaign changed during preservation. Review a fresh preview; the campaign has not been deleted.');
    const recordRelative = `${archiveRelative}/release-record.json`;
    durableJson(options.hqRootPath, join(options.hqRootPath, recordRelative), {
      schemaVersion: 1, campaignId: options.campaignId, campaignName: options.campaignName,
      preservedAt: now, files: plan.preview.retainedFiles, savedAssetMetadata: plan.savedMetadata,
      externalLinks: plan.externalLinks, savedMemories: 'Existing global saved memories were left unchanged.',
    });
    const repaired = new Map(plan.repairedLinks.map(link => [link.id, `${archiveRelative}/files/${link.relativePath}`]));
    const existing = plan.vault.assets.map(asset => {
      const relativePath = repaired.get(asset.id);
      if (!relativePath) return asset;
      const { absolutePath: _absolutePath, ...rest } = asset;
      return { ...rest, relativePath, source: 'copy' as const, campaigns: [...new Set([...(asset.campaigns ?? []), options.campaignId])], tags: [...new Set([...(asset.tags ?? []), 'past-release', `release:${options.campaignName}`])], updatedAt: now };
    });
    const recordAsset: VaultAssetRecord = {
      id: `past-release-record-${digest(options.campaignId).slice(0,32)}`, category: 'campaigns', kind: 'release-asset',
      label: `${options.campaignName} — release record`, relativePath: recordRelative, source: 'copy', status: 'archived',
      rightsStatus: 'private', usableByAgents: false, campaigns: [options.campaignId], tags: ['past-release', `release:${options.campaignName}`], createdAt: now, updatedAt: now,
    };
    const byId = new Map(existing.map(asset => [asset.id, asset]));
    const existingPaths = new Set(existing.map(asset => asset.relativePath).filter(Boolean));
    for (const asset of [...additions, recordAsset]) {
      const prior = byId.get(asset.id);
      // A repaired HQ link already represents this preserved file. Reuse its
      // label and permissions instead of creating a second card for the same path.
      if (!prior && existingPaths.has(asset.relativePath)) continue;
      byId.set(asset.id, prior ? { ...asset, createdAt: prior.createdAt } : asset);
    }
    durableJson(options.hqRootPath, getArtistVaultManifestPath(options.hqRootPath), { ...plan.vault, assets: [...byId.values()], updatedAt: now });
    return { workspaceId: options.campaignId, hqWorkspaceId: options.hqWorkspaceId, retainedFileCount: plan.preview.retainedFileCount, retainedMemoryCount: plan.preview.retainedMemoryCount, pastReleaseLabel: options.campaignName };
  });
}
