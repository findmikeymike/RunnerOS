import type { TrackCharacterMetadata } from '@craft-agent/shared/artist-vault'
import type { MissionBrief } from './mission-brief'

type CampaignSongDetails = Pick<MissionBrief, 'genre' | 'bpm' | 'mood' | 'theme'>

export function campaignTrackCharacterDefaults(
  mission: CampaignSongDetails,
): TrackCharacterMetadata | undefined {
  const genre = splitCampaignValues(mission.genre)
  const moods = splitCampaignValues(mission.mood)
  const themes = mission.theme?.trim() ? [mission.theme.trim()] : undefined
  const tempoBpm = mission.bpm

  if (!genre && !moods && !themes && !tempoBpm) return undefined

  return {
    genre,
    tempoBpm,
    tempoSource: tempoBpm ? 'manual' : undefined,
    moods,
    themes,
  }
}

export function mergeTrackCharacterDefaults(
  character?: TrackCharacterMetadata,
  defaults?: TrackCharacterMetadata,
): TrackCharacterMetadata | undefined {
  if (!character && !defaults) return undefined
  const useExistingTempo = character?.tempoBpm !== undefined

  return {
    ...defaults,
    ...character,
    genre: character?.genre?.length ? character.genre : defaults?.genre,
    subgenre: character?.subgenre?.length ? character.subgenre : defaults?.subgenre,
    moods: character?.moods?.length ? character.moods : defaults?.moods,
    themes: character?.themes?.length ? character.themes : defaults?.themes,
    tempoBpm: useExistingTempo ? character.tempoBpm : defaults?.tempoBpm,
    tempoSource: useExistingTempo ? character.tempoSource : defaults?.tempoSource,
  }
}

export function shouldBlockCampaignDrawerDismiss(
  nextOpen: boolean,
  state: { assetBusy: boolean; trackReviewOpen: boolean },
): boolean {
  return !nextOpen && (state.assetBusy || state.trackReviewOpen)
}

function splitCampaignValues(value?: string): string[] | undefined {
  if (!value) return undefined
  const values = value.split(',').map((item) => item.trim()).filter(Boolean)
  return values.length ? [...new Set(values)] : undefined
}
