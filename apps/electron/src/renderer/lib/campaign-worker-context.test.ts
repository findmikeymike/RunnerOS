import { describe, expect, test } from 'bun:test'
import type { MissionAssetManifest } from '../../shared/types'
import type { ArtistProfile } from './artist-profile'
import type { ArtistVoice } from './artist-voice'
import { buildMissionBrief } from './mission-brief'
import {
  campaignWorkerContextMetadata,
  getCampaignWorkerReadiness,
  serializeCampaignWorkerContext,
} from './campaign-worker-context'

const artistProfile: ArtistProfile = {
  version: 1,
  artistName: 'HNlC',
  sound: 'Dark pop with cinematic hooks.',
  audience: 'Heartbroken city kids who live on TikTok.',
  updatedAt: '2026-06-30T00:00:00.000Z',
}

const artistVoice: ArtistVoice = {
  version: 1,
  summary: 'Plainspoken and dry.',
  speakingStyle: 'Short, warm, never corporate.',
  avoid: 'No fake hype.',
  commentReplyExamples: 'appreciate you. this one felt different.',
  updatedAt: '2026-06-30T00:00:00.000Z',
}

type ManifestFixtureKind = 'master' | 'lyrics' | 'approved-lyrics' | 'review-needed-lyrics' | 'cover-art'

function manifest(kinds: ManifestFixtureKind[]): MissionAssetManifest {
  return {
    version: 1,
    workspaceId: 'workspace-1',
    assetsRoot: 'assets',
    storageMode: 'copied',
    files: kinds.map((fixtureKind) => {
      const kind = fixtureKind === 'approved-lyrics' || fixtureKind === 'review-needed-lyrics' ? 'lyrics' : fixtureKind
      return {
        id: `asset-${fixtureKind}`,
        kind,
        label: kind,
        relativePath: `assets/${kind}.txt`,
        source: 'copy',
        status: 'available',
        usableByAgents: true,
        lyrics: fixtureKind === 'approved-lyrics'
          ? { text: 'approved line', reviewRequired: false, status: 'approved' }
          : fixtureKind === 'review-needed-lyrics'
            ? { text: 'draft line', reviewRequired: true, status: 'machine' }
            : undefined,
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
      }
    }),
    updatedAt: '2026-06-30T00:00:00.000Z',
  }
}

describe('campaign worker context', () => {
  test('identifies the next practical missing step', () => {
    const mission = buildMissionBrief('workspace-1', {
      missionType: 'single',
      title: 'Night Drive',
      goal: 'Build presave momentum.',
      timeline: 'June 30',
    })

    const readiness = getCampaignWorkerReadiness({ mission, artistProfile, assetManifest: manifest([]) })

    expect(readiness.ready).toBe(false)
    expect(readiness.nextMove).toBe('Add the master or demo in Campaign Assets.')
    expect(readiness.missing).toContain('Master or demo')
    expect(readiness.missing).toContain('Cover art')
  })

  test('serializes campaign, artist, and asset context for workers', () => {
    const mission = buildMissionBrief('workspace-1', {
      missionType: 'single',
      title: 'Night Drive',
      goal: 'Build presave momentum.',
      timeline: 'June 30',
      targetListener: 'Night-drive pop fans.',
    })

    const body = serializeCampaignWorkerContext({
      mission,
      artistProfile,
      artistVoice,
      assetManifest: manifest(['master', 'approved-lyrics', 'cover-art']),
    })
    const readiness = getCampaignWorkerReadiness({
      mission,
      artistProfile,
      assetManifest: manifest(['master', 'approved-lyrics', 'cover-art']),
    })

    expect(readiness.ready).toBe(true)
    expect(campaignWorkerContextMetadata(readiness).routing).toEqual({ mode: 'broadcast' })
    expect(campaignWorkerContextMetadata(readiness).priority).toBe('high')
    expect(body).toContain('Next move: Ready to launch workers from this campaign context.')
    expect(body).toContain('"title": "Night Drive"')
    expect(body).toContain('"name": "HNlC"')
    expect(body).toContain('"commentReplyExamples": "appreciate you. this one felt different."')
    expect(body).toContain('"master": "assets/master.txt"')
  })

  test('review-needed lyrics block launch-ready context until approved', () => {
    const mission = buildMissionBrief('workspace-1', {
      missionType: 'single',
      title: 'Night Drive',
      goal: 'Build presave momentum.',
      timeline: 'June 30',
      targetListener: 'Night-drive pop fans.',
    })

    const readiness = getCampaignWorkerReadiness({
      mission,
      artistProfile,
      assetManifest: manifest(['master', 'review-needed-lyrics', 'cover-art']),
    })
    const body = serializeCampaignWorkerContext({
      mission,
      artistProfile,
      assetManifest: manifest(['master', 'review-needed-lyrics', 'cover-art']),
    })

    expect(readiness.ready).toBe(false)
    expect(readiness.nextMove).toBe('Review and approve lyrics.')
    expect(readiness.missing).toContain('Approved lyrics')
    expect(body).toContain('"lyricsStatus": "needs-review"')
  })
})
