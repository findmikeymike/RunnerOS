import { describe, expect, it } from 'bun:test'
import { AGENDA_LABEL, agendaTaskPreview, firstAgendaDetailLine, isAgendaSession } from '../agenda-utils'

describe('agenda utils', () => {
  it('includes explicitly tagged agenda sessions', () => {
    expect(isAgendaSession({ labels: [AGENDA_LABEL] })).toBe(true)
  })

  it('includes agenda scoped labels', () => {
    expect(isAgendaSession({ labels: ['agenda::release-week'] })).toBe(true)
  })

  it('excludes ordinary chat sessions', () => {
    expect(isAgendaSession({ labels: ['person::manager'] })).toBe(false)
    expect(isAgendaSession({ labels: undefined })).toBe(false)
  })

  it('uses the first non-empty details line for task previews', () => {
    expect(firstAgendaDetailLine('\n  Call the venue manager  \nConfirm load-in')).toBe('Call the venue manager')
    expect(agendaTaskPreview('Written task details\nSecond line', 'Old preview', undefined)).toBe('Written task details')
  })

  it('uses a clear empty fallback instead of Workspace task', () => {
    expect(agendaTaskPreview('', undefined, undefined)).toBe('No details yet')
  })
})
