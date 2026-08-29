import { describe, expect, it } from 'bun:test'
import type { ContextDocDTO } from '../../shared/types'
import {
  emptyArtistReleaseHorizon,
  parseArtistReleaseHorizon,
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

    expect(parseArtistReleaseHorizon(doc(body)).months).toEqual({
      '2026-09': { title: 'New single', event: 'release', plan: 'Finish the single.', keyGoal: 'Deliver master' },
    })
  })

  it('migrates legacy month notes without losing the plan text', () => {
    const parsed = parseArtistReleaseHorizon(doc('```json\n{"version":1,"monthNotes":{"2026-10":"Shoot the campaign visuals."}}\n```'))

    expect(parsed.months['2026-10']).toEqual({
      title: 'Shoot the campaign visuals',
      event: 'creation',
      plan: 'Shoot the campaign visuals.',
      keyGoal: '',
    })
  })

  it('returns an empty plan for malformed context', () => {
    expect(parseArtistReleaseHorizon(doc('```json\nnope\n```')).months).toEqual({})
    expect(emptyArtistReleaseHorizon().version).toBe(2)
  })
})
