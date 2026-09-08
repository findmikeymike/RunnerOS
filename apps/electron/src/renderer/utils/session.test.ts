import { describe, expect, test } from 'bun:test'
import { getSessionAgentIdentity, getSessionListDisplay } from './session'

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

  test('uses the agent as the title and conversation topic as supporting context', () => {
    const session = {
      name: 'Build Visual World',
      preview: 'Help me build the visual world.',
      spawnedFromAgent: { agentSlug: 'art-director', agentName: 'Art Director' },
    }

    expect(getSessionListDisplay(session)).toEqual({
      title: 'Art Director',
      subtitle: 'Build Visual World',
    })
  })

  test('uses the first user message beneath a generic saved agent name', () => {
    const session = {
      name: 'Art Director',
      preview: 'Help me build the visual world.',
      spawnedFromAgent: { agentSlug: 'art-director', agentName: 'Art Director' },
    }

    expect(getSessionListDisplay(session)).toEqual({
      title: 'Art Director',
      subtitle: 'Help me build the visual world.',
    })
  })

  test('does not repeat the agent name before a conversation has a topic', () => {
    const session = {
      name: undefined,
      preview: '',
      messageCount: 0,
      spawnedFromAgent: { agentSlug: 'art-director', agentName: 'Art Director' },
    }

    expect(getSessionListDisplay(session)).toEqual({
      title: 'Art Director',
      subtitle: null,
    })
  })

  test('does not treat a generic voice session name as its topic', () => {
    const session = {
      name: 'Artist Manager Voice',
      preview: 'Plan the next single rollout.',
      spawnedFromAgent: { agentSlug: 'concierge', agentName: 'Artist Manager' },
    }

    expect(getSessionListDisplay(session)).toEqual({
      title: 'Artist Manager',
      subtitle: 'Plan the next single rollout.',
    })
  })

  test('shows the current Artist Manager name for legacy HNIC sessions', () => {
    const identity = getSessionAgentIdentity({
      name: 'Old chat title',
      preview: 'What should I work on next?',
      spawnedFromAgent: { agentSlug: 'concierge', agentName: 'HNIC' },
    })

    expect(identity?.name).toBe('Artist Manager')
    expect(identity?.slug).toBe('concierge')
  })
})
