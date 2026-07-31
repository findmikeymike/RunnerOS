import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  CHART_ANNOTATION_SCHEMA_VERSION,
  chartAnnotationSchema,
} from '@trade-god/contracts'

import FuturesChartPanel, { activeRenderableAnnotations } from './FuturesChartPanel.tsx'

const annotation = chartAnnotationSchema.parse({
  annotation_schema_version: CHART_ANNOTATION_SCHEMA_VERSION,
  annotation_id: 'annotation-es-poc',
  scene_id: 'scene-es-5m',
  instrument_id: 'ES',
  timeframe: '5m',
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
  evidence_refs: ['order-flow-artifact-123'],
  authority: 'analysis-only',
})

test('renders the native chart shell without inventing market prices', () => {
  const html = renderToStaticMarkup(
    <FuturesChartPanel
      symbol="ES"
      symbolName="E-mini S&P"
      timeframe="5m"
      sessionMode="ETH"
      annotations={[annotation]}
      onTimeframeChange={() => {}}
      onSessionModeChange={() => {}}
    />,
  )

  expect(html).toContain('Native chart')
  expect(html).toContain('market feed offline')
  expect(html).toContain('No live prices are being claimed')
  expect(html).toContain('1 active annotation layer')
  expect(html).toContain('Analysis-only')
})

test('labels synthetic candles as project-owned preview data', () => {
  const html = renderToStaticMarkup(
    <FuturesChartPanel
      symbol="ES"
      symbolName="E-mini S&P"
      timeframe="5m"
      sessionMode="RTH"
      dataMode="synthetic"
      bars={[{ time: 1785331800 as never, open: 5592, high: 5593, low: 5591.75, close: 5592.75, volume: 420 }]}
      onTimeframeChange={() => {}}
      onSessionModeChange={() => {}}
    />,
  )

  expect(html).toContain('project-owned synthetic fixture')
  expect(html).not.toContain('market feed offline')
})

test('only admits active annotations for the selected instrument and supported first-slice types', () => {
  const hidden = { ...annotation, annotation_id: 'annotation-hidden', state: 'hidden' as const }
  const otherInstrument = { ...annotation, annotation_id: 'annotation-nq', instrument_id: 'NQ' }
  const zone = {
    ...annotation,
    annotation_id: 'annotation-zone',
    payload: { kind: 'price-zone' as const, low: '5580', high: '5590' },
  }

  expect(activeRenderableAnnotations([
    annotation,
    hidden,
    otherInstrument,
    zone,
  ], 'ES')).toEqual([annotation])
})
