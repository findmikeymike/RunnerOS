import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Social Pulse Instagram layout', () => {
  test('keeps manual and weekly controls plus signed growth details in the signals strip', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const stripStart = source.indexOf('function SignalsStrip')
    const stripEnd = source.indexOf('function SignalTile')
    const strip = source.slice(stripStart, stripEnd)
    const detailsStart = source.indexOf('function SocialPulseDetails')
    const detailsEnd = source.indexOf('function formatSignedMetric')
    const details = source.slice(detailsStart, detailsEnd)

    expect(source).toContain("const INSTAGRAM_SYNC_CRON = '20 9 * * 1'")
    expect(strip).toContain('Run Instagram Insights now — manual')
    expect(strip).toContain('Weekly Instagram Insights auto-run')
    expect(strip).toContain('ariaLabel="Open Social Pulse analysis"')
    expect(strip).toContain('trendMode="bars"')
    expect(strip).toContain('instagramHistory.map((point) => point.followerDelta)')
    expect(details).toContain('Follower change')
    expect(details).toContain('title="Follower trend"')
    expect(source).toContain("value >= 0 ? 'bg-[#f97316]/90' : 'bg-[#f97316]/40'")
    expect(source).not.toContain('Artist Kit / Finals')
  })
})
