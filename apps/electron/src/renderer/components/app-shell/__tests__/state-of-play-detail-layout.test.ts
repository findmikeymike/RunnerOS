import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('State of Play detail layout', () => {
  test('keeps the artist-facing drawer focused on the recommendation and action', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function StateOfPlayDetailPanel')
    const end = source.indexOf('function openHqStateEntity')
    const detail = source.slice(start, end)

    expect(detail).toContain('Recommended next')
    expect(detail).toContain('Needs attention')
    expect(detail).toContain('Proactive mode')
    expect(detail).not.toContain('System Evidence')
    expect(detail).not.toContain('StateOfPlayHistory')
    expect(detail).not.toContain('contextDocSlugs')
    expect(detail).not.toContain('<Pill')
  })

  test('keeps the HQ recommendation row quiet and moves controls into Details', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function StateOfPlayPanel')
    const end = source.indexOf('function StateOfPlayDetailPanel')
    const summary = source.slice(start, end)

    expect(summary).toContain('aria-label="Why this is recommended"')
    expect(summary).toContain('<TooltipContent className="max-w-[320px] text-xs leading-5">')
    expect(summary).toContain('Details')
    expect(summary).not.toContain('Recommended next move')
    expect(summary).not.toContain('actionState.label')
  })
})
