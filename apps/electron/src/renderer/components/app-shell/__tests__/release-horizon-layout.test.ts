import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Release Horizon month planning UI', () => {
  test('centers the month title and uses the requested event markers', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')

    expect(source).toContain('top-1/2 flex -translate-y-1/2 items-center justify-center')
    expect(source).toContain("event === 'release' ? 'bg-white/90' : event === 'live' ? 'bg-red-500' : 'bg-[#ff5a00]'")
    expect(source).toContain('absolute left-2 top-2 flex items-baseline gap-1.5')
    expect(source).not.toContain('title="Month plan saved"')
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
