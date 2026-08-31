import { describe, expect, it } from 'bun:test'
import { getAgentCapabilityDisplay } from './agent-capability-display'

describe('agent capability display', () => {
  it('expands the four Legendary Minds skill packs into six visible persona lenses', () => {
    expect(getAgentCapabilityDisplay('persona-agent', [
      'creative-oracle',
      'steve-jobs-perspective',
      'mrbeast-perspective',
      'tom-ford',
    ])).toEqual({
      title: 'Persona lenses',
      items: ['Kurt Cobain', 'David Bowie', 'Kanye West', 'Tom Ford', 'Steve Jobs', 'MrBeast'],
    })
  })

  it('does not advertise a persona whose backing skill pack is absent', () => {
    expect(getAgentCapabilityDisplay('persona-agent', ['creative-oracle', 'tom-ford'])).toEqual({
      title: 'Persona lenses',
      items: ['Kurt Cobain', 'David Bowie', 'Kanye West', 'Tom Ford'],
    })
  })

  it('leaves ordinary agent skill lists unchanged', () => {
    expect(getAgentCapabilityDisplay('art-director', ['artist-art-direction'])).toEqual({
      title: 'Skills',
      items: ['artist-art-direction'],
    })
  })
})
