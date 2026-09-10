import { describe, expect, test } from 'bun:test'

import {
  buildPulseChartDomain,
  defaultSpotifyPulseMetric,
  formatPulseExactMetric,
  selectPulseGrowthSeries,
  spotifyPulseMetricOptions,
} from './artist-pulse-presentation'

describe('artist pulse presentation', () => {
  test('uses metrics each Spotify provider can actually supply', () => {
    expect(defaultSpotifyPulseMetric('spotify-web-api')).toBe('popularity')
    expect(spotifyPulseMetricOptions('spotify-web-api')).toEqual([
      { value: 'popularity', label: 'Popularity' },
      { value: 'followers', label: 'Followers' },
    ])

    expect(defaultSpotifyPulseMetric('spotify-for-artists-browser')).toBe('streams')
    expect(spotifyPulseMetricOptions('spotify-for-artists-browser')).toEqual([
      { value: 'streams', label: 'Streams' },
      { value: 'listeners', label: 'Listeners' },
    ])
  })

  test('keeps tiny changes visually proportional instead of filling the chart', () => {
    const domain = buildPulseChartDomain([10_000, 10_010], { mode: 'line', signed: false })
    const renderedSwing = (10 / (domain.max - domain.min)) * 114

    expect(domain.max - domain.min).toBeGreaterThanOrEqual(1_000)
    expect(renderedSwing).toBeLessThan(5)
    expect(buildPulseChartDomain([74], { mode: 'line', signed: false, fixed: { min: 0, max: 100 } })).toEqual({ min: 0, max: 100 })
  })

  test('prefers Instagram history over a single current delta', () => {
    const history = [
      { key: '2026-07-01', label: 'Jul 1', value: 40 },
      { key: '2026-08-01', label: 'Aug 1', value: 55 },
    ]
    const current = { key: '2026-09-01', label: 'Latest', value: 60 }

    expect(selectPulseGrowthSeries([], history, current)).toEqual(history)
    expect(selectPulseGrowthSeries([{ key: '2026-08', label: 'Aug', value: 55 }], history, current)).toEqual([
      { key: '2026-08', label: 'Aug', value: 55 },
    ])
  })

  test('shows exact detail values instead of compact approximations', () => {
    expect(formatPulseExactMetric(12_345)).toBe('12,345')
    expect(formatPulseExactMetric(12_345.67)).toBe('12,345.67')
    expect(formatPulseExactMetric(undefined)).toBe('--')
  })

})
