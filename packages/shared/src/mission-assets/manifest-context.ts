import type { ContextDocMetadata } from '../workspace-context/types.ts';
import type { MissionAssetManifest, MissionAssetRecord } from './types.ts';
import { MISSION_ASSET_CONTEXT_SLUG } from './types.ts';

export function missionAssetContextMetadata(): ContextDocMetadata {
  return {
    name: 'Campaign Assets',
    description: 'Working and source files attached to this campaign.',
    routing: { mode: 'broadcast' },
    delivery: 'on-demand',
    enabled: true,
    status: 'active',
    priority: 'normal',
  };
}

export function serializeMissionAssetContext(manifest: MissionAssetManifest): string {
  return [
    'This context lists Campaign Assets: working and source files for the current release. They are not approved finals unless promoted into the Release Kit. Do not assume every file has been analyzed. Use tools to inspect files when needed.',
    '',
    '```json',
    JSON.stringify(manifest, null, 2),
    '```',
    '',
    '## Key Assets',
    '',
    ...keyAssetLines(manifest.files),
    '',
    '## Asset Buckets',
    '',
    ...bucketLines(manifest.files),
  ].join('\n');
}

export function missionAssetContextSlug(): string {
  return MISSION_ASSET_CONTEXT_SLUG;
}

function keyAssetLines(files: MissionAssetRecord[]): string[] {
  const master = firstPath(files, 'master');
  const lyrics = firstPath(files, 'lyrics');
  const cover = firstPath(files, 'cover-art');
  return [
    `- Master: ${master ?? 'missing'}`,
    `- Cover art: ${cover ?? 'missing'}`,
    `- Lyrics: ${lyrics ?? 'missing'}`,
    ...lyricsStatusLines(files),
  ];
}

function lyricsStatusLines(files: MissionAssetRecord[]): string[] {
  const record = firstLyricsRecord(files);
  if (!record?.lyrics) return ['- Lyrics status: missing'];
  const status = record.lyrics.reviewRequired ? 'needs review' : 'approved';
  const lines = [
    `- Lyrics status: ${status}`,
    `- Lyrics source audio: ${record.lyrics.sourceAudioPath ?? 'unknown'}`,
  ];
  if (record.lyrics.text) {
    lines.push('', '## Saved Lyrics', '', record.lyrics.text);
  }
  if (record.lyrics.lyricLines?.length) {
    lines.push('', '## Timed Lyric Lines', '', '```json', JSON.stringify(record.lyrics.lyricLines, null, 2), '```');
  }
  return lines;
}

function firstLyricsRecord(files: MissionAssetRecord[]): MissionAssetRecord | null {
  return files.find((file) => file.kind === 'lyrics' && file.status === 'available' && file.lyrics && !file.lyrics.reviewRequired)
    ?? files.find((file) => file.kind === 'lyrics' && file.status === 'available' && file.lyrics)
    ?? null;
}

function bucketLines(files: MissionAssetRecord[]): string[] {
  const available = files.filter((file) => file.status === 'available');
  return [
    `- Audio files: ${countKinds(available, ['master', 'demo', 'stem', 'audio-reference'])}`,
    `- Raw video: ${countKinds(available, ['raw-video'])}`,
    `- Finished video: ${countKinds(available, ['edited-video', 'final-video'])}`,
    `- Photos: ${countKinds(available, ['press-photo'])}`,
    `- Visual references: ${countKinds(available, ['moodboard-image'])}`,
    `- Documents: ${countKinds(available, ['lyrics', 'press-doc', 'note'])}`,
  ];
}

function countKinds(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): number {
  return files.filter((file) => kinds.includes(file.kind)).length;
}

function firstPath(files: MissionAssetRecord[], kind: MissionAssetRecord['kind']): string | null {
  const record = files.find((file) => file.kind === kind && file.status === 'available');
  return record?.relativePath ?? record?.absolutePath ?? null;
}
