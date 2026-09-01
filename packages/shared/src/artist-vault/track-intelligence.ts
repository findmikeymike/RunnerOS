import type {
  TrackCharacterMetadata,
  TrackIntelligence,
  ReviewedTrackIntelligenceRevision,
  TrackLyricLine,
  VaultAssetRecord,
} from './types.ts';

export interface AgentTrackIntelligenceSummary {
  status: 'reviewed';
  schemaVersion: 1;
  hasLyrics: boolean;
  lyricLineCount: number;
  character?: TrackCharacterMetadata;
  technical?: ReviewedTrackIntelligenceRevision['technical'];
}

export type AgentVisibleVaultAsset = Omit<VaultAssetRecord, 'trackIntelligence'> & {
  trackIntelligence?: AgentTrackIntelligenceSummary | TrackIntelligence;
};

export function isReviewedTrackIntelligence(
  intelligence: TrackIntelligence | undefined,
): intelligence is TrackIntelligence & { approved: ReviewedTrackIntelligenceRevision } {
  return Boolean(intelligence?.approved);
}

export function compactTrackIntelligenceForAgents(
  intelligence: TrackIntelligence | undefined,
): AgentTrackIntelligenceSummary | undefined {
  if (!isReviewedTrackIntelligence(intelligence)) return undefined;
  return {
    status: 'reviewed',
    schemaVersion: 1,
    hasLyrics: Boolean(intelligence.approved.lyrics?.lines.length),
    lyricLineCount: intelligence.approved.lyrics?.lines.length ?? 0,
    character: intelligence.approved.character,
    technical: intelligence.approved.technical,
  };
}

export function vaultAssetForAgentList(asset: VaultAssetRecord): AgentVisibleVaultAsset {
  const { trackIntelligence: _draftOrReviewed, ...base } = asset;
  const trackIntelligence = compactTrackIntelligenceForAgents(asset.trackIntelligence);
  return trackIntelligence ? { ...base, trackIntelligence } : base;
}

export function vaultAssetForAgentDetail(asset: VaultAssetRecord): AgentVisibleVaultAsset {
  const { trackIntelligence: _draftOrReviewed, ...base } = asset;
  return isReviewedTrackIntelligence(asset.trackIntelligence)
    ? { ...base, trackIntelligence: {
      status: 'reviewed',
      schemaVersion: 1,
      approved: asset.trackIntelligence.approved,
    } }
    : base;
}

export function escapeUntrustedPromptData(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /[<>&]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export function lyricsTextFromLines(lines: TrackLyricLine[]): string {
  return lines.map((line) => line.text.trim()).filter(Boolean).join('\n');
}

export function cleanTrackStringList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return cleaned.length ? cleaned : undefined;
}

export function normalizeTrackCharacter(
  character: TrackCharacterMetadata | undefined,
): TrackCharacterMetadata | undefined {
  if (!character) return undefined;
  const energy = typeof character.energy === 'number' && Number.isFinite(character.energy)
    ? Math.max(1, Math.min(10, Math.round(character.energy)))
    : undefined;
  const tempoBpm = typeof character.tempoBpm === 'number' && Number.isFinite(character.tempoBpm) && character.tempoBpm > 0
    ? Math.round(character.tempoBpm)
    : undefined;
  const normalized: TrackCharacterMetadata = {
    genre: cleanTrackStringList(character.genre),
    subgenre: cleanTrackStringList(character.subgenre),
    energy,
    tempoBpm,
    tempoSource: tempoBpm ? character.tempoSource ?? 'manual' : undefined,
    moods: cleanTrackStringList(character.moods),
    themes: cleanTrackStringList(character.themes),
    notes: character.notes?.trim() || undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}
