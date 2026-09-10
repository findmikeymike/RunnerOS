export type SpotifyPulseMetric = 'streams' | 'listeners' | 'popularity' | 'followers'

type SpotifyPulseSource = 'spotify-web-api' | 'spotify-for-artists-browser' | 'manual' | undefined

const SPOTIFY_PUBLIC_METRICS = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'followers', label: 'Followers' },
] satisfies Array<{ value: SpotifyPulseMetric; label: string }>

const SPOTIFY_ARTIST_METRICS = [
  { value: 'streams', label: 'Streams' },
  { value: 'listeners', label: 'Listeners' },
] satisfies Array<{ value: SpotifyPulseMetric; label: string }>

export function spotifyPulseMetricOptions(source: SpotifyPulseSource) {
  return source === 'spotify-web-api' ? SPOTIFY_PUBLIC_METRICS : SPOTIFY_ARTIST_METRICS
}

export function defaultSpotifyPulseMetric(source: SpotifyPulseSource): SpotifyPulseMetric {
  return source === 'spotify-web-api' ? 'popularity' : 'streams'
}

export function buildPulseChartDomain(
  values: number[],
  options: {
    mode: 'line' | 'bars'
    signed: boolean
    fixed?: { min: number; max: number }
  },
): { min: number; max: number } {
  if (options.fixed) return options.fixed
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length === 0) return { min: 0, max: 1 }

  const rawMin = Math.min(...finiteValues)
  const rawMax = Math.max(...finiteValues)
  if (options.signed || options.mode === 'bars') {
    const min = options.signed ? Math.min(0, rawMin) : 0
    const max = options.signed ? Math.max(0, rawMax) : Math.max(1, rawMax)
    return min === max ? { min: min - 1, max: max + 1 } : { min, max }
  }

  const observedSpan = rawMax - rawMin
  const scale = Math.max(1, Math.abs(rawMin), Math.abs(rawMax))
  const padding = Math.max(1, observedSpan * 0.08, scale * 0.05)
  return {
    min: rawMin >= 0 ? Math.max(0, rawMin - padding) : rawMin - padding,
    max: rawMax + padding,
  }
}

export function selectPulseGrowthSeries<T>(monthly: T[], history: T[], current?: T): T[] {
  if (monthly.length > 0) return monthly
  if (history.length > 0) return history.slice(-12)
  return current ? [current] : []
}

export function formatPulseExactMetric(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}
