import { describe, expect, test } from 'bun:test'

import { analysisArtifactSchema, PROTOCOL_VERSION } from '@trade-god/contracts'

import {
  FixtureChecksumMismatchError,
  analyzeOrderFlowFixture,
  loadEsDemoFixture,
  verifyFixtureChecksum,
} from '../src/index.ts'

const fixedMeta = {
  schema_version: PROTOCOL_VERSION,
  trace_id: 'trace-phase0-golden',
  created_at: '2026-07-11T15:30:00.000Z',
  producer: { name: 'order-flow-engine', version: '0.1.0', instance_id: 'fixture-engine-1' },
}

describe('ES demo fixture', () => {
  test('loads a project-owned fixture with a valid content checksum', async () => {
    const fixture = await loadEsDemoFixture()

    expect(fixture.manifest.redistribution).toBe('project-owned')
    expect(fixture.events).toHaveLength(4)
    expect(await verifyFixtureChecksum(fixture)).toBe(true)
  })

  test('rejects altered event bytes before analysis', async () => {
    const fixture = await loadEsDemoFixture()
    const altered = { ...fixture, rawEvents: `${fixture.rawEvents} ` }

    expect(() => analyzeOrderFlowFixture(altered, { meta: fixedMeta, artifact_id: 'artifact-golden' }))
      .toThrow(FixtureChecksumMismatchError)
  })
})

describe('deterministic order-flow summary', () => {
  test('produces the schema-valid golden artifact', async () => {
    const fixture = await loadEsDemoFixture()
    const artifact = analyzeOrderFlowFixture(fixture, { meta: fixedMeta, artifact_id: 'artifact-golden' })

    expect(analysisArtifactSchema.parse(artifact)).toEqual(artifact)
    expect(artifact.summary).toEqual({
      event_count: 4,
      total_volume: '28',
      buy_volume: '17',
      sell_volume: '11',
      delta: '6',
      point_of_control_price: '5592.25',
    })
    expect(artifact.event_time_range).toEqual({
      start: '2026-07-11T14:30:00.000Z',
      end: '2026-07-11T14:30:30.000Z',
    })
    expect(artifact.quality).toEqual({ state: 'valid', flags: [], warnings: [] })
    expect(artifact.content_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('returns identical deterministic content for repeated runs', async () => {
    const fixture = await loadEsDemoFixture()
    const first = analyzeOrderFlowFixture(fixture, { meta: fixedMeta, artifact_id: 'artifact-golden' })
    const second = analyzeOrderFlowFixture(fixture, { meta: fixedMeta, artifact_id: 'artifact-golden' })

    expect(second).toEqual(first)
  })
})
