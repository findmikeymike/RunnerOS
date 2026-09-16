import { describe, expect, it } from 'bun:test'
import { getArtistManagerCreationDraft, getCreationLinkTarget } from './ArtistManagerCreateLink'

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


describe('creation link ownership', () => {
  it('routes Artist OS creation and discovery to the matching Builder focus', () => {
    for (const [kind, focus] of [['worker', 'agents'], ['workflow', 'workflows'], ['automation', 'automations'], ['skill', 'general']] as const) {
      expect(getCreationLinkTarget(kind, 'artist-os')).toMatchObject({ slug: 'builder', displayName: 'Builder', taskModeId: focus })
    }
    expect(getCreationLinkTarget('skill', 'artist-os').label).toBe('Find with Builder')
  })
  it('preserves generic Runner routing and caller-specific labels', () => {
    expect(getCreationLinkTarget('automation', 'runner', 'Set up with Artist Manager')).toMatchObject({ slug: 'concierge', taskModeId: undefined, label: 'Set up with Artist Manager' })
    expect(getCreationLinkTarget('automation', 'artist-os', 'Set up with Artist Manager').label).toBe('Set up with Builder')
    expect(getCreationLinkTarget('automation', 'artist-os', 'Set up').label).toBe('Set up')
  })
  it('Builder starts from the supplied request without a mandatory Manager interview', () => {
    const draft = getArtistManagerCreationDraft('automation', 'artist-os')
    expect(draft).toContain('Reuse the outcome and timing I provide')
    expect(draft).not.toContain('Begin by asking')
    expect(draft).toContain('inspect existing workers, workflows and automations')
  })
})
