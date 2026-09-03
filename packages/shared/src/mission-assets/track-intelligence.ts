import type {
  TrackIntelligenceRevision,
} from '../artist-vault/types.ts';
import { lyricsTextFromLines } from '../artist-vault/track-intelligence.ts';
import type {
  MissionAssetLyricsMetadata,
  MissionAssetManifest,
  MissionAssetRecord,
} from './types.ts';

export function currentMissionTrackRevision(
  sourceAudio: Pick<MissionAssetRecord, 'trackIntelligence'>,
): TrackIntelligenceRevision | undefined {
  return sourceAudio.trackIntelligence?.draft ?? sourceAudio.trackIntelligence?.approved;
}

export function approvedMissionTrackRevision(
  sourceAudio: Pick<MissionAssetRecord, 'trackIntelligence'>,
): TrackIntelligenceRevision | undefined {
  return sourceAudio.trackIntelligence?.approved;
}

export function missionLyricsProjectionFromTrackIntelligence(
  sourceAudio: Pick<MissionAssetRecord, 'id' | 'relativePath' | 'absolutePath' | 'trackIntelligence'>,
  existing: MissionAssetLyricsMetadata | undefined,
): MissionAssetLyricsMetadata | undefined {
  const revision = currentMissionTrackRevision(sourceAudio);
  if (!revision?.lyrics) return undefined;
  const reviewRequired = Boolean(sourceAudio.trackIntelligence?.draft);
  return {
    text: lyricsTextFromLines(revision.lyrics.lines),
    lyricLines: revision.lyrics.lines.map((line) => ({
      text: line.text,
      start_time: (line.startMs ?? 0) / 1000,
      end_time: (line.endMs ?? line.startMs ?? 0) / 1000,
      section: line.section,
    })),
    reviewRequired,
    status: reviewRequired ? 'machine' : 'approved',
    sourceAudioAssetId: sourceAudio.id,
    sourceAudioPath: sourceAudio.relativePath ?? sourceAudio.absolutePath,
    transcriptRelativePath: revision.provenance.transcriptRelativePath,
    model: existing?.model,
    engine: revision.provenance.engine,
    generatedAt: revision.provenance.analyzedAt,
    sourceSha256: revision.provenance.sourceSha256,
    reviewedAt: sourceAudio.trackIntelligence?.approved?.reviewedAt,
  };
}

/**
 * Keep the legacy lyrics record as a compatibility projection only. The audio
 * asset's Track Intelligence revision is the canonical campaign record.
 */
export function reconcileMissionLyricsProjections(manifest: MissionAssetManifest): MissionAssetManifest {
  const audioById = new Map(
    manifest.files
      .filter((file) => file.kind === 'master' || file.kind === 'demo')
      .map((file) => [file.id, file]),
  );
  return {
    ...manifest,
    files: manifest.files.map((file) => {
      if (file.kind !== 'lyrics' || !file.lyrics?.sourceAudioAssetId) return file;
      const sourceAudio = audioById.get(file.lyrics.sourceAudioAssetId);
      if (!sourceAudio?.trackIntelligence) return file;
      const lyrics = missionLyricsProjectionFromTrackIntelligence(sourceAudio, file.lyrics);
      if (!lyrics) return file;
      return {
        ...file,
        lyrics,
        usableByAgents: !lyrics.reviewRequired,
        notes: lyrics.reviewRequired
          ? 'Machine transcript needs lyric review'
          : 'Approved lyrics for campaign agents',
      };
    }),
  };
}

export function missionAudioForLyricsRecord(
  manifest: MissionAssetManifest,
  lyricsRecord: Pick<MissionAssetRecord, 'lyrics'>,
): MissionAssetRecord | undefined {
  const sourceAudioId = lyricsRecord.lyrics?.sourceAudioAssetId;
  return sourceAudioId
    ? manifest.files.find((file) => file.id === sourceAudioId && (file.kind === 'master' || file.kind === 'demo'))
    : undefined;
}
