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

    expect(home).toContain('manager={<ArtistManagerOrb onOpen={() => managerVoice.setOpen(true)} />}')
    expect(home).toContain('<SignalsStrip')
    expect(home).not.toContain('<ManagerAskBar')
    expect(home).not.toContain('<SpotifyPulseCard')
    expect(home).not.toContain('<SocialPulseCard')
    expect(source).toContain('className="hq-manager-performance-row"')
    expect(source.match(/className="hq-pulse-metrics"/g)).toHaveLength(2)
    const spotify = source.indexOf('aria-label="Spotify performance"')
    const manager = source.indexOf('className="hq-performance-manager"')
    const instagram = source.indexOf('aria-label="Instagram performance"')
    expect(spotify).toBeGreaterThan(-1)
    expect(manager).toBeGreaterThan(spotify)
    expect(instagram).toBeGreaterThan(manager)
    expect(source.match(/<SignalTile\n/g)).toHaveLength(4)
    expect(source).not.toContain('flex h-[132px] flex-col overflow-hidden rounded-[16px]')
  })

  test('places each provider control in its card heading above the metrics', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function SignalsStrip')
    const end = source.indexOf('function SignalTile', start)
    const strip = source.slice(start, end)
    const grid = strip.indexOf('<div className="hq-manager-performance-row">')
    const firstControls = strip.indexOf('<PulseRunControls', grid)

    expect(grid).toBeGreaterThan(-1)
    expect(firstControls).toBeGreaterThan(-1)
    expect(firstControls).toBeGreaterThan(grid)
    const headings = strip.split('<div className="hq-pulse-heading">').slice(1)
    expect(headings).toHaveLength(2)
    for (const heading of headings) {
      expect(heading.indexOf('<PulseRunControls')).toBeGreaterThan(-1)
      expect(heading.indexOf('<PulseRunControls')).toBeLessThan(heading.indexOf('className="hq-pulse-metrics"'))
    }
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
