import { describe, expect, test } from 'bun:test'
import { appendSignalNugget, loadFullSignalOutputText, readableSignalBody } from './artist-signals'

describe('artist signals', () => {
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

  test('keeps the preview when no readable primary asset exists', async () => {
    const content = await loadFullSignalOutputText({
      output: { id: 'output-2', preview: { inlineText: 'Readable preview' } },
      getOutput: async () => null,
      readAssetText: async () => '',
    })

    expect(content).toBe('Readable preview')
  })
})
