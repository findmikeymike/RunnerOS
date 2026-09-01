import { describe, expect, it } from 'bun:test'
import { getArtistManagerCreationDraft } from './ArtistManagerCreateLink'

describe('Artist Manager creation drafts', () => {
  it('routes each surface into the matching guided creation flow', () => {
    expect(getArtistManagerCreationDraft('worker')).toContain('create a worker')
    expect(getArtistManagerCreationDraft('workflow')).toContain('chain of specialists')
    expect(getArtistManagerCreationDraft('automation')).toContain('what should trigger it')
  })

  it('keeps skill discovery local-first and prevents blind marketplace installs', () => {
    const draft = getArtistManagerCreationDraft('skill')
    expect(draft).toContain('Artist OS skills first')
    expect(draft).toContain('Do not install or activate external content')
  })
})
