export const RELEASE_KIT_DIR = 'release-kit';
export const RELEASE_KIT_MANIFEST_FILE = 'manifest.json';
export const RELEASE_KIT_CONTEXT_SLUG = 'release-kit';

export type ReleaseKitCategory =
  | 'audio'
  | 'artwork'
  | 'video'
  | 'images'
  | 'copy'
  | 'plans'
  | 'merch'
  | 'documents'
  | 'references';

export type ReleaseKitItemStatus = 'ready' | 'needs-review' | 'missing';

export type ReleaseKitSource =
  | { type: 'upload'; originalFileName: string }
  | { type: 'campaign-asset'; assetId: string }
  | { type: 'vault-asset'; assetId: string; vaultWorkspaceId: string }
  | { type: 'output'; outputId: string; assetId?: string }
  | { type: 'legacy-final'; outputId: string; assetId?: string; legacyFinalId?: string };

export interface ReleaseKitItem {
  id: string;
  campaignId: string;
  category: ReleaseKitCategory;
  subtype: string;
  title: string;
  source: ReleaseKitSource;
  relativePath: string;
  mimeType?: string;
  sizeBytes?: number;
  snapshotMtimeMs?: number;
  sha256: string;
  status: ReleaseKitItemStatus;
  isPrimary: boolean;
  promotedAt: string;
  promotedBy: 'user' | 'agent' | 'migration';
  note?: string;
}

export interface ReleaseKitManifest {
  schemaVersion: 1;
  workspaceId: string;
  campaignId: string;
  updatedAt: string;
  items: ReleaseKitItem[];
}

export interface MaterializeReleaseKitItemInput {
  workspaceId: string;
  campaignId: string;
  source: ReleaseKitSource;
  sourcePath: string;
  category: ReleaseKitCategory;
  subtype: string;
  title?: string;
  mimeType?: string;
  makePrimary?: boolean;
  promotedBy: ReleaseKitItem['promotedBy'];
  note?: string;
}

export interface PromoteToReleaseKitInput {
  source: ReleaseKitSource;
  /** User-selected local path. Allowed only when source.type is upload. */
  uploadPath?: string;
  category: ReleaseKitCategory;
  subtype: string;
  title?: string;
  mimeType?: string;
  makePrimary?: boolean;
  note?: string;
}

export interface ReleaseKitItemDetail {
  item: ReleaseKitItem;
  absolutePath: string;
}

export interface ReleaseKitMigrationResult {
  manifest: ReleaseKitManifest;
  migrated: number;
  skipped: Array<{ finalId: string; reason: string }>;
}

export interface RemoveReleaseKitItemResult {
  manifest: ReleaseKitManifest;
  removed: ReleaseKitItem;
}

export interface ReleaseKitVerificationResult {
  manifest: ReleaseKitManifest;
  checked: number;
  changed: ReleaseKitItem[];
}
