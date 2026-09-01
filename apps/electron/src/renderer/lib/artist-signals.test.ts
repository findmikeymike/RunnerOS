import { describe, expect, test } from 'bun:test'
import { appendSignalNugget, readableSignalBody } from './artist-signals'

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
})
