import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Pulse run controls', () => {
  test('separates manual Play from the smaller weekly auto-run control', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function PulseRunControls')
    const end = source.indexOf('function SpotifyPulseCard')
    const controls = source.slice(start, end)

    expect(controls).toContain('<Play className="h-3 w-3 fill-current" />')
    expect(controls).toContain('<CalendarClock className="h-3 w-3" />')
    expect(controls).toContain('h-7 w-7')
    expect(controls).toContain('h-6 w-6')
    expect(controls).toContain('aria-pressed={active}')
    expect(source).toContain('manualLabel="Run Spotify Pulse now — manual"')
    expect(source).toContain('weeklyLabel="Weekly Spotify auto-run"')
    expect(source).toContain('manualLabel="Run Intel Pulse now — manual"')
    expect(source).toContain('weeklyLabel="Weekly Intel auto-run"')
    expect(source).toContain('manualLabel="Run Instagram Insights now — manual"')
    expect(source).toContain('weeklyLabel="Weekly Instagram Insights auto-run"')
  })

  test('Intel weekly toggle follows schedule state instead of manual-ready state', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('const toggleIntelPulse')
    const end = source.indexOf('const runIntelPulse')
    const toggle = source.slice(start, end)

    expect(toggle).toContain('const nextScheduled = !intelSyncActive')
    expect(toggle).toContain("cadence: nextScheduled ? 'weekly' : intelConfig.cadence")
    expect(toggle).not.toContain('const nextEnabled = !intelConfig.enabled')
  })

  test('groups all three pulse panels inside one card with thin responsive dividers', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('<div id="hq-home-operations"')
    const end = source.indexOf('<ReleaseHorizon', start)
    const pulseGroup = source.slice(start, end)

    expect(pulseGroup).toContain('<HQCard className="overflow-hidden p-0">')
    expect(pulseGroup).toContain('divide-y divide-white/[0.055]')
    expect(pulseGroup).toContain('lg:divide-x lg:divide-y-0')
    expect(pulseGroup).toContain('<SpotifyPulseCard')
    expect(pulseGroup).toContain('<IntelPulseCard')
    expect(pulseGroup).toContain('<SocialPulseCard')
  })

  test('orders Spotify, Social, Intel and aligns their graphic panels', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('<div id="hq-home-operations"')
    const end = source.indexOf('<ReleaseHorizon', start)
    const pulseGroup = source.slice(start, end)

    expect(pulseGroup.indexOf('<SpotifyPulseCard')).toBeLessThan(pulseGroup.indexOf('<SocialPulseCard'))
    expect(pulseGroup.indexOf('<SocialPulseCard')).toBeLessThan(pulseGroup.indexOf('<IntelPulseCard'))
    expect(source.match(/flex h-\[184px\] flex-col rounded-\[14px\]/g)).toHaveLength(3)
  })
})
