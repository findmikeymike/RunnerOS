import { describe, expect, it } from 'bun:test'
import { resolveAgentSourceReadiness } from './agent-source-readiness'

describe('resolveAgentSourceReadiness', () => {
  it('reports ready when an agent needs no sources', () => {
    expect(resolveAgentSourceReadiness([], [], [])).toEqual({ status: 'ready', sources: [] })
  })

  it('blocks when a required source is missing, disabled, or unauthenticated', () => {
    expect(resolveAgentSourceReadiness(
      ['missing', 'disabled', 'needs-auth'],
      [],
      [
        { slug: 'disabled', enabled: false, usable: false },
        { slug: 'needs-auth', enabled: true, usable: false },
      ],
    )).toEqual({
      status: 'blocked',
      sources: [
        { slug: 'missing', required: true, status: 'missing' },
        { slug: 'disabled', required: true, status: 'disabled' },
        { slug: 'needs-auth', required: true, status: 'authentication-required' },
      ],
    })
  })

  it('degrades instead of blocking when only an optional source is unavailable', () => {
    expect(resolveAgentSourceReadiness(
      ['required'],
      ['optional'],
      [
        { slug: 'required', enabled: true, usable: true },
        { slug: 'optional', enabled: true, usable: false },
      ],
    )).toEqual({
      status: 'degraded',
      sources: [
        { slug: 'required', required: true, status: 'ready' },
        { slug: 'optional', required: false, status: 'authentication-required' },
      ],
    })
  })

  it('reports ready when every declared source is usable', () => {
    expect(resolveAgentSourceReadiness(
      ['required'],
      ['optional'],
      [
        { slug: 'required', enabled: true, usable: true },
        { slug: 'optional', enabled: true, usable: true },
      ],
    ).status).toBe('ready')
  })

  it('deduplicates slugs and treats a required declaration as authoritative', () => {
    expect(resolveAgentSourceReadiness(
      ['shared', 'shared'],
      ['shared', 'extra', 'extra'],
      [
        { slug: 'shared', enabled: true, usable: true },
        { slug: 'extra', enabled: true, usable: true },
      ],
    ).sources).toEqual([
      { slug: 'shared', required: true, status: 'ready' },
      { slug: 'extra', required: false, status: 'ready' },
    ])
  })
})
