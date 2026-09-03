import { describe, expect, test } from 'bun:test'
import {
  assertArtistManagerCanSupplyRequestedInputs,
  assertArtistAnswerSupportsValues,
  findArtistAnswerEvidence,
  findArtistAnswerValueEvidence,
  type ArtistAnswerEvidenceMessage,
} from './ScheduledWorkInputAnswerEvidence'

const requestedAt = '2026-09-02T14:00:00.000Z'

function message(overrides: Partial<ArtistAnswerEvidenceMessage> = {}): ArtistAnswerEvidenceMessage {
  return {
    id: 'artist-answer',
    role: 'user',
    content: 'Use Night Drive, 3 results, yes.',
    timestamp: Date.parse('2026-09-02T14:01:00.000Z'),
    inputOrigin: 'human',
    ...overrides,
  }
}

describe('findArtistAnswerEvidence', () => {
  test('returns only the exact current human message after the request', () => {
    const answer = findArtistAnswerEvidence([
      message({ id: 'older', content: 'Use something else.', timestamp: Date.parse('2026-09-02T13:59:00.000Z') }),
      message(),
    ], requestedAt, 'artist-answer')

    expect(answer.id).toBe('artist-answer')
  })

  test('rejects missing, stale, hidden, agent-authored, or non-current evidence', () => {
    expect(() => findArtistAnswerEvidence([], requestedAt, undefined)).toThrow(/Ask the artist/)
    expect(() => findArtistAnswerEvidence([
      message({ timestamp: Date.parse('2026-09-02T13:59:00.000Z') }),
    ], requestedAt, 'artist-answer')).toThrow(/not a valid artist answer/)
    expect(() => findArtistAnswerEvidence([
      message({ hidden: true }),
    ], requestedAt, 'artist-answer')).toThrow(/not a valid artist answer/)
    expect(() => findArtistAnswerEvidence([
      message({ inputOrigin: 'agent' }),
    ], requestedAt, 'artist-answer')).toThrow(/not a valid artist answer/)
    expect(() => findArtistAnswerEvidence([
      message({ id: 'different-message' }),
    ], requestedAt, 'artist-answer')).toThrow(/not a valid artist answer/)
  })

  test('accepts exact string values and current attachments', () => {
    expect(() => assertArtistAnswerSupportsValues(
      'Use Night Drive and the attached mix.',
      [{ name: 'mix.wav', storedPath: '/vault/private/mix.wav' }],
      { song: 'Night Drive', file: '/vault/private/mix.wav' },
    )).not.toThrow()
  })

  test('allows string requests but sends numeric and boolean requests to the Needs you form', () => {
    expect(() => assertArtistManagerCanSupplyRequestedInputs([
      { name: 'file', type: 'string', required: true },
    ], ['file'])).not.toThrow()

    expect(() => assertArtistManagerCanSupplyRequestedInputs([
      { name: 'file', type: 'string', required: true },
      { name: 'count', type: 'number', required: true },
      { name: 'publish', type: 'boolean', required: true },
    ], ['file', 'count', 'publish'])).toThrow(/count, publish.*Needs you form/)

    expect(() => assertArtistAnswerSupportsValues('Use 3 and yes.', [], {
      count: 3,
      publish: true,
    })).toThrow(/count, publish.*Needs you form/)
  })

  test('rejects values invented outside the artist evidence', () => {
    expect(() => assertArtistAnswerSupportsValues('yes', [], {
      file: '/tmp/unmentioned.wav',
    })).toThrow(/file/)
    expect(() => assertArtistAnswerSupportsValues('This is for the artist.', [], {
      category: 'art',
    })).toThrow(/category/)
  })

  test('allows a simple yes to approve exact values in the immediately preceding manager proposal', () => {
    const evidence = findArtistAnswerValueEvidence([
      message({
        id: 'proposal',
        role: 'assistant',
        inputOrigin: 'agent',
        content: 'Use /vault/night-drive.wav and create 3 results?',
        timestamp: Date.parse('2026-09-02T14:00:30.000Z'),
      }),
      message({ content: 'Yes.' }),
    ], requestedAt, 'artist-answer')

    expect(evidence.evidenceText).toContain('/vault/night-drive.wav')
    expect(() => assertArtistAnswerSupportsValues(evidence.evidenceText, evidence.attachments, {
      file: '/vault/night-drive.wav',
    })).not.toThrow()
  })

  test('does not pull old manager text into a non-affirmative answer', () => {
    const evidence = findArtistAnswerValueEvidence([
      message({
        id: 'proposal',
        role: 'assistant',
        content: 'Use /vault/wrong.wav and create 999 results?',
        timestamp: Date.parse('2026-09-02T14:00:30.000Z'),
      }),
      message({ content: 'Use /vault/right.wav and 2.' }),
    ], requestedAt, 'artist-answer')

    expect(evidence.evidenceText).toBe('Use /vault/right.wav and 2.')
    expect(() => assertArtistAnswerSupportsValues(evidence.evidenceText, [], {
      file: '/vault/wrong.wav',
    })).toThrow(/file/)
  })

  test('does not let a bare yes reach past an intervening visible message', () => {
    const evidence = findArtistAnswerValueEvidence([
      message({
        id: 'old-proposal',
        role: 'assistant',
        content: 'Use /vault/wrong.wav and create 999 results?',
        timestamp: Date.parse('2026-09-02T14:00:20.000Z'),
      }),
      message({
        id: 'intervening-answer',
        content: 'What about the release schedule?',
        timestamp: Date.parse('2026-09-02T14:00:40.000Z'),
      }),
      message({ content: 'Yes.' }),
    ], requestedAt, 'artist-answer')

    expect(evidence.evidenceText).toBe('Yes.')
    expect(() => assertArtistAnswerSupportsValues(evidence.evidenceText, [], {
      file: '/vault/wrong.wav',
    })).toThrow(/file/)
  })
})
