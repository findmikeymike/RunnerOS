import { describe, expect, test } from 'bun:test'
import { parseAgentDeepLinkSelection } from '../agent-deep-link'
import { routes } from '../routes'
import { parseRoute } from '../route-parser'

describe('agent deep-link intent', () => {
  test('round-trips exact agent and focus without a prompt/capability payload', () => {
    const route = routes.action.newSession({ agentSlug: 'content-genius', taskModeId: 'ideas', input: 'Develop this song idea', send: true })
    const parsed = parseRoute(route)!
    expect(parseAgentDeepLinkSelection(parsed.params)).toEqual({ agentSlug: 'content-genius', taskModeId: 'ideas' })
    expect(parsed.params.input).toBe('Develop this song idea')
    expect(parsed.params.send).toBe('true')
  })
  test('generic links stay generic and unspecified specialist focus stays pending', () => {
    expect(parseAgentDeepLinkSelection({ input: 'hello' })).toBeUndefined()
    expect(parseAgentDeepLinkSelection({ agentSlug: 'art-director' })).toEqual({ agentSlug: 'art-director' })
  })
  test('rejects unbound modes and path-like agent identities', () => {
    expect(() => parseAgentDeepLinkSelection({ taskModeId: 'full' })).toThrow('name its agent')
    expect(() => parseAgentDeepLinkSelection({ agentSlug: '../evil' })).toThrow('Invalid')
  })
})
