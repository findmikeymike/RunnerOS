import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Release Horizon timeline UI', () => {
  test('renders a continuous track with a zoomed near term instead of twelve boxes', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')

    expect(source).toContain('<HorizonTrack')
    expect(source).toContain('const NEAR_MONTHS = 4')
    expect(source).toContain('const NEAR_WEIGHT = 2')
    expect(source).toContain('const FAR_WEIGHT = 1')
    expect(source).toContain('data-testid="horizon-track"')
    expect(source).not.toContain('grid min-w-[1040px] grid-cols-12')
    expect(source).not.toContain('aspect-square min-h-[86px]')
    expect(source).toContain('bg-white/[0.032]')
    expect(source).toContain('backdrop-blur-2xl')
  })

  test('marks today, campaign spans, and release dots on the track', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')
    const start = source.indexOf('function HorizonTrack')
    const end = source.indexOf('function currentDateKey')
    const track = source.slice(start, end)

    expect(track).toContain('aria-label="Today"')
    expect(track).toContain('key={`span-${span.id}`}')
    expect(track).toContain('key={`release-${release.id}`}')
    expect(track).toContain('release.at - previous < 9 ? !flip : false')
    expect(track).toContain('campaignsActiveInMonth(campaigns, month.key)')
    expect(track).toContain("populated ? 'text-[#ff6a00]'")
  })

  test('shows a countdown for the focus campaign', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')

    expect(source).toContain('daysUntilLabel(focus?.campaign.releaseDate, todayKey)')
    expect(source).toContain("if (delta > 1 && delta <= 90) return `in ${delta} days`")
    expect(source).toContain('dateKeyInTimezone(now.toISOString(), referenceTimezone)')
  })

  test('opens a large presentation view before exposing the structured editor', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')

    expect(source).toContain('sm:max-w-3xl')
    expect(source).toContain("{selectedPlan ? 'Edit' : 'Add plan'}")
    expect(source).toContain('monthEditMode ? (')
    expect(source).toContain('<MonthField label="Title">')
    expect(source).toContain('<MonthField label="Event">')
    expect(source).toContain('<MonthField label="Key goal">')
    expect(source).toContain('<MonthField label="Plan">')
    expect(source).toContain('min-h-64')
    expect(source).toContain('border border-white/30')
    expect(source).toContain('text-white/78">{label}</span>')
  })

  test('loads every campaign for month detail so cross-month deadlines are not hidden', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')

    expect(source).toContain('Promise.all(campaigns.map(async (campaign) =>')
    expect(source).toContain('campaignsActiveInMonth(campaigns, month.key)')
  })
})
