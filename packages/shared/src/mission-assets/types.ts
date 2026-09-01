export const MISSION_ASSETS_DIR = 'assets';
export const MISSION_ASSET_MANIFEST_FILE = 'manifest.json';
export const MISSION_ASSET_CONTEXT_SLUG = 'mission-assets';

export type MissionAssetKind =
  | 'master'
  | 'demo'
  | 'stem'
  | 'audio-reference'
  | 'raw-video'
  | 'edited-video'
  | 'final-video'
  | 'cover-art'
  | 'press-photo'
  | 'moodboard-image'
  | 'lyrics'
  | 'press-doc'
  | 'note'
  | 'export'
  | 'other';

export type MissionAssetStatus = 'available' | 'missing' | 'moved' | 'needs-review';
export type MissionAssetSource = 'copy' | 'linked-folder' | 'agent-output' | 'manual';
export type MissionAssetStorageMode = 'copied' | 'linked' | 'mixed';

export type MissionAssetKindHint = 'master' | 'lyrics' | 'cover-art' | 'any';

export interface MissionLyricsLine {
  text: string;
  start_time: number;
  end_time: number;
}

export interface MissionAssetLyricsMetadata {
  text: string;
  lyricLines?: MissionLyricsLine[];
  reviewRequired: boolean;
  status: 'machine' | 'approved' | 'manual';
  sourceAudioAssetId?: string;
  sourceAudioPath?: string;
  transcriptRelativePath?: string;
  model?: string;
  engine?: string;
  generatedAt?: string;
  sourceSha256?: string;
  reviewedAt?: string;
}

export interface MissionAssetRecord {
  id: string;
  kind: MissionAssetKind;
  label: string;
  relativePath?: string;
  absolutePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  source: MissionAssetSource;
  status: MissionAssetStatus;
  usableByAgents: boolean;
  notes?: string;
  lyrics?: MissionAssetLyricsMetadata;
  trackIntelligence?: TrackIntelligence;
  createdAt: string;
  updatedAt: string;
}

export interface MissionAssetManifest {
  version: 1;
  workspaceId: string;
  assetsRoot: string;
  storageMode: MissionAssetStorageMode;
  files: MissionAssetRecord[];
  updatedAt: string;
}

export interface MissionAssetClassification {
  kind: MissionAssetKind;
  directory: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface MissionAssetImportCandidate {
  sourcePath: string;
  fileName: string;
  kind: MissionAssetKind;
  destinationRelativePath: string;
  confidence: MissionAssetClassification['confidence'];
  reason: string;
  sizeBytes?: number;
  mimeType?: string;
}

export interface MissionAssetImportOptions {
  kindHint?: MissionAssetKindHint;
}

export interface MissionAssetImportResult {
  manifest: MissionAssetManifest;
  imported: MissionAssetRecord[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface MissionAssetScanResult {
  manifest: MissionAssetManifest;
  added: MissionAssetRecord[];
  skipped: Array<{ path: string; reason: string }>;
}

export interface MissionAssetSaveLyricsInput {
  lyricsText: string;
  lyricLines?: MissionLyricsLine[];
  draftId?: string;
  assetId?: string;
  sourceAudioAssetId?: string;
  transcriptRelativePath?: string;
  model?: string;
  engine?: string;
  generatedAt?: string;
  sourceSha256?: string;
  reviewRequired?: boolean;
  status?: MissionAssetLyricsMetadata['status'];
  language?: string;
  timingSource?: 'alignment' | 'transcription' | 'manual';
  artistSuppliedText?: boolean;
  character?: TrackCharacterMetadata;
}

export interface MissionAssetSaveLyricsResult {
  manifest: MissionAssetManifest;
  lyricsAsset: MissionAssetRecord;
}

export interface MissionAssetTranscribeLyricsOptions {
  audioAssetId?: string;
  model?: string;
  force?: boolean;
}

export interface MissionAssetTranscribeLyricsResult {
  ok: boolean;
  manifest: MissionAssetManifest;
  lyricsAsset?: MissionAssetRecord;
  audioAsset?: MissionAssetRecord;
  error?: string;
  blockers?: Array<{ code: string; message: string }>;
}
import type { TrackCharacterMetadata, TrackIntelligence } from '../artist-vault/types.ts';
