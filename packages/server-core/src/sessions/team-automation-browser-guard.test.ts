import { describe, expect, it } from 'bun:test'
import { assertAutomatedTeamBrowserCommandAllowed } from './team-automation-browser-guard'

describe('Team Mode automated browser guard', () => {
  it.each(['click', 'click-at', 'drag', 'fill', 'type', 'select', 'upload', 'paste', 'key', 'evaluate'])('blocks %s for automation sessions', (command) => {
    expect(() => assertAutomatedTeamBrowserCommandAllowed({
      teamModeEnabled: true,
      launchOrigin: 'automation',
      command,
    })).toThrow('Team Mode blocks automated browser mutations')
  })

  it('allows read-only browser inspection for automation sessions', () => {
    for (const command of ['open', 'profile', 'accounts', 'account', 'navigate', 'snapshot', 'find', 'screenshot', 'network']) {
      expect(() => assertAutomatedTeamBrowserCommandAllowed({
        teamModeEnabled: true,
        launchOrigin: 'automation',
        command,
      })).not.toThrow()
    }
  })

  it('does not constrain a manual session or solo workspace', () => {
    expect(() => assertAutomatedTeamBrowserCommandAllowed({
      teamModeEnabled: true,
      launchOrigin: 'manual',
      command: 'click',
    })).not.toThrow()
    expect(() => assertAutomatedTeamBrowserCommandAllowed({
      teamModeEnabled: false,
      launchOrigin: 'automation',
      command: 'click',
    })).not.toThrow()
  })

  it('blocks mutation in a spawned child with automated ancestry', () => {
    expect(() => assertAutomatedTeamBrowserCommandAllowed({
      teamModeEnabled: true,
      launchOrigin: 'spawned-session',
      automatedAncestry: true,
      command: 'click',
    })).toThrow('Team Mode blocks automated browser mutations')
  })
})
