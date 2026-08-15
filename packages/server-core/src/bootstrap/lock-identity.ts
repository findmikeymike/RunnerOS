export interface LockIdentity {
  pid: number
  startedAt: number
  /** Basename of process.execPath when the lock was acquired. */
  execName?: string
}

export function parseTasklistImageName(output: string): string | null {
  const line = output.trim().split(/\r?\n/)[0] ?? ''
  if (!line.startsWith('"')) return null
  const end = line.indexOf('"', 1)
  if (end <= 1) return null
  return line.slice(1, end)
}

export function lockHolderMatchesLock(
  lock: LockIdentity,
  liveExecName: string | null,
  liveCommandLine: string | null,
): boolean {
  if (lock.execName) {
    if (!liveExecName) return false
    return liveExecName.toLowerCase() === lock.execName.toLowerCase()
  }
  if (!liveCommandLine) return false
  return /craft|runner|artist[\s-]*os/i.test(liveCommandLine)
}
