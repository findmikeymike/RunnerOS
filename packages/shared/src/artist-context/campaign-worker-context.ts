import type { MissionAssetManifest, MissionAssetRecord } from '../mission-assets/types.ts'
import type { ContextDocMetadata } from '../workspace-context/types.ts'
import type { ArtistProfile } from './profile.ts'
import type { ArtistVoice } from './voice.ts'
import type { MissionBrief } from './mission-brief.ts'

export const CAMPAIGN_WORKER_CONTEXT_SLUG = 'campaign-worker-context'

export interface CampaignWorkerReadiness {
  ready: boolean
  nextMove: string
  missing: string[]
  essentials: {
    campaignBrief: boolean
    artistProfile: boolean
    master: boolean
    lyrics: boolean
    coverArt: boolean
  }
}

export interface CampaignWorkerContextInput {
  mission: MissionBrief
  artistProfile?: ArtistProfile | null
  artistVoice?: ArtistVoice | null
  assetManifest?: MissionAssetManifest | null
}

export function campaignWorkerContextMetadata(readiness: CampaignWorkerReadiness): ContextDocMetadata {
  return {
    name: 'Campaign Worker Context',
    description: 'Worker-ready digest of campaign brief, artist profile, and mission assets.',
    routing: { mode: 'broadcast' },
    enabled: true,
    status: readiness.ready ? 'active' : undefined,
    priority: readiness.ready ? 'high' : 'normal',
  }
}

export function getCampaignWorkerReadiness(input: CampaignWorkerContextInput): CampaignWorkerReadiness {
  const files = availableFiles(input.assetManifest)
  const lyrics = firstLyrics(files)
  const lyricsNeedsReview = Boolean(lyrics?.lyrics?.reviewRequired)
  const essentials = {
    campaignBrief: input.mission.status !== 'empty' && Boolean(input.mission.title || input.mission.goal),
    artistProfile: Boolean(input.artistProfile?.artistName || input.artistProfile?.bio || input.artistProfile?.sound),
    master: hasKind(files, ['master', 'demo']),
    lyrics: Boolean(lyrics?.lyrics && !lyrics.lyrics.reviewRequired),
    coverArt: hasKind(files, ['cover-art']),
  }
  const missing = [
    essentials.campaignBrief ? null : 'Campaign brief',
    essentials.artistProfile ? null : 'Artist profile',
    essentials.master ? null : 'Master or demo',
    essentials.coverArt ? null : 'Cover art',
    input.mission.targetListener || input.artistProfile?.audience ? null : 'Target listener',
    lyricsNeedsReview ? 'Approved lyrics' : null,
  ].filter((value): value is string => Boolean(value))

  return {
    ready: missing.length === 0,
    nextMove: nextMove(essentials, input),
    missing,
    essentials,
  }
}

export function serializeCampaignWorkerContext(input: CampaignWorkerContextInput): string {
  const readiness = getCampaignWorkerReadiness(input)
  const files = availableFiles(input.assetManifest)
  const payload = {
    campaign: {
      type: input.mission.missionType ?? null,
      title: input.mission.title ?? null,
      goal: input.mission.goal ?? null,
      releaseTarget: input.mission.timeline ?? input.mission.releaseDate ?? null,
      promoBudget: input.mission.promoBudget ?? null,
      mood: input.mission.mood ?? null,
      visualWorld: input.mission.visualWorld ?? null,
      targetListener: input.mission.targetListener ?? input.artistProfile?.audience ?? null,
      references: input.mission.references ?? [],
      channels: input.mission.channels ?? [],
    },
    artist: {
      name: input.artistProfile?.artistName ?? null,
      mission: input.artistProfile?.mission ?? null,
      aliases: input.artistProfile?.aliases ?? null,
      sound: input.artistProfile?.sound ?? null,
      visualWorld: input.artistProfile?.visualWorld ?? null,
      audience: input.artistProfile?.audience ?? null,
      similarArtists: input.artistProfile?.similarArtists ?? null,
      priorityMarkets: input.artistProfile?.priorityMarkets ?? null,
      rules: input.artistProfile?.rules ?? null,
      voice: {
        summary: input.artistVoice?.summary ?? null,
        speakingStyle: input.artistVoice?.speakingStyle ?? null,
        vocabulary: input.artistVoice?.vocabulary ?? null,
        avoid: input.artistVoice?.avoid ?? null,
        commentReplyExamples: input.artistVoice?.commentReplyExamples ?? null,
      },
    },
    assets: {
      master: firstPath(files, ['master', 'demo']),
      lyrics: firstPath(files, ['lyrics']),
      lyricsStatus: firstLyrics(files)?.lyrics?.reviewRequired ? 'needs-review' : firstLyrics(files)?.lyrics ? 'approved' : 'missing',
      lyricsText: firstLyrics(files)?.lyrics?.text ?? null,
      lyricLines: firstLyrics(files)?.lyrics?.lyricLines ?? null,
      coverArt: firstPath(files, ['cover-art']),
      rawVideoCount: countKinds(files, ['raw-video']),
      finalVideoCount: countKinds(files, ['edited-video', 'final-video']),
      photoCount: countKinds(files, ['press-photo']),
      referenceCount: countKinds(files, ['moodboard-image', 'audio-reference']),
    },
    readiness,
  }

  return [
    'Use this as the compact handoff before workers act. It combines the campaign brief, artist identity, and available mission assets.',
    '',
    `Next move: ${readiness.nextMove}`,
    readiness.missing.length ? `Missing: ${readiness.missing.join(', ')}` : 'Missing: none',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
  ].join('\n')
}

function nextMove(essentials: CampaignWorkerReadiness['essentials'], input: CampaignWorkerContextInput): string {
  if (!essentials.campaignBrief) return 'Create the campaign brief.'
  if (!essentials.artistProfile) return 'Add the artist profile in HQ.'
  if (!essentials.master) return 'Add the master or demo in Campaign Assets.'
  if (!essentials.coverArt) return 'Add cover art in Campaign Assets.'
  if (!input.mission.targetListener && !input.artistProfile?.audience) return 'Add the target listener.'
  if (!essentials.lyrics && firstLyrics(availableFiles(input.assetManifest))?.lyrics?.reviewRequired) return 'Review and approve lyrics.'
  if (!essentials.lyrics) return 'Add lyrics when available.'
  return 'Ready to launch workers from this campaign context.'
}

function availableFiles(manifest: MissionAssetManifest | null | undefined): MissionAssetRecord[] {
  return manifest?.files.filter((file) => file.status === 'available') ?? []
}

function hasKind(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): boolean {
  return files.some((file) => kinds.includes(file.kind))
}

function firstPath(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): string | null {
  const file = files.find((record) => kinds.includes(record.kind))
  return file?.relativePath ?? file?.absolutePath ?? null
}

function firstLyrics(files: MissionAssetRecord[]): MissionAssetRecord | null {
  return files.find((record) => record.kind === 'lyrics' && record.lyrics && !record.lyrics.reviewRequired)
    ?? files.find((record) => record.kind === 'lyrics' && record.lyrics)
    ?? null
}

function countKinds(files: MissionAssetRecord[], kinds: MissionAssetRecord['kind'][]): number {
  return files.filter((file) => kinds.includes(file.kind)).length
}
