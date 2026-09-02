import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Release Horizon month planning UI', () => {
  test('places a simple month title directly above the campaign activity line', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ReleaseHorizon.tsx'), 'utf8')

    expect(source).toContain("activeCampaigns.length > 0 ? 'bottom-[17px]' : 'bottom-2'")
    expect(source).toContain('truncate text-left text-[9px] font-normal')
    expect(source).not.toContain('top-1/2 flex -translate-y-1/2 items-center justify-center')
    expect(source).toContain('absolute left-2 top-2 flex items-baseline gap-1.5')
    expect(source).not.toContain('title="Month plan saved"')
    expect(source).toContain('bg-white/[0.032]')
    expect(source).toContain('backdrop-blur-2xl')
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
