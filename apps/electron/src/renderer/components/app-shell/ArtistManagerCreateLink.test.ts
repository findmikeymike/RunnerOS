import { describe, expect, it } from 'bun:test'
import { getArtistManagerCreationDraft } from './ArtistManagerCreateLink'

describe('Artist Manager creation drafts', () => {
  it('routes each surface into the matching guided creation flow', () => {
    expect(getArtistManagerCreationDraft('worker')).toContain('create a worker')
    expect(getArtistManagerCreationDraft('workflow')).toContain('chain of specialists')
    expect(getArtistManagerCreationDraft('automation')).toContain('What would you like Artist OS to handle automatically?')
    expect(getArtistManagerCreationDraft('automation')).toContain('bind every required workflow input')
    expect(getArtistManagerCreationDraft('automation')).toContain('daily, weekly, monthly')
    expect(getArtistManagerCreationDraft('automation')).toContain('Do not ask again')
    expect(getArtistManagerCreationDraft('automation')).toContain('schedule_work')
  })

  it('keeps skill discovery local-first and prevents blind marketplace installs', () => {
    const draft = getArtistManagerCreationDraft('skill')
    expect(draft).toContain('Artist OS skills first')
    expect(draft).toContain('Do not install or activate external content')
  })
})
