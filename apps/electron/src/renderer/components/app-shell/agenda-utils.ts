import type { SessionMeta } from '@/atoms/sessions'

export const AGENDA_LABEL = 'agenda'
const AGENDA_LABEL_PREFIX = `${AGENDA_LABEL}::`

export function isAgendaSession(session: Pick<SessionMeta, 'labels'>): boolean {
  return (session.labels ?? []).some(
    (label) => label === AGENDA_LABEL || label.startsWith(AGENDA_LABEL_PREFIX),
  )
}

export function firstAgendaDetailLine(notes: string | undefined): string | null {
  const firstLine = notes
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine || null
}

export function agendaTaskPreview(
  notes: string | undefined,
  sessionPreview: string | undefined,
  agentName: string | undefined,
): string {
  return firstAgendaDetailLine(notes)
    ?? sessionPreview?.trim()
    ?? agentName?.trim()
    ?? 'No details yet'
}
