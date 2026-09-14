import { describe, expect, it } from 'bun:test'
import {
  campaignTrackCharacterDefaults,
  mergeTrackCharacterDefaults,
  shouldBlockCampaignDrawerDismiss,
} from './campaign-onboarding'

describe('campaign onboarding continuity', () => {
  it('reuses song details from the campaign brief as track-review defaults', () => {
    expect(campaignTrackCharacterDefaults({
      genre: 'alt-pop, drum and bass',
      bpm: 130,
      mood: 'restless, cinematic',
      theme: 'choosing solitude without disappearing',
    })).toEqual({
      genre: ['alt-pop', 'drum and bass'],
      tempoBpm: 130,
      tempoSource: 'manual',
      moods: ['restless', 'cinematic'],
      themes: ['choosing solitude without disappearing'],
    })
  })

  it('keeps analyzed track details and fills only their missing fields', () => {
    expect(mergeTrackCharacterDefaults({
      genre: ['indie pop'],
      energy: 8,
    }, {
      genre: ['alt-pop'],
      tempoBpm: 130,
      tempoSource: 'manual',
      moods: ['cinematic'],
    })).toEqual({
      genre: ['indie pop'],
      energy: 8,
      tempoBpm: 130,
      tempoSource: 'manual',
      moods: ['cinematic'],
    })
  })

  it('blocks incidental drawer dismissal during upload or track review', () => {
    expect(shouldBlockCampaignDrawerDismiss(false, { assetBusy: true, trackReviewOpen: false })).toBe(true)
    expect(shouldBlockCampaignDrawerDismiss(false, { assetBusy: false, trackReviewOpen: true })).toBe(true)
    expect(shouldBlockCampaignDrawerDismiss(false, { assetBusy: false, trackReviewOpen: false })).toBe(false)
    expect(shouldBlockCampaignDrawerDismiss(true, { assetBusy: true, trackReviewOpen: true })).toBe(false)
  })
})
