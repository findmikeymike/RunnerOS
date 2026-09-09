export interface CampaignCleanupVaultWorkspace {
  workspaceId: string;
  workspaceName: string;
  rootPath: string;
  writable: boolean;
}

export interface CampaignCleanupOptions {
  campaignRootPath: string;
  hqRootPath: string;
  campaignId: string;
  campaignName: string;
  hqWorkspaceId: string;
  linkedVaultWorkspaces?: CampaignCleanupVaultWorkspace[];
  retainedMemoryCount?: number;
}

export interface CampaignRetainedFile {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  reason: string;
}

export interface CampaignCleanupPreview {
  workspaceId: string;
  campaignName: string;
  previewToken: string;
  retainedFileCount: number;
  retainedBytes: number;
  retainedMemoryCount: number;
  retainedFiles: CampaignRetainedFile[];
  deletedFileCount: number;
  warnings: string[];
}

export interface CampaignCleanupResult {
  workspaceId: string;
  hqWorkspaceId: string;
  retainedFileCount: number;
  retainedMemoryCount: number;
  pastReleaseLabel: string;
  warnings?: string[];
  /** Internal confirmation state after Vault links are repaired during preservation. */
  postPreservationToken?: string;
}
