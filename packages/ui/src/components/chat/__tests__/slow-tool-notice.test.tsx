import { afterEach, describe, expect, mock, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as React from 'react'

mock.module('i18next', () => ({
  default: {
    t: (key: string, vars?: Record<string, unknown>) =>
      key === 'turnCard.stillWorkingLong' ? `slow:${vars?.seconds}` : 'working',
  },
}))

const { SlowToolNotice } = await import('../SlowToolNotice')

const realNow = Date.now
afterEach(() => { Date.now = realNow })

function at(msAgo: number, running = true): string {
  const now = 1_800_000_000_000
  Date.now = () => now
  return renderToStaticMarkup(
    React.createElement(SlowToolNotice, { startedAt: now - msAgo, running }),
  )
}

describe('telling the artist a tool is still going', () => {
  test('a normal call says nothing at all', () => {
    // A notice on every call is the same noise in a different key.
    expect(at(200)).toBe('')
    expect(at(9_999)).toBe('')
  })

  test('an unusual wait gets a word once it crosses the line', () => {
    expect(at(10_000)).toContain('working')
  })

  test('a long wait admits it is slow, with the count', () => {
    expect(at(45_000)).toContain('slow:45')
    expect(at(120_000)).toContain('slow:120')
  })

  test('a finished tool says nothing, however long it took', () => {
    expect(at(120_000, false)).toBe('')
  })

  test('a row that mounts late still reports the true wait', () => {
    // Elapsed comes from the start time, not from a counter that begins on
    // mount, so scrolling a running tool back into view is honest.
    expect(at(60_000)).toContain('slow:60')
  })
})
