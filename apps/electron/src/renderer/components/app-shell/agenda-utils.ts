import type { SessionMeta } from '@/atoms/sessions'

export const AGENDA_LABEL = 'agenda'
const AGENDA_LABEL_PREFIX = `${AGENDA_LABEL}::`

export function isAgendaSession(session: Pick<SessionMeta, 'labels'>): boolean {
  return (session.labels ?? []).some(
    (label) => label === AGENDA_LABEL || label.startsWith(AGENDA_LABEL_PREFIX),
  )
}
