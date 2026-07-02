import { describe, expect, it } from 'bun:test'
import { AGENDA_LABEL, isAgendaSession } from '../agenda-utils'

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
})
