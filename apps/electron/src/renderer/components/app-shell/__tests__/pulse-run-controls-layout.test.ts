import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Pulse run controls', () => {
  test('joins manual Play and weekly scheduling in one divided control', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function PulseRunControls')
    const end = source.indexOf('function RecentActivity')
    const controls = source.slice(start, end)

    expect(controls).toContain('<Play className="h-3 w-3 fill-current" />')
    expect(controls).toContain('<CalendarClock className="h-3 w-3" />')
    expect(controls).toContain('h-7 w-7')
    expect(controls).toContain('divide-x divide-white/[0.08]')
    expect(controls).toContain('overflow-hidden rounded-[7px] border')
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

  test('renders four metrics inside two divided provider cards', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('<div id="hq-home-operations"')
    const end = source.indexOf('<ReleaseHorizon', start)
    const home = source.slice(start, end)

    expect(home).toContain('<ManagerAskBar')
    expect(home).toContain('<SignalsStrip')
    expect(home.indexOf('<ManagerAskBar')).toBeLessThan(home.indexOf('<SignalsStrip'))
    expect(home).not.toContain('<SpotifyPulseCard')
    expect(home).not.toContain('<SocialPulseCard')
    expect(source).toContain('grid grid-cols-1 gap-2 lg:grid-cols-2')
    expect(source.match(/grid min-w-0 grid-cols-2 divide-x/g)).toHaveLength(2)
    expect(source).toContain('Performance')
    expect(source.match(/<SignalTile\n/g)).toHaveLength(4)
    expect(source).not.toContain('flex h-[132px] flex-col overflow-hidden rounded-[16px]')
  })

  test('places each provider control in the top corner of its metric card', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function SignalsStrip')
    const end = source.indexOf('function SignalTile', start)
    const strip = source.slice(start, end)
    const grid = strip.indexOf('<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">')
    const firstControls = strip.indexOf('<PulseRunControls', grid)

    expect(grid).toBeGreaterThan(-1)
    expect(firstControls).toBeGreaterThan(-1)
    expect(firstControls).toBeGreaterThan(grid)
    expect(strip.match(/absolute right-3 top-2\.5 z-10/g)).toHaveLength(2)
    expect(strip).toContain('manualLabel="Run Spotify Pulse now — manual"')
    expect(strip).toContain('manualLabel="Run Instagram Insights now — manual"')
  })

  test('shows honest pre-baseline copy instead of a blank card', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

    expect(source).toContain('First read ${weeklyCronLabel(SPOTIFY_SYNC_CRON)}')
    expect(source).toContain('First read ${weeklyCronLabel(INSTAGRAM_SYNC_CRON)}')
    expect(source).toContain("'Run Spotify Pulse to start'")
    expect(source).toContain("{empty ? '—' : value}")
  })
})
