import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HqRecommendationCandidate } from './lifecycle'
import {
  listHqRecommendationEvents,
  readHqRecommendationStore,
  readHqRecommendationOutcomes,
  transitionHqRecommendation,
  upsertHqRecommendation,
  upsertHqRecommendationOutcome,
} from './recommendation-storage'

const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

describe('HQ recommendation storage', () => {
  test('creates one durable proposal event and preserves lifecycle on refresh', () => {
    const workspace = tempWorkspace()
    const first = upsertHqRecommendation(workspace, candidate())
    const accepted = transitionHqRecommendation(workspace, first.id, 'accepted', {
      actor: { type: 'user', id: 'user-1' },
      reason: 'Do this next.',
      createdAt: '2026-07-10T01:00:00.000Z',
    })
    const refreshed = upsertHqRecommendation(workspace, {
      ...candidate(),
      title: 'Updated display title',
      updatedAt: '2026-07-10T02:00:00.000Z',
      lastProposedAt: '2026-07-10T02:00:00.000Z',
    })

    expect(accepted.status).toBe('accepted')
    expect(refreshed.status).toBe('accepted')
    expect(refreshed.title).toBe('Updated display title')
    expect(listHqRecommendationEvents(workspace).map((event) => event.to)).toEqual(['proposed', 'accepted'])
  })

  test('rejects invalid transitions and deduplicates execution references', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    expect(() => transitionHqRecommendation(workspace, 'sop_test', 'completed', {
      actor: { type: 'system' },
    })).toThrow('Invalid recommendation transition')

    transitionHqRecommendation(workspace, 'sop_test', 'accepted', { actor: { type: 'user' } })
    const launched = transitionHqRecommendation(workspace, 'sop_test', 'launched', {
      actor: { type: 'system' },
      executionRef: { kind: 'session', id: 'session-1', linkedAt: '2026-07-10T03:00:00.000Z' },
    })
    const same = transitionHqRecommendation(workspace, 'sop_test', 'launched', {
      actor: { type: 'system' },
      executionRef: { kind: 'session', id: 'session-1', linkedAt: '2026-07-10T03:00:00.000Z' },
    })

    expect(launched.executionRefs).toHaveLength(1)
    expect(same.executionRefs).toHaveLength(1)
  })

  test('persists snooze timing', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    const snoozed = transitionHqRecommendation(workspace, 'sop_test', 'snoozed', {
      actor: { type: 'user' },
      snoozedUntil: '2026-07-17T00:00:00.000Z',
    })

    expect(snoozed.snoozedUntil).toBe('2026-07-17T00:00:00.000Z')
    expect(readHqRecommendationStore(workspace).candidates[0]?.status).toBe('snoozed')
  })

  test('revives a snoozed recommendation after its deadline', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    transitionHqRecommendation(workspace, 'sop_test', 'snoozed', {
      actor: { type: 'user' },
      snoozedUntil: '2026-07-11T00:00:00.000Z',
    })

    const revived = upsertHqRecommendation(workspace, {
      ...candidate(),
      updatedAt: '2026-07-12T00:00:00.000Z',
      lastProposedAt: '2026-07-12T00:00:00.000Z',
    })

    expect(revived.status).toBe('proposed')
    expect(revived.snoozedUntil).toBeUndefined()
    expect(listHqRecommendationEvents(workspace).map((event) => event.to)).toEqual(['proposed', 'snoozed', 'proposed'])
  })

  test('restores a corrupt primary store from the last known good backup', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendation(workspace, candidate())
    upsertHqRecommendation(workspace, { ...candidate(), title: 'Updated recommendation' })
    const dir = join(workspace, '.state-of-play')
    writeFileSync(join(dir, 'recommendations.json'), '{broken')

    const recovered = readHqRecommendationStore(workspace)

    expect(recovered.candidates[0]?.id).toBe('sop_test')
    expect(readdirSync(dir).some((name) => name.startsWith('recommendations.json.corrupt-'))).toBe(true)
  })

  test('fails closed and preserves corruption when no backup exists', () => {
    const workspace = tempWorkspace()
    const dir = join(workspace, '.state-of-play')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'recommendations.json'), '{broken')

    expect(() => readHqRecommendationStore(workspace)).toThrow('is corrupt')
    expect(readdirSync(dir).some((name) => name.startsWith('recommendations.json.corrupt-'))).toBe(true)
    expect(readdirSync(dir)).toContain('recommendations.json')
  })

  test('persists objective outcomes and preserves usefulness on reevaluation', () => {
    const workspace = tempWorkspace()
    upsertHqRecommendationOutcome(workspace, {
      version: 1, recommendationId: 'sop_test', status: 'unknown', evaluatedAt: '2026-07-10T00:00:00.000Z', evidence: [], userUsefulness: 'useful',
    })
    upsertHqRecommendationOutcome(workspace, {
      version: 1, recommendationId: 'sop_test', status: 'successful', evaluatedAt: '2026-07-10T01:00:00.000Z', evidence: [],
    })

    expect(readHqRecommendationOutcomes(workspace)[0]).toEqual(expect.objectContaining({ status: 'successful', userUsefulness: 'useful' }))
  })
})

function candidate(): HqRecommendationCandidate {
  return {
    version: 1,
    id: 'sop_test',
    fingerprint: 'v1:hq:concierge:weekly-review',
    scope: { type: 'hq' },
    title: 'Run weekly review',
    reason: 'Core context is ready.',
    desiredOutcome: 'A concrete weekly decision.',
    completionContract: { type: 'manual-review' },
    status: 'proposed',
    executionRefs: [],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    lastProposedAt: '2026-07-10T00:00:00.000Z',
  }
}

function tempWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'runneros-hq-recommendations-'))
  workspaces.push(workspace)
  return workspace
}
