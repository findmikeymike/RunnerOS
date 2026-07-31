import { describe, expect, test } from 'bun:test'

import {
  CHART_ANNOTATION_SCHEMA_VERSION,
  chartAnnotationSchema,
} from '../src/index.ts'

const validAnnotation = {
  annotation_schema_version: CHART_ANNOTATION_SCHEMA_VERSION,
  annotation_id: 'annotation-es-vwap',
  scene_id: 'scene-es-5m',
  instrument_id: 'CME:ES',
  timeframe: '5m',
  session_id: '2026-07-30-rth',
  source_kind: 'agent',
  source_id: 'order-flow-specialist',
  created_at: '2026-07-30T18:01:00.000Z',
  as_of: '2026-07-30T18:00:59.000Z',
  state: 'active',
  payload: {
    kind: 'horizontal-line',
    price: '5592.25',
    label: 'POC',
  },
  style: {
    color: '#fcd34d',
    line_width: 2,
    line_style: 'dashed',
    opacity: 0.8,
  },
  evidence_refs: ['order-flow-artifact-123'],
  thesis_ref: 'thesis-es-balance',
  authority: 'analysis-only',
} as const

describe('chart annotation contracts', () => {
  test('accepts an attributable analysis-only chart annotation', () => {
    const annotation = chartAnnotationSchema.parse(validAnnotation)

    expect(annotation.payload.kind).toBe('horizontal-line')
    expect(annotation.source_id).toBe('order-flow-specialist')
  })

  test('rejects direct canvas instructions and execution authority', () => {
    expect(() => chartAnnotationSchema.parse({
      ...validAnnotation,
      canvas_command: 'drawLine(1, 2, 3, 4)',
    })).toThrow()

    expect(() => chartAnnotationSchema.parse({
      ...validAnnotation,
      authority: 'trade-execution',
    })).toThrow()
  })

  test('requires explicit invalidation provenance', () => {
    expect(() => chartAnnotationSchema.parse({
      ...validAnnotation,
      state: 'invalidated',
    })).toThrow()

    expect(chartAnnotationSchema.parse({
      ...validAnnotation,
      state: 'invalidated',
      invalidated_at: '2026-07-30T18:02:00.000Z',
    }).state).toBe('invalidated')
  })
})
