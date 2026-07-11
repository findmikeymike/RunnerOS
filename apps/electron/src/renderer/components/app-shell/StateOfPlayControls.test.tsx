import * as React from 'react'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { StateOfPlayHistory, StateOfPlayOutcomeFeedback, StateOfPlayRefreshButton } from './StateOfPlayControls'

describe('State of Play controls', () => {
  test('renders expanded lifecycle history with reason and count', () => {
    const html = renderToStaticMarkup(<StateOfPlayHistory
      open
      onToggle={() => undefined}
      formatDate={() => 'Jul 11'}
      events={[{
        version: 1, id: 'event-1', recommendationId: 'sop-1', from: 'accepted', to: 'launched',
        actor: { type: 'system' }, reason: 'Session linked.', createdAt: '2026-07-11T00:00:00.000Z',
      }]}
    />)

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('launched')
    expect(html).toContain('Session linked.')
    expect(html).toContain('Jul 11')
  })

  test('renders feedback selection accessibly', () => {
    const html = renderToStaticMarkup(<StateOfPlayOutcomeFeedback selected="useful" onRate={() => undefined} />)

    expect(html).toContain('Was this useful?')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Not useful')
  })

  test('renders an accessible disabled regenerate control while refreshing', () => {
    const html = renderToStaticMarkup(<StateOfPlayRefreshButton busy onRefresh={() => undefined} />)

    expect(html).toContain('aria-label="Regenerate State of Play"')
    expect(html).toContain('disabled=""')
    expect(html).toContain('animate-spin')
  })
})
