import { describe, expect, test } from 'bun:test'

import {
  ANALYSIS_ARTIFACT_SCHEMA_VERSION,
  PROTOCOL_VERSION,
  analyzeFixtureRequestSchema,
  analysisArtifactSchema,
  cancelAnalysisResponseSchema,
  tradingRunReceiptSchema,
  assertCompatibleProtocol,
  healthResponseSchema,
  tradingErrorSchema,
} from '../src/index.ts'

const meta = {
  schema_version: PROTOCOL_VERSION,
  trace_id: 'trace-01JABCDEF0123456789ABCDEF',
  created_at: '2026-07-11T15:30:00.000Z',
  producer: { name: 'order-flow-engine', version: '0.1.0', instance_id: 'fixture-engine-1' },
}

describe('protocol compatibility', () => {
  test('accepts the same major protocol version', () => {
    expect(assertCompatibleProtocol(PROTOCOL_VERSION)).toEqual({
      compatible: true,
      local_version: PROTOCOL_VERSION,
      remote_version: PROTOCOL_VERSION,
    })
  })

  test('rejects a different major protocol version', () => {
    expect(() => assertCompatibleProtocol('2.0.0')).toThrow('Incompatible trading protocol')
  })
})

describe('health and capabilities', () => {
  test('accepts a ready fixture-mode engine with explicit capabilities', () => {
    const result = healthResponseSchema.parse({
      meta,
      state: 'ready',
      protocol_version: PROTOCOL_VERSION,
      artifact_versions: [ANALYSIS_ARTIFACT_SCHEMA_VERSION],
      capabilities: {
        commands: ['health', 'capabilities', 'analyze_fixture', 'cancel', 'shutdown'],
        fixture_mode: true,
      },
      dependencies: [],
    })

    expect(result.state).toBe('ready')
    expect(result.capabilities.fixture_mode).toBe(true)
  })

  test('rejects health payloads with undeclared commands', () => {
    const result = healthResponseSchema.safeParse({
      meta,
      state: 'ready',
      protocol_version: PROTOCOL_VERSION,
      artifact_versions: [ANALYSIS_ARTIFACT_SCHEMA_VERSION],
      capabilities: { commands: ['place_live_order'], fixture_mode: true },
      dependencies: [],
    })

    expect(result.success).toBe(false)
  })
})

describe('fixture analysis contracts', () => {
  test('accepts a traceable cancellation acknowledgement', () => {
    expect(cancelAnalysisResponseSchema.parse({
      meta,
      cancellation_id: 'cancel-active-analysis',
      state: 'canceled',
    })).toMatchObject({ cancellation_id: 'cancel-active-analysis', state: 'canceled' })
  })
  test('accepts a receipt joining request, trace, and artifact', () => {
    expect(tradingRunReceiptSchema.parse({
      receipt_schema_version: 'trade-run-receipt@1', receipt_id: 'receipt-1', trace_id: meta.trace_id,
      status: 'succeeded', started_at: meta.created_at, completed_at: meta.created_at,
      request: { fixture_id: 'es-demo', fixture_sha256: 'a'.repeat(64) },
      artifact: { artifact_id: 'artifact-1', content_hash: 'b'.repeat(64) },
    }).status).toBe('succeeded')
  })
  test('accepts a fully bounded fixture request', () => {
    const result = analyzeFixtureRequestSchema.parse({
      meta,
      fixture: {
        id: 'es-demo-2026-07-11',
        sha256: 'a'.repeat(64),
      },
      instrument: {
        id: 'CME:ESU6',
        symbol: 'ESU6',
        venue: 'XCME',
        asset_class: 'future',
        currency: 'USD',
        tick_size: '0.25',
        multiplier: '50',
      },
      session: {
        exchange_timezone: 'America/Chicago',
        session_id: '2026-07-11-rth',
      },
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      deadline_at: '2026-07-11T15:30:05.000Z',
      cancellation_id: 'cancel-01JABCDEF0123456789ABCD',
    })

    expect(result.fixture.sha256).toHaveLength(64)
    expect(result.instrument.tick_size).toBe('0.25')
  })

  test('rejects mutable numeric instrument metadata', () => {
    const result = analyzeFixtureRequestSchema.safeParse({
      meta,
      fixture: { id: 'es-demo', sha256: 'a'.repeat(64) },
      instrument: {
        id: 'CME:ESU6', symbol: 'ESU6', venue: 'XCME', asset_class: 'future', currency: 'USD',
        tick_size: 0.25, multiplier: 50,
      },
      session: { exchange_timezone: 'America/Chicago', session_id: '2026-07-11-rth' },
      analysis: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      deadline_at: '2026-07-11T15:30:05.000Z',
      cancellation_id: 'cancel-01JABCDEF0123456789ABCD',
    })

    expect(result.success).toBe(false)
  })

  test('accepts an artifact only with complete provenance and quality state', () => {
    const result = analysisArtifactSchema.parse({
      meta,
      artifact_schema_version: ANALYSIS_ARTIFACT_SCHEMA_VERSION,
      artifact_id: 'artifact-01JABCDEF0123456789AB',
      artifact_type: 'order-flow-summary',
      algorithm: { name: 'order-flow-summary', version: '0.1.0', configuration_hash: 'b'.repeat(64) },
      input: { fixture_id: 'es-demo-2026-07-11', fixture_sha256: 'a'.repeat(64) },
      instrument_id: 'CME:ESU6',
      session_id: '2026-07-11-rth',
      event_time_range: {
        start: '2026-07-11T14:30:00.000Z',
        end: '2026-07-11T14:31:00.000Z',
      },
      quality: { state: 'valid', flags: [], warnings: [] },
      content_hash: 'c'.repeat(64),
      summary: {
        event_count: 4,
        total_volume: '28',
        buy_volume: '17',
        sell_volume: '11',
        delta: '6',
        point_of_control_price: '5592.25',
      },
    })

    expect(result.quality.state).toBe('valid')
    expect(result.summary.delta).toBe('6')
  })
})

describe('typed errors', () => {
  test('preserves safe retry semantics and trace correlation', () => {
    const result = tradingErrorSchema.parse({
      meta,
      code: 'FIXTURE_CHECKSUM_MISMATCH',
      category: 'validation',
      message: 'Fixture checksum does not match its manifest.',
      retryable: false,
      diagnostic_id: 'diag-01JABCDEF0123456789ABCDE',
    })

    expect(result.retryable).toBe(false)
    expect(result.meta.trace_id).toBe(meta.trace_id)
  })
})
