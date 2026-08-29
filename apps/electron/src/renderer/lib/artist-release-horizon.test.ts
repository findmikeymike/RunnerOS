import { describe, expect, it } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  emptyArtistReleaseHorizon,
  parseArtistReleaseHorizon,
  parseArtistReleaseHorizonDocResult,
  serializeArtistReleaseHorizon,
} from './artist-release-horizon'

function doc(body: string): ContextDocDTO {
  return { body } as ContextDocDTO
}

describe('artist release horizon', () => {
  it('round trips structured month plans and drops invalid keys', () => {
    const body = serializeArtistReleaseHorizon({
      version: 2,
      months: {
        '2026-09': { title: 'New single', event: 'release', plan: 'Finish the single.', keyGoal: 'Deliver master' },
        nope: { title: 'Ignore', event: 'business', plan: '', keyGoal: '' },
      },
      updatedAt: '2026-08-29T00:00:00.000Z',
    })

    const parsed = parseArtistReleaseHorizonDocResult(doc(body))
    expect(parsed.horizon.months).toEqual({
      '2026-09': { title: 'New single', event: 'release', plan: 'Finish the single.', keyGoal: 'Deliver master' },
    })
    expect(parsed.horizon.updatedAt).toBe('2026-08-29T00:00:00.000Z')
  })

  it('migrates legacy month notes without losing the plan text', () => {
    const result = parseArtistReleaseHorizonDocResult(doc('```json\n{"version":1,"monthNotes":{"2026-10":"Shoot the campaign visuals."}}\n```'))
    const parsed = result.horizon

    expect(parsed.months['2026-10']).toEqual({
      title: 'Shoot the campaign visuals',
      event: 'creation',
      plan: 'Shoot the campaign visuals.',
      keyGoal: '',
    })
    expect(result.ok).toBe(false)
    expect(parsed.updatedAt).toBe('1970-01-01T00:00:00.000Z')
  })

  it('returns an empty plan for malformed context', () => {
    expect(parseArtistReleaseHorizon(doc('```json\nnope\n```')).months).toEqual({})
    expect(emptyArtistReleaseHorizon().version).toBe(2)
  })
})
