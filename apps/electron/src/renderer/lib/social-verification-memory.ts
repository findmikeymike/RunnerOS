import type { SocialAccountProfileStatus, SocialAccountsDoctorResult } from '../../shared/types'

const identity = (row: SocialAccountProfileStatus) => JSON.stringify([
  row.accountHandle, row.accountUrl, row.sessionPath,
])
const key = (row: Pick<SocialAccountProfileStatus, 'platform' | 'profile'>) => `${row.platform}/${row.profile}`

/** Display-only observations. Never used to authorize an agent action. */
export class SocialVerificationMemory {
  private checks = new Map<string, { identity: string; row: SocialAccountProfileStatus }>()
  private revisions = new Map<string, number>()

  invalidate(row: Pick<SocialAccountProfileStatus, 'platform' | 'profile'>): void {
    const id = key(row)
    this.checks.delete(id)
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
  }

  begin(row: SocialAccountProfileStatus): number {
    this.invalidate(row)
    return this.revisions.get(key(row))!
  }

  remember(row: SocialAccountProfileStatus, revision: number): boolean {
    if (this.revisions.get(key(row)) !== revision) return false
    if (row.liveChecked && row.lastCheckedAt) this.checks.set(key(row), { identity: identity(row), row })
    return true
  }

  merge(next: SocialAccountsDoctorResult): SocialAccountsDoctorResult {
    const rows = next.platforms.flatMap(platform => platform.profiles)
    for (const [id, check] of this.checks) {
      const row = rows.find(item => key(item) === id)
      if (!row || identity(row) !== check.identity || !row.localSessionExists) {
        this.invalidate(check.row)
      }
    }
    return { ...next, platforms: next.platforms.map(platform => ({
      ...platform,
      profiles: platform.profiles.map(row => {
        const check = this.checks.get(key(row))
        if (!check || row.liveChecked) return row
        // Fresh account metadata wins; only the previous check's observation survives.
        const observed = check.row
        return { ...row, ready: observed.ready, loggedIn: observed.loggedIn,
          matchesExpected: observed.matchesExpected, profileStatus: observed.profileStatus,
          severity: observed.severity, message: observed.message, nextAction: observed.nextAction,
          lastCheckedAt: observed.lastCheckedAt, browserInstanceId: observed.browserInstanceId }
      }),
    })) }
  }
}

// Survives Settings navigation, clears on app reload. No cookies or credentials here.
export const socialVerificationMemory = new SocialVerificationMemory()
