import fs from 'node:fs'
import path from 'node:path'

type Row = Record<string, any>
const id = (row: Row) => `${row.platform}/${row.profile}`
const identity = (row: Row) => JSON.stringify([row.accountHandle ?? null, row.accountUrl ?? null, row.sessionPath ?? null, row.adsAccountId ?? null])
const fields = ['platform', 'profile', 'accountHandle', 'accountUrl', 'sessionPath', 'adsAccountId', 'ready', 'loggedIn', 'matchesExpected', 'profileStatus', 'severity', 'message', 'nextAction', 'lastCheckedAt'] as const

/** Explicit whitelist: never persist browser evidence, raw page text, cookies or credentials. */
export function socialConnectionObservation(row: Row): Row {
  const result: Row = {}
  for (const field of fields) if (['string', 'boolean'].includes(typeof row[field]) || row[field] === null) result[field] = row[field]
  if (row.spotifyCapabilities) {
    result.spotifyCapabilities = {}
    for (const surface of ['artists', 'webPlayer', 'adsManager']) {
      const capability = row.spotifyCapabilities[surface]
      if (!capability || typeof capability.ready !== 'boolean') continue
      result.spotifyCapabilities[surface] = {}
      for (const field of ['ready', 'status', 'label', 'message', 'accountUrl', 'accountId']) {
        if (['string', 'boolean'].includes(typeof capability[field]) || capability[field] === null) result.spotifyCapabilities[surface][field] = capability[field]
      }
    }
  }
  return result
}

/** Historical UI observations, never authorization or a substitute for a fresh check. */
export class SocialConnectionObservations {
  private revisions = new Map<string, number>()
  constructor(private filePath: string) {}
  private read(): Record<string, Row> {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
      return Object.fromEntries(Object.entries(data).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => [key, socialConnectionObservation(value as Row)]))
    } catch { return {} }
  }
  private write(rows: Record<string, Row>): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temporary = `${this.filePath}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(rows), { mode: 0o600 })
    fs.renameSync(temporary, this.filePath)
  }
  begin(row: Row): number {
    const revision = (this.revisions.get(id(row)) ?? 0) + 1
    this.revisions.set(id(row), revision)
    return revision
  }
  invalidate(row: Row): void {
    this.begin(row)
    const saved = this.read()
    if (saved[id(row)]) { delete saved[id(row)]; this.write(saved) }
  }
  remember(row: Row, revision: number, spotifySurface?: string): Row {
    if (this.revisions.get(id(row)) !== revision || !row.liveChecked || row.localSessionExists === false || !Number.isFinite(Date.parse(row.lastCheckedAt))) return row
    const saved = this.read()
    const prior = saved[id(row)]
    // A first successful check may discover a previously unspecified account identity.
    const compatible = prior && ['accountHandle', 'accountUrl', 'sessionPath', 'adsAccountId'].every(field => !prior[field] || prior[field] === row[field])
    let result = { ...row }
    if (spotifySurface && compatible && prior.spotifyCapabilities) {
      const surface = spotifySurface === 'artists' ? 'artists' : spotifySurface === 'web-player' ? 'webPlayer' : 'adsManager'
      result.spotifyCapabilities = { ...prior.spotifyCapabilities, ...row.spotifyCapabilities, ...Object.fromEntries(Object.entries(prior.spotifyCapabilities).filter(([key]) => key !== surface)) }
      const capabilities = result.spotifyCapabilities
      result.ready = Boolean(capabilities.artists?.ready && capabilities.webPlayer?.ready)
      result.loggedIn = result.ready
      const wrongAccount = Object.values(capabilities).some((value: any) => value.status === 'wrong_account')
      if (wrongAccount) result.ready = false
      result.profileStatus = wrongAccount ? 'wrong_account' : result.ready ? 'verified' : Object.values(capabilities).some((value: any) => value.ready) ? 'partial' : row.profileStatus
      result.severity = wrongAccount ? 'error' : result.ready ? 'info' : 'warning'
      result.message = Object.values(capabilities).map((value: any) => value.message).filter(Boolean).join(' ')
      result.nextAction = wrongAccount ? 'select_expected_account' : result.ready ? 'none' : row.nextAction
    }
    saved[id(row)] = socialConnectionObservation(result)
    this.write(saved)
    return result
  }
  merge(row: Row): Row {
    const observed = this.read()[id(row)]
    if (!observed || !row.localSessionExists || identity(row) !== identity(observed)) return row
    return { ...row, ...observed, liveChecked: false, savedVerification: true }
  }
}
