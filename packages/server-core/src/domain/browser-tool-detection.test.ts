import { describe, expect, it } from 'bun:test'
import {
  getBrowserToolCommandVerb,
  shouldActivateBrowserOverlay,
} from './browser-tool-detection'

describe('browser tool detection', () => {
  it('does not open a generic browser overlay before a saved profile is attached', () => {
    const input = { command: 'profile spotify spotify-main' }

    expect(getBrowserToolCommandVerb(input)).toBe('profile')
    expect(shouldActivateBrowserOverlay('browser_tool', input)).toBe(false)
    expect(shouldActivateBrowserOverlay('mcp__session__browser_tool', input)).toBe(false)
    expect(shouldActivateBrowserOverlay('browser_tool', { command: 'accounts' })).toBe(false)
    expect(shouldActivateBrowserOverlay('browser_tool', { command: 'account meta-ads artist-main' })).toBe(false)
  })

  it('still activates the overlay for browser inspection after routing', () => {
    expect(shouldActivateBrowserOverlay('browser_tool', { command: 'snapshot' })).toBe(true)
  })
})
