import { describe, expect, test } from 'bun:test'
import { appendSignalNugget, loadFullSignalOutputText, readableSignalBody, signalFreshness, signalPreviewText } from './artist-signals'

describe('artist signals', () => {
  test('bounds long normal and error previews without inventing missing content', () => {
    expect(signalPreviewText(Array(1500).fill('Evidence').join(' ')).split(' ')).toHaveLength(120)
    expect(signalPreviewText('  Short\n\npreview.  ')).toBe('Short preview.')
    expect(signalPreviewText('## Heading\n\n**Strong** text.')).toBe('Heading Strong text.')
    expect(signalPreviewText('')).toBe('')
  })
  test('classifies fresh, aging, and stale signal briefs', () => {
    const now = new Date('2026-09-01T12:00:00.000Z')

    expect(signalFreshness('2026-08-26T12:00:00.000Z', now)).toEqual({ status: 'fresh', ageDays: 6 })
    expect(signalFreshness('2026-08-20T12:00:00.000Z', now)).toEqual({ status: 'aging', ageDays: 12 })
    expect(signalFreshness('2026-08-01T12:00:00.000Z', now)).toEqual({ status: 'stale', ageDays: 31 })
    expect(signalFreshness('not-a-date', now)).toBeNull()
  })

  test('hides the machine routing payload while retaining readable intel', () => {
    const body = [
      '```json shared-intel',
      '{"version":1}',
      '```',
      '',
      '## Shared Intel',
      '',
      'Short-form hooks are shifting toward direct opening claims.',
    ].join('\n')

    expect(readableSignalBody(body)).toBe('## Shared Intel\n\nShort-form hooks are shifting toward direct opening claims.')
  })

  test('appends dated selections without overwriting earlier nuggets', () => {
    const first = appendSignalNugget(undefined, {
      text: 'First durable finding.',
      sourceTitle: 'Weekly YouTube Brief',
      sourceKey: 'output:one',
      amendedAt: '2026-08-30T14:00:00.000Z',
    })
    const second = appendSignalNugget(first, {
      text: 'Second durable finding.\nWith supporting context.',
      sourceTitle: 'Trend Report',
      sourceKey: 'output:two',
      amendedAt: '2026-08-31T15:00:00.000Z',
    })

    expect(second).toContain('First durable finding.')
    expect(second).toContain('> Second durable finding.\n> With supporting context.')
    expect(second).toContain('<!-- signal-source: output:one -->')
    expect(second).toContain('<!-- signal-source: output:two -->')
    expect(second).toContain('_Last amended: 2026-08-31T15:00:00.000Z_')
    expect(second).not.toContain('_Last amended: 2026-08-30T14:00:00.000Z_')
  })

  test('loads the full primary report instead of stopping at the inline preview', async () => {
    const reads: Array<{ outputId: string; assetId?: string }> = []
    const content = await loadFullSignalOutputText({
      output: {
        id: 'output-1',
        summary: 'Summary',
        preview: { assetId: 'preview-asset', inlineText: 'First 800 characters...' },
      },
      getOutput: async () => ({ primaryAssetId: 'primary-asset' }),
      readAssetText: async (outputId, assetId) => {
        reads.push({ outputId, assetId })
        return '# Complete report\n\nAll report sections.'
      },
    })

    expect(content).toBe('# Complete report\n\nAll report sections.')
    expect(reads).toEqual([{ outputId: 'output-1', assetId: 'primary-asset' }])
  })

  test('does not present a preview as the full report when the primary asset is missing', async () => {
    await expect(loadFullSignalOutputText({
      output: { id: 'output-2', preview: { inlineText: 'Readable preview' } },
      getOutput: async () => null,
      readAssetText: async () => '',
    })).rejects.toThrow('full report file is unavailable')
  })

  test('asset and manifest failures remain errors and a fresh attempt can recover', async () => {
    let failed = true
    const input = { output: { id: 'out', preview: { inlineText: 'Only a preview' } }, getOutput: async () => ({ primaryAssetId: 'report' }),
      readAssetText: async () => { if (failed) throw new Error('Disk read failed'); return 'Complete report' } }
    await expect(loadFullSignalOutputText(input)).rejects.toThrow('Disk read failed')
    failed = false
    expect(await loadFullSignalOutputText(input)).toBe('Complete report')
    await expect(loadFullSignalOutputText({ ...input, getOutput: async () => { throw new Error('Manifest read failed') } })).rejects.toThrow('Manifest read failed')
    await expect(loadFullSignalOutputText({ ...input, readAssetText: async () => '  ' })).rejects.toThrow('full report file is empty')
    await expect(loadFullSignalOutputText({ ...input, output: { id: 'out', preview: { assetId: 'preview' } }, getOutput: async () => ({}) })).rejects.toThrow('full report file is unavailable')
  })
})
