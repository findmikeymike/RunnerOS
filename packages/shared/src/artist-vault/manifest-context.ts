import type { ContextDocMetadata } from '../workspace-context/types.ts';
import { isSafeVaultRelativePath } from './storage.ts';
import { ARTIST_VAULT_CONTEXT_SLUG } from './types.ts';
import type { VaultAssetKind, VaultAssetRecord, VaultManifest } from './types.ts';
import { vaultAssetForAgentList } from './track-intelligence.ts';

export function artistVaultContextMetadata(): ContextDocMetadata {
  return {
    name: 'Artist Vault',
    description: 'Global artist asset library with usable files, private files, and song matching metadata.',
    routing: { mode: 'broadcast' },
    delivery: 'on-demand',
    enabled: true,
    status: 'active',
    priority: 'normal',
  };
}

export function serializeArtistVaultContext(manifest: VaultManifest): string {
  const safeManifest = {
    ...manifest,
    assets: manifest.assets.filter(isAgentUsableAsset).map(vaultAssetForAgentList),
  };
  return [
    'This context lists artist Vault assets. Do not assume files were analyzed. Use tools to inspect specific files only when needed.',
    '',
    'Only agent-approved Vault files are exposed here. Private, missing, archived, and non-agent-usable asset paths are redacted from this context.',
    '',
    '```json',
    JSON.stringify(safeManifest, null, 2),
    '```',
    '',
    '## Key Ready Assets',
    '',
    ...keyReadyAssetLines(manifest.assets),
    '',
    '## Vault Buckets',
    '',
    ...bucketLines(manifest.assets),
    '',
    '## Private Assets',
    '',
    `- Private or non-agent-usable assets: ${privateAssetCount(manifest.assets)}`,
  ].join('\n');
}

export function artistVaultContextSlug(): string {
  return ARTIST_VAULT_CONTEXT_SLUG;
}

function keyReadyAssetLines(assets: VaultAssetRecord[]): string[] {
  const master = firstPath(assets, 'master-final');
  const cover = firstPath(assets, 'cover-art');
  const pressPhoto = firstPath(assets, 'artist-photo');
  const faceReference = firstPath(assets, 'face-reference');
  const epk = firstPath(assets, 'epk');
  const oneSheet = firstPath(assets, 'one-sheet');
  return [
    `- Final master: ${master ?? 'missing'}`,
    `- Cover art: ${cover ?? 'missing'}`,
    `- Press photo: ${pressPhoto ?? 'missing'}`,
    `- Face reference: ${faceReference ?? 'missing'}`,
    `- EPK: ${epk ?? 'missing'}`,
    `- One-sheet: ${oneSheet ?? 'missing'}`,
  ];
}

function bucketLines(assets: VaultAssetRecord[]): string[] {
  const usable = assets.filter(isAgentUsableAsset);
  return [
    `- Music: ${countCategories(usable, ['music'])}`,
    `- Video: ${countCategories(usable, ['video'])}`,
    `- Visuals: ${countCategories(usable, ['visuals'])}`,
    `- Campaign assets: ${countCategories(usable, ['campaigns'])}`,
    `- Business assets available to agents: ${countCategories(usable, ['business'])}`,
    `- References: ${countCategories(usable, ['references'])}`,
  ];
}

function firstPath(assets: VaultAssetRecord[], kind: VaultAssetKind): string | null {
  const record = assets.find((asset) => asset.kind === kind && isAgentUsableAsset(asset));
  return record?.relativePath ?? record?.absolutePath ?? null;
}

function countCategories(assets: VaultAssetRecord[], categories: VaultAssetRecord['category'][]): number {
  return assets.filter((asset) => categories.includes(asset.category)).length;
}

function privateAssetCount(assets: VaultAssetRecord[]): number {
  return assets.filter((asset) => !isAgentUsableAsset(asset)).length;
}

function isAgentUsableAsset(asset: VaultAssetRecord): boolean {
  if (!asset.usableByAgents) return false;
  if (asset.rightsStatus === 'private' || asset.rightsStatus === 'needs-clearance') return false;
  if (asset.status === 'draft' || asset.status === 'archived' || asset.status === 'missing') return false;
  if (asset.relativePath && !isSafeVaultRelativePath(asset.relativePath)) return false;
  return Boolean(asset.relativePath || asset.absolutePath);
}
