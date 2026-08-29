import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Intel channels dialog layout', () => {
  test('uses compact expandable channel rows and a persistent footer', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')
    const start = source.indexOf('function IntelConfigDialog')
    const end = source.indexOf('function formatMetric')
    const dialog = source.slice(start, end)

    expect(dialog).toContain('aria-expanded={expanded}')
    expect(dialog).toContain("expandedSourceId === source.id")
    expect(dialog).toContain('Why it matters')
    expect(dialog).toContain('min-h-0 flex-1 overflow-y-auto')
    expect(dialog).toContain('flex shrink-0 items-center justify-between')
    expect(dialog).toContain("saving ? 'Saving…' : 'Save changes'")
    expect(dialog).not.toContain('max-h-[420px]')
  })
})
