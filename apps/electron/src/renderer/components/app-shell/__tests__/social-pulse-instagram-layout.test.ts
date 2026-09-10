import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Social Pulse Instagram layout', () => {
  test('keeps controls and renders first-run monthly growth in the signals strip and modal', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const stripStart = source.indexOf('function SignalsStrip')
    const stripEnd = source.indexOf('function SignalTile')
    const strip = source.slice(stripStart, stripEnd)
    const detailsStart = source.indexOf('function SocialPulseDetails')
    const detailsEnd = source.indexOf('function formatSignedMetric')
    const details = source.slice(detailsStart, detailsEnd)
    const spotifyDetailsStart = source.indexOf('function SpotifyPulseDetails')
    const spotifyDetailsEnd = source.indexOf('function SignalStat')
    const spotifyDetails = source.slice(spotifyDetailsStart, spotifyDetailsEnd)

    expect(source).toContain("const INSTAGRAM_SYNC_CRON = '20 9 * * 1'")
    expect(strip).toContain('Run Instagram Insights now — manual')
    expect(strip).toContain('Weekly Instagram Insights auto-run')
    expect(strip).toContain('value={formatMetric(instagramSnapshot?.metrics.followers)}')
    expect(strip).toContain('label="Monthly growth"')
    expect(strip).toContain('ariaLabel="Open Social Pulse analysis"')
    expect(strip).toContain('trendMode="bars"')
    expect(strip).toContain('instagramMonthlyFollowers.at(-1)?.net')
    expect(strip).toContain('signedTrend')
    expect(strip).toContain('buildArtistSpotifyMonthlyStreams(spotifySnapshot)')
    expect(strip).toContain('buildArtistSpotifyMonthlyListeners(spotifySnapshot)')
    expect(source).toContain('const recent = values.slice(-12)')
    expect(source).toContain("const showTrend = trendMode === 'bars' ? trend.length >= 1 : trend.length >= 2")
    expect(spotifyDetails).toContain('title="Monthly streams"')
    expect(spotifyDetails).toContain('title="Monthly listeners"')
    expect(details).toContain('Follower change')
    expect(details).toContain('title="Monthly follower growth"')
    expect(details).toContain('monthlyFollowers.slice().reverse()')
    expect(source).toContain("value >= 0 ? 'bottom-1/2 bg-[#f97316]/90' : 'top-1/2 bg-red-300/75'")
    expect(source).not.toContain('Artist Kit / Finals')
  })
})
