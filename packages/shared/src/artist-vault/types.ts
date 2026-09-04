export const ARTIST_VAULT_DIR = 'vault';
export const ARTIST_VAULT_MANIFEST_FILE = 'manifest.json';
export const ARTIST_VAULT_CONTEXT_SLUG = 'artist-vault';

export type VaultCategory =
  | 'music'
  | 'video'
  | 'visuals'
  | 'campaigns'
  | 'business'
  | 'references';

export type VaultAssetKind =
  | 'master-final'
  | 'demo'
  | 'stem'
  | 'beat-instrumental'
  | 'mix-reference'
  | 'lyrics-note'
  | 'final-video'
  | 'raw-footage'
  | 'content-clip'
  | 'b-roll'
  | 'live-performance'
  | 'video-project'
  | 'cover-art'
  | 'artist-photo'
  | 'face-reference'
  | 'logo-mark'
  | 'brand-asset'
  | 'poster-flyer'
  | 'merch-design'
  | 'release-asset'
  | 'ad-asset'
  | 'press-asset'
  | 'social-pack'
  | 'contract'
  | 'split-sheet'
  | 'rights-record'
  | 'invoice'
  | 'one-sheet'
  | 'epk'
  | 'moodboard'
  | 'inspiration'
  | 'similar-artist-reference'
  | 'swipe-file'
  | 'other';

export type VaultAssetStatus = 'draft' | 'review' | 'approved' | 'final' | 'archived' | 'missing';
export type VaultRightsStatus = 'safe-to-use' | 'needs-clearance' | 'private' | 'unknown';
export type VaultAssetSource = 'copy' | 'linked-file' | 'linked-folder' | 'agent-output' | 'manual';
export type VaultStorageMode = 'copied' | 'linked' | 'mixed';
export type VaultCampaignAssetRole =
  | 'primary-audio'
  | 'cover-art'
  | 'press-photo'
  | 'video'
  | 'ad-asset'
  | 'social-asset'
  | 'reference'
  | 'other';

export type VaultKindHint =
  | 'master-final'
  | 'demo'
  | 'raw-footage'
  | 'cover-art'
  | 'artist-photo'
  | 'face-reference'
  | 'contract'
  | 'ad-asset'
  | 'any';

export type TrackIntelligenceStatus = 'pending' | 'draft' | 'reviewed' | 'failed' | 'skipped';

export interface TrackLyricWord {
  text: string;
  startMs: number;
  endMs: number;
}

export type TrackLyricSection = 'verse' | 'pre-chorus' | 'chorus' | 'hook' | 'bridge' | 'outro';

export interface TrackLyricLine {
  id: string;
  text: string;
  startMs?: number;
  endMs?: number;
  words?: TrackLyricWord[];
  corrected?: boolean;
  section?: TrackLyricSection;
}

export interface TrackCharacterMetadata {
  genre?: string[];
  subgenre?: string[];
  energy?: number;
  tempoBpm?: number;
  tempoSource?: 'detected' | 'manual';
  moods?: string[];
  themes?: string[];
  notes?: string;
}

export interface TrackIntelligenceRevision {
  id: string;
  lyrics?: {
    lines: TrackLyricLine[];
    language?: string;
    timingSource: 'alignment' | 'transcription' | 'manual';
    timingStatus: 'ready' | 'needs-alignment';
    confidence?: number;
    artistSuppliedText?: boolean;
  };
  character?: TrackCharacterMetadata;
  technical?: {
    durationMs?: number;
    sampleRate?: number;
    channels?: number;
  };
  provenance: {
    engine?: string;
    engineVersion?: string;
    processedLocally?: boolean;
    analyzedAt?: string;
    transcriptRelativePath?: string;
    sourceSha256?: string;
  };
}

export interface ReviewedTrackIntelligenceRevision extends TrackIntelligenceRevision {
  reviewedAt: string;
  reviewedBy: { type: 'user'; clientId: string };
}

export interface TrackIntelligence {
  status: TrackIntelligenceStatus;
  schemaVersion: 1;
  draft?: TrackIntelligenceRevision;
  approved?: ReviewedTrackIntelligenceRevision;
  failureReason?: string;
}

/** User-editable fields only. The host supplies approval state and reviewer identity. */
export interface TrackIntelligenceReviewInput {
  assetId: string;
  draftId: string;
  lyrics: {
    lines: TrackLyricLine[];
    language?: string;
    timingSource: 'alignment' | 'transcription' | 'manual';
    timingStatus: 'ready' | 'needs-alignment';
    artistSuppliedText?: boolean;
  };
  character?: TrackCharacterMetadata;
}

export interface VaultTrackTranscribeOptions {
  assetId: string;
  model?: string;
  force?: boolean;
}

export interface VaultTrackTranscribeResult {
  ok: boolean;
  manifest: VaultManifest;
  asset?: VaultAssetRecord;
  error?: string;
  blockers?: Array<{ code: string; message: string }>;
}

export interface VaultAssetRecord {
  id: string;
  category: VaultCategory;
  kind: VaultAssetKind;
  label: string;
  relativePath?: string;
  absolutePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  source: VaultAssetSource;
  status: VaultAssetStatus;
  rightsStatus: VaultRightsStatus;
  usableByAgents: boolean;
  campaigns?: string[];
  tags?: string[];
  genre?: string[];
  moods?: string[];
  bpm?: number;
  similarSongs?: string[];
  trackIntelligence?: TrackIntelligence;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultManifest {
  version: 1;
  workspaceId: string;
  vaultRoot: string;
  storageMode: VaultStorageMode;
  assets: VaultAssetRecord[];
  updatedAt: string;
}

export interface VaultCampaignAssetReference {
  campaignId: string;
  vaultAssetId: string;
  role: VaultCampaignAssetRole;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultAssetClassification {
  category: VaultCategory;
  kind: VaultAssetKind;
  directory: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface VaultAssetImportCandidate {
  sourcePath: string;
  fileName: string;
  category: VaultCategory;
  kind: VaultAssetKind;
  destinationRelativePath: string;
  confidence: VaultAssetClassification['confidence'];
  reason: string;
  sizeBytes?: number;
  mimeType?: string;
  defaultStatus: VaultAssetStatus;
  defaultRightsStatus: VaultRightsStatus;
  defaultUsableByAgents: boolean;
}

export interface VaultAssetImportOptions {
  kindHint?: VaultKindHint;
}

export interface VaultAssetUpdatePatch {
  kind?: VaultAssetKind;
  label?: string;
  status?: VaultAssetStatus;
  rightsStatus?: VaultRightsStatus;
  usableByAgents?: boolean;
  campaigns?: string[];
  tags?: string[];
  genre?: string[];
  moods?: string[];
  bpm?: number | null;
  similarSongs?: string[];
  notes?: string;
}

export interface VaultAssetImportResult {
  manifest: VaultManifest;
  imported: VaultAssetRecord[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface VaultAssetScanResult {
  manifest: VaultManifest;
  added: VaultAssetRecord[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface VaultFolderLinkResult {
  manifest: VaultManifest;
  linked: VaultAssetRecord[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface VaultSaveToVaultEntryPoint {
  source: 'output' | 'canvas' | 'local-file';
  sourcePath: string;
  outputId?: string;
  title?: string;
  kindHint?: VaultKindHint;
}
