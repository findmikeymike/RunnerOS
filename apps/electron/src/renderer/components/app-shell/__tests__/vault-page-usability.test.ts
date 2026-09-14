import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Vault usability', () => {
  const source = readFileSync(join(import.meta.dir, '..', 'VaultPage.tsx'), 'utf8')

  test('blocks repeat analysis before the request and shows the running track', () => {
    const analysis = source.slice(source.indexOf('const analyzeTrack ='), source.indexOf('const confirmImport ='))
    expect(analysis.indexOf('if (!workspaceId || analysisInFlight.current) return false')).toBeLessThan(analysis.indexOf('transcribeArtistVaultTrack'))
    expect(analysis.indexOf('analysisInFlight.current = true')).toBeLessThan(analysis.indexOf('transcribeArtistVaultTrack'))
    expect(analysis).toContain('analysisInFlight.current = false')
    expect(analysis).toContain('setAnalyzingTrackId(null)')
    expect(source).toContain('disabled={busy || analyzingTrackId !== null}')
    expect(source).toContain('aria-busy={analyzingTrackId === asset.id}')
    expect(source).toContain('Analyzing lyrics…')
  })

  test('shows selected tags beside Quick Tags instead of in a distant duplicate field', () => {
    expect(source).toContain('Selected tags')
    expect(source).toContain('aria-pressed={selectedTags.includes(tag)}')
    expect(source).toContain('Add custom tags')
    expect(source).not.toContain('<Field label="Tags">')
  })

  test('makes internal-only policy distinct from agent access', () => {
    expect(source).toContain('Internal only')
    expect(source).toContain('Agents can still work with it inside Artist OS.')
    expect(source).toContain('usableByAgents: true')
    expect(source).not.toContain('expose path to agents')
  })

  test('renders actual image, video, and audio previews without showing a storage path', () => {
    expect(source).toContain('readArtistVaultAssetDataUrl')
    expect(source).toContain('<video')
    expect(source).toContain('<audio')
    expect(source).toContain('<img')
    expect(source).not.toContain("asset.relativePath ?? asset.absolutePath ?? 'No path'")
  })

  test('collects a useful name and note before import without oversized counters', () => {
    expect(source).toContain('Name this asset')
    expect(source).toContain('Add context for agents')
    expect(source).toContain('Ready to import')
    expect(source).not.toContain('<Metric label="Selected"')
    expect(source).not.toContain('<Metric label="Ready"')
    expect(source).not.toContain('<Metric label="Skipped"')
    expect(source).not.toContain('candidate.destinationRelativePath')
  })

  test('keeps list rows artist-facing and free of filesystem metadata', () => {
    expect(source).toContain('asset.notes')
    expect(source).not.toContain("asset.relativePath ?? asset.absolutePath ?? 'No path'")
  })
})
