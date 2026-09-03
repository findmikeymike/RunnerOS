import type { PermissionMode } from '@craft-agent/shared/agent/modes'

export const ARTIST_OS_PERMISSION_MODES: PermissionMode[] = ['ask', 'allow-all']

export const ARTIST_OS_PERMISSION_MODE_COPY: Record<'ask' | 'allow-all', {
  label: string
  shortLabel: string
  description: string
}> = {
  ask: {
    label: 'Approval Mode',
    shortLabel: 'Approval',
    description: 'Can take action, but asks before protected changes.',
  },
  'allow-all': {
    label: 'Go Mode',
    shortLabel: 'Go',
    description: 'Works without permission prompts. Built-in safeguards still apply.',
  },
}

export function normalizeArtistPermissionMode(mode: PermissionMode): 'ask' | 'allow-all' {
  return mode === 'allow-all' ? 'allow-all' : 'ask'
}
