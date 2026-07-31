import React, { useEffect, useMemo, useRef } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type LineWidth,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts'
import {
  Expand,
  Layers3,
} from 'lucide-react'

import type { ChartAnnotation } from '@trade-god/contracts'

export interface FuturesChartBar {
  time: UTCTimestamp
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

interface FuturesChartPanelProps {
  symbol: string
  symbolName: string
  timeframe: string
  sessionMode: 'ETH' | 'RTH'
  bars?: readonly FuturesChartBar[]
  annotations?: readonly ChartAnnotation[]
  dataMode?: 'loading' | 'synthetic' | 'offline' | 'live'
  emptyDetail?: string
  onTimeframeChange: (timeframe: string) => void
  onSessionModeChange: (mode: 'ETH' | 'RTH') => void
}

const timeframeOptions = ['1m', '5m', '15m', '1h'] as const

const lineStyleFor = (style?: ChartAnnotation['style']): LineStyle => {
  if (style?.line_style === 'dotted') return LineStyle.Dotted
  if (style?.line_style === 'dashed') return LineStyle.Dashed
  return LineStyle.Solid
}

const markerShapeFor = (
  shape: Extract<ChartAnnotation['payload'], { kind: 'marker' }>['shape'],
): 'circle' | 'square' | 'arrowUp' | 'arrowDown' => {
  if (shape === 'arrow-up') return 'arrowUp'
  if (shape === 'arrow-down') return 'arrowDown'
  return shape
}

const markerPositionFor = (
  shape: Extract<ChartAnnotation['payload'], { kind: 'marker' }>['shape'],
): 'aboveBar' | 'belowBar' | 'inBar' => {
  if (shape === 'arrow-up') return 'belowBar'
  if (shape === 'arrow-down') return 'aboveBar'
  return 'inBar'
}

export const activeRenderableAnnotations = (
  annotations: readonly ChartAnnotation[],
  instrumentId: string,
): ChartAnnotation[] => annotations.filter((annotation) => (
  annotation.state === 'active'
  && annotation.instrument_id === instrumentId
  && (annotation.payload.kind === 'horizontal-line' || annotation.payload.kind === 'marker')
))

const FuturesChartPanel: React.FC<FuturesChartPanelProps> = ({
  symbol,
  symbolName,
  timeframe,
  sessionMode,
  bars = [],
  annotations = [],
  dataMode = 'offline',
  emptyDetail,
  onTimeframeChange,
  onSessionModeChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const renderableAnnotations = useMemo(
    () => activeRenderableAnnotations(annotations, symbol),
    [annotations, symbol],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: '#11151a' },
        textColor: '#707a8a',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 11,
        attributionLogo: true,
        panes: {
          separatorColor: '#252b33',
          separatorHoverColor: '#39414b',
          enableResize: true,
        },
      },
      grid: {
        vertLines: { color: '#1b2026' },
        horzLines: { color: '#1b2026' },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: '#5f6977', labelBackgroundColor: '#252b33' },
        horzLine: { color: '#5f6977', labelBackgroundColor: '#252b33' },
      },
      rightPriceScale: {
        borderColor: '#252b33',
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: '#252b33',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
        barSpacing: 9,
        minBarSpacing: 2,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        horzTouchDrag: true,
        mouseWheel: true,
        pressedMouseMove: true,
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderUpColor: '#0ecb81',
      borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
      priceLineVisible: false,
      lastValueVisible: true,
    })
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    }, 1)

    candleSeries.setData(bars.map<CandlestickData<UTCTimestamp>>((bar) => ({
      time: bar.time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })))
    volumeSeries.setData(bars
      .filter((bar) => bar.volume !== undefined)
      .map<HistogramData<UTCTimestamp>>((bar) => ({
        time: bar.time,
        value: bar.volume ?? 0,
        color: bar.close >= bar.open ? '#0ecb8155' : '#f6465d55',
      })))

    chart.panes()[1]?.setHeight(88)

    for (const annotation of renderableAnnotations) {
      if (annotation.payload.kind !== 'horizontal-line') continue
      candleSeries.createPriceLine({
        price: Number(annotation.payload.price),
        color: annotation.style?.color ?? '#fcd34d',
        lineWidth: (annotation.style?.line_width ?? 1) as LineWidth,
        lineStyle: lineStyleFor(annotation.style),
        axisLabelVisible: true,
        title: annotation.payload.label ?? annotation.source_id,
      })
    }

    const markers = renderableAnnotations
      .filter((annotation): annotation is ChartAnnotation & {
        payload: Extract<ChartAnnotation['payload'], { kind: 'marker' }>
      } => annotation.payload.kind === 'marker')
      .map<SeriesMarker<UTCTimestamp>>((annotation) => ({
        time: Math.floor(Date.parse(annotation.payload.time) / 1_000) as UTCTimestamp,
        position: markerPositionFor(annotation.payload.shape),
        shape: markerShapeFor(annotation.payload.shape),
        color: annotation.style?.color ?? '#fcd34d',
        text: annotation.payload.text,
      }))
      .sort((left, right) => Number(left.time) - Number(right.time))

    if (markers.length > 0) createSeriesMarkers(candleSeries, markers)
    if (bars.length > 0) chart.timeScale().fitContent()

    return () => chart.remove()
  }, [bars, renderableAnnotations])

  return (
    <article className="overflow-hidden rounded-lg border border-[#252b33] bg-[#11151a]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#252b33] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-sm font-semibold text-white">{symbol}</span>
              <span className="text-[11px] text-[#929aa5]">{symbolName}</span>
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.12em] text-[#5f6977]">
              Native chart · {dataMode === 'synthetic'
                ? 'project-owned synthetic fixture'
                : 'normalized Trade God data'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-md border border-[#303741] bg-[#191e24] p-0.5">
            {timeframeOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onTimeframeChange(option)}
                className={`rounded px-2 py-1 text-[9px] font-medium ${
                  timeframe === option
                    ? 'bg-[#303741] text-white'
                    : 'text-[#707a8a] hover:text-[#d5d9df]'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onSessionModeChange(sessionMode === 'ETH' ? 'RTH' : 'ETH')}
            className="rounded-md border border-[#303741] bg-[#191e24] px-2.5 py-1.5 text-[9px] font-medium text-[#929aa5] hover:text-white"
          >
            {sessionMode}
          </button>
          <button
            type="button"
            aria-label="Open full chart workspace"
            title="Full chart workspace is the next charting phase"
            disabled
            className="rounded-md border border-[#303741] bg-[#191e24] p-1.5 text-[#5f6977]"
          >
            <Expand className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="relative h-[420px] min-h-[320px]">
        <div ref={containerRef} className="absolute inset-0" data-testid="futures-native-chart" />
        {bars.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div className="max-w-sm rounded-lg border border-[#303741] bg-[#11151a]/95 px-5 py-4 text-center shadow-xl">
              <div className="text-xs font-medium text-[#d5d9df]">
                {dataMode === 'loading' ? 'Loading chart data' : 'Chart ready · market feed offline'}
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-[#707a8a]">
                {emptyDetail ?? 'Candles will render from the normalized market-data stream. No live prices are being claimed.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#252b33] px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-[9px] text-[#5f6977]">
          <Layers3 className="h-3 w-3" />
          {renderableAnnotations.length} active annotation layer{renderableAnnotations.length === 1 ? '' : 's'}
        </div>
        <div className="text-[9px] text-[#5f6977]">Analysis-only · chart state is not execution authority</div>
      </footer>
    </article>
  )
}

export default FuturesChartPanel
