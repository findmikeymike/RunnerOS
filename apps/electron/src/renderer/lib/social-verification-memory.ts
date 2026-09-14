import type { SocialAccountProfileStatus, SocialAccountsDoctorResult } from '../../shared/types'

const identity = (row: SocialAccountProfileStatus) => JSON.stringify([
  row.accountHandle, row.accountUrl, row.sessionPath, row.adsAccountId ?? null,
])
const key = (row: Pick<SocialAccountProfileStatus, 'platform' | 'profile'>) => `${row.platform}/${row.profile}`

const STORAGE_KEY = 'artist-os:social-connections:v1'
type ConnectionStorage = Pick<Storage, 'getItem' | 'setItem'>

// Persist only connection metadata, never raw page text, evidence, or credentials.
function savedObservation(row: SocialAccountProfileStatus): SocialAccountProfileStatus {
  const { platform, profile, accountHandle, accountUrl, sessionPath, adsAccountId,
    ready, loggedIn, matchesExpected, profileStatus, severity, message, nextAction,
    lastCheckedAt, spotifyCapabilities } = row
  return { platform, profile, accountHandle, accountUrl, sessionPath, adsAccountId,
    ready, loggedIn, matchesExpected, profileStatus, severity, message, nextAction,
    lastCheckedAt, spotifyCapabilities } as SocialAccountProfileStatus
}

/** Display-only observations. Never used to authorize an agent action. */
export class SocialVerificationMemory {
  private checks = new Map<string, { identity: string; row: SocialAccountProfileStatus }>()
  private revisions = new Map<string, number>()

  constructor(private storage?: ConnectionStorage) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]')
      if (!Array.isArray(saved)) return
      for (const item of saved) {
        if (!item || typeof item.identity !== 'string' || !item.row
          || typeof item.row.platform !== 'string' || typeof item.row.profile !== 'string'
          || typeof item.row.ready !== 'boolean' || typeof item.row.lastCheckedAt !== 'string'
          || !Number.isFinite(Date.parse(item.row.lastCheckedAt))) continue
        const row = savedObservation(item.row)
        if (identity(row) !== item.identity) continue
        this.checks.set(key(row), { identity: item.identity, row })
      }
    } catch { /* Corrupt or unavailable storage must not block Settings. */ }
  }

  private persist(): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.checks.values()].map(check => ({
        identity: check.identity, row: savedObservation(check.row),
      }))))
    } catch {
      console.warn('[SocialConnections] Could not persist connection status')
    }
  }

  invalidate(row: Pick<SocialAccountProfileStatus, 'platform' | 'profile'>): void {
    const id = key(row)
    this.checks.delete(id)
    this.persist()
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1)
  }

  begin(row: SocialAccountProfileStatus): number {
    // Keep the last observation if a recheck is interrupted or the app closes.
    const id = key(row)
    const revision = (this.revisions.get(id) ?? 0) + 1
    this.revisions.set(id, revision)
    return revision
  }

  remember(row: SocialAccountProfileStatus, revision: number): boolean {
    if (this.revisions.get(key(row)) !== revision) return false
    if (row.liveChecked && row.lastCheckedAt) {
      this.checks.set(key(row), { identity: identity(row), row })
      this.persist()
    }
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
        if (!check || row.liveChecked || (row as SocialAccountProfileStatus & { savedVerification?: boolean }).savedVerification) return row
        // Fresh account metadata wins; only the previous check's observation survives.
        const observed = check.row
        return { ...row, ready: observed.ready, loggedIn: observed.loggedIn,
          matchesExpected: observed.matchesExpected, profileStatus: observed.profileStatus,
          severity: observed.severity, message: observed.message, nextAction: observed.nextAction,
          lastCheckedAt: observed.lastCheckedAt, browserInstanceId: observed.browserInstanceId,
          ...(observed.spotifyCapabilities ? { spotifyCapabilities: observed.spotifyCapabilities } : {}) }
      }),
    })) }
  }
}

// Electron stores this in the existing Artist OS browser-data profile across builds.
// Restored status is historical (liveChecked stays false), never action authorization.
function connectionStorage(): ConnectionStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}
export const socialVerificationMemory = new SocialVerificationMemory(connectionStorage())
