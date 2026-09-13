import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Artist HQ public context', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'ArtistHQHome.tsx'), 'utf8')

  test('keeps durable profile enrichment off for V1 and shows the simple context panel', () => {
    const flags = readFileSync(join(import.meta.dir, '../../../../../../../packages/shared/src/feature-flags.ts'), 'utf8')
    expect(flags).toContain('artistProfileEnrichmentV2: false')
    expect(source).toContain('FEATURE_FLAGS.artistProfileEnrichmentV2 ? (')
    expect(source).toContain('<ArtistPublicContextPanel')
    expect(source).toContain('Public articles & context')
  })

  test('saves artist-supplied context for on-demand retrieval with conflict protection', () => {
    expect(source).toContain("slug: ARTIST_PUBLIC_CONTEXT_SLUG")
    expect(source).toContain("routing: { mode: 'broadcast' }")
    expect(source).toContain("delivery: 'on-demand'")
    expect(source).toContain('expectedBody,')
    expect(source).toContain("window.confirm('Clear the saved public articles and context?')")
  })
})
