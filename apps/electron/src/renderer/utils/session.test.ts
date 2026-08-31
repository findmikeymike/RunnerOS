import { describe, expect, test } from 'bun:test'
import { getSessionAgentIdentity, getSessionPreviewText } from './session'

describe('session agent identity', () => {
  test('prefers the persisted spawning agent and keeps the receipt description', () => {
    const identity = getSessionAgentIdentity({
      name: 'Generated thread title',
      preview: 'Help me build the visual world.',
      spawnedFromAgent: { agentSlug: 'art-director', agentName: 'Art Director' },
      launchReceipt: {
        agent: { slug: 'art-director', name: 'Old Art Director', description: 'Directs the campaign visual world.' },
      } as never,
    })

    expect(identity).toEqual({
      slug: 'art-director',
      name: 'Art Director',
      description: 'Directs the campaign visual world.',
    })
  })

  test('keeps the request preview when the agent name replaces the generated title', () => {
    const session = {
      name: 'Generated thread title',
      preview: 'Help me build the visual world.',
      spawnedFromAgent: { agentSlug: 'art-director', agentName: 'Art Director' },
    }

    expect(getSessionPreviewText(session, 64, 'Art Director')).toBe('Help me build the visual world.')
  })
})
