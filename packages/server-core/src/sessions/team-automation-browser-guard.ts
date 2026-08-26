import type { SessionLaunchReceipt } from '@craft-agent/shared/sessions'

const EXTERNAL_MUTATION_CAPABLE_COMMANDS = new Set([
  'click',
  'click-at',
  'drag',
  'fill',
  'type',
  'select',
  'upload',
  'paste',
  'key',
  'evaluate',
])

export function isAutomatedLaunch(origin: SessionLaunchReceipt['origin'] | undefined): boolean {
  return origin === 'automation' || origin === 'workflow' || origin === 'deep-research'
}

export function assertAutomatedTeamBrowserCommandAllowed(input: {
  teamModeEnabled: boolean
  launchOrigin?: SessionLaunchReceipt['origin']
  automatedAncestry?: boolean
  command: string
}): void {
  if (
    input.teamModeEnabled
    && (input.automatedAncestry === true || isAutomatedLaunch(input.launchOrigin))
    && EXTERNAL_MUTATION_CAPABLE_COMMANDS.has(input.command.toLowerCase())
  ) {
    throw new Error(
      'Team Mode blocks automated browser mutations. This run may inspect and draft, but a person must perform the final browser action in a manual session.',
    )
  }
}
