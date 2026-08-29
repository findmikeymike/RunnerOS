import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Social Pulse Instagram layout', () => {
  test('shows manual and weekly controls plus signed growth details', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function SocialPulseCard')
    const end = source.indexOf('function IntelConfigDialog')
    const socialPulse = source.slice(start, end)

    expect(source).toContain("const INSTAGRAM_SYNC_CRON = '20 9 * * 1'")
    expect(socialPulse).toContain('Run Instagram Insights now — manual')
    expect(socialPulse).toContain('Weekly Instagram Insights auto-run')
    expect(socialPulse).toContain('Follower change')
    expect(socialPulse).toContain('InstagramGrowthChart')
    expect(socialPulse).toContain('aria-label="Open Social Pulse analysis"')
    expect(socialPulse).toContain('title="Follower trend"')
    expect(socialPulse).toContain('bg-[#f97316]/90')
    expect(socialPulse).toContain('bg-[#f97316]/40')
    expect(socialPulse).not.toContain('Artist Kit / Finals')
  })
})
