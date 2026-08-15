import { describe, expect, it } from 'bun:test'
import { lockHolderMatchesLock, parseTasklistImageName } from './lock-identity.ts'

describe('parseTasklistImageName', () => {
  it('extracts the first Windows task image name', () => {
    expect(parseTasklistImageName('"Artist OS.exe","1234","Console","1","150,000 K"')).toBe('Artist OS.exe')
  })

  it('rejects empty and informational tasklist output', () => {
    expect(parseTasklistImageName('')).toBeNull()
    expect(parseTasklistImageName('INFO: No tasks are running which match the specified criteria.')).toBeNull()
  })
})

describe('lockHolderMatchesLock', () => {
  const lock = (execName?: string) => ({ pid: 1234, startedAt: 1_000, execName })

  it('matches recorded executables case-insensitively', () => {
    expect(lockHolderMatchesLock(lock('Artist OS'), 'artist os', null)).toBe(true)
  })

  it('rejects a recycled PID owned by another executable', () => {
    expect(lockHolderMatchesLock(lock('Artist OS'), 'swcd', '/usr/libexec/swcd')).toBe(false)
  })

  it('recognizes legacy Runner, Artist OS, and Craft command lines', () => {
    expect(lockHolderMatchesLock(lock(), null, '/Applications/Runner.app/Contents/MacOS/Runner')).toBe(true)
    expect(lockHolderMatchesLock(lock(), null, '/Applications/Artist OS.app/Contents/MacOS/Artist OS')).toBe(true)
    expect(lockHolderMatchesLock(lock(), null, '/Applications/Craft Agents.app/Contents/MacOS/Craft Agents')).toBe(true)
  })

  it('fails open when a live process cannot be identified', () => {
    expect(lockHolderMatchesLock(lock('Artist OS'), null, null)).toBe(false)
    expect(lockHolderMatchesLock(lock(), null, null)).toBe(false)
  })
})
