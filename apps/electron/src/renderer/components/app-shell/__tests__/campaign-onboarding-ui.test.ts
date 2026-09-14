import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('campaign onboarding UI continuity', () => {
  it('keeps raw reference text while the user is typing', () => {
    const drawer = readFileSync(join(import.meta.dir, '..', 'MissionBriefDrawer.tsx'), 'utf8')

    expect(drawer).toContain('value={sonicReferencesText}')
    expect(drawer).toContain('setSonicReferencesText(nextValue)')
    expect(drawer).toContain('value={creativeReferencesText}')
    expect(drawer).toContain('setCreativeReferencesText(nextValue)')
  })

  it('guards the drawer and supplies campaign defaults to track review', () => {
    const drawer = readFileSync(join(import.meta.dir, '..', 'MissionBriefDrawer.tsx'), 'utf8')
    const commandCenter = readFileSync(join(import.meta.dir, '..', 'ArtistCommandCenterHome.tsx'), 'utf8')
    const review = readFileSync(join(import.meta.dir, '..', 'TrackIntelligenceReviewDialog.tsx'), 'utf8')

    expect(drawer).toContain('shouldBlockCampaignDrawerDismiss')
    expect(commandCenter).toContain('characterDefaults={campaignTrackDefaults}')
    expect(review).toContain('mergeTrackCharacterDefaults(revision.character, characterDefaults)')
  })
})
