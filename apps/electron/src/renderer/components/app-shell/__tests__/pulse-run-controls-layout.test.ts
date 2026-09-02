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

  test('uses two compact independent glass pulse panels', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('<div id="hq-home-operations"')
    const end = source.indexOf('<ReleaseHorizon', start)
    const pulseGroup = source.slice(start, end)

    expect(pulseGroup).toContain('id="hq-home-details" className="grid grid-cols-1 gap-3 lg:grid-cols-2"')
    expect(pulseGroup).not.toContain('<HQCard className="overflow-hidden p-0">')
    expect(pulseGroup).toContain('<SpotifyPulseCard')
    expect(pulseGroup).toContain('<SocialPulseCard')
  })

  test('orders Spotify before Social and aligns their compact panels', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('<div id="hq-home-operations"')
    const end = source.indexOf('<ReleaseHorizon', start)
    const pulseGroup = source.slice(start, end)

    expect(pulseGroup.indexOf('<SpotifyPulseCard')).toBeLessThan(pulseGroup.indexOf('<SocialPulseCard'))
    expect(pulseGroup).not.toContain('<IntelPulseCard')
    expect(source.match(/flex h-\[132px\] flex-col overflow-hidden rounded-\[16px\]/g)).toHaveLength(2)
  })
})
