import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IBrowserPaneManager } from '../handlers/browser-pane-manager-interface'
import { SPOTIFY_PAGE_DATA_EXPRESSION, parseSpotifyHome, parseSpotifyLocation, parseSpotifySongs, type SpotifyPageData, type SpotifyHomeMetrics, type SpotifyLocationMetrics, type SpotifySongMetrics } from './spotify-page-data'

export interface SpotifyNativeCollectorOptions {
  browser: IBrowserPaneManager
  sessionId: string
  artistId: string
  profile: string
  workspaceRoot: string
  captureDir: string
  runSocialJson: (args: string[]) => Promise<unknown>
  isCancelled: () => boolean
  onSaved: () => void
  timeoutMs?: number
  pageTimeoutMs?: number
  pollMs?: number
  settleMs?: number
  stableMs?: number
  zeroSettleMs?: number
}
export interface SpotifyNativeCollectorResult extends SpotifyHomeMetrics {
  countries: number
  cities: number
  tracks: number
  partial: boolean
  snapshotsSaved: number
  warnings: string[]
}

class SpotifyPageTimeout extends Error {}

const activeProfiles = new Map<string, Set<Promise<unknown>>>()
const drainingSessions = new Set<string>()

export function isSpotifyBrowserDraining(sessionId: string): boolean { return drainingSessions.has(sessionId) }

/** Deterministic read-only collection; core is durable before secondary pages. */
export async function collectSpotifyNative(options: SpotifyNativeCollectorOptions): Promise<SpotifyNativeCollectorResult> {
  const { browser, sessionId } = options
  if (!/^[a-zA-Z0-9]{22}$/.test(options.artistId)) throw new Error('Spotify Pulse needs a verified Spotify artist ID.')
  if (activeProfiles.has(options.profile)) throw new Error('Spotify profile is still in use by another Pulse collection.')
  const browserOperations = new Set<Promise<unknown>>()
  activeProfiles.set(options.profile, browserOperations)
  const deadline = Date.now() + (options.timeoutMs ?? 110_000)
  const pageTimeoutMs = options.pageTimeoutMs ?? 20_000
  const pollMs = options.pollMs ?? 750
  const settleMs = options.settleMs ?? 3_000
  const stableMs = options.stableMs ?? 1_500
  const zeroSettleMs = options.zeroSettleMs ?? 8_000
  let snapshotsSaved = 0
  let home: SpotifyHomeMetrics | null = null
  let location: SpotifyLocationMetrics = { topCountries: [], topCities: [] }
  let songs: SpotifySongMetrics = { topTracks: [] }
  let savedLocation: SpotifyLocationMetrics = location
  let savedSongs: SpotifySongMetrics = songs
  let publicationFailed = false
  const warnings: string[] = []
  let instanceId: string | undefined

  const check = () => {
    if (options.isCancelled()) throw new Error('Spotify Pulse was cancelled.')
    if (Date.now() >= deadline) throw new Error('Spotify Pulse reached its collection deadline.')
  }
  const bounded = async <T>(work: () => Promise<T>, until: number, label: string): Promise<T> => {
    check()
    const remaining = Math.min(until, deadline) - Date.now()
    if (remaining <= 0) throw new SpotifyPageTimeout(`${label} timed out.`)
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancellation: ReturnType<typeof setInterval> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(() => { check(); return work() }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new SpotifyPageTimeout(`${label} timed out.`)), remaining)
          cancellation = setInterval(() => {
            if (options.isCancelled()) reject(new Error('Spotify Pulse was cancelled.'))
          }, Math.min(100, remaining))
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
      if (cancellation) clearInterval(cancellation)
    }
  }
  const browserWork = <T>(work: () => Promise<T>): Promise<T> => {
    const pending = Promise.resolve().then(work)
    browserOperations.add(pending)
    void pending.then(() => browserOperations.delete(pending), () => browserOperations.delete(pending))
    return pending
  }
  const readPage = async <T>(route: string, parse: (data: SpotifyPageData) => T | null, readiness: {
    complete?: (value: T) => boolean
    minimumWait?: (value: T) => number
  } = {}): Promise<T> => {
    check()
    if (browserOperations.size) throw new Error('Spotify browser operation is still finishing; stopping this collection.')
    const expected = `https://artists.spotify.com/c/artist/${options.artistId}/${route}`
    const pageDeadline = Math.min(deadline, Date.now() + pageTimeoutMs)
    await bounded(() => browserWork(() => browser.navigate(instanceId!, expected)), pageDeadline, `Spotify ${route}`)
    const renderedSince = Date.now()
    let latest: T | null = null
    let signature: string | undefined
    let unchangedSince = Date.now()
    let matchingReads = 0
    const stable = () => latest !== null && matchingReads >= 2
      && Date.now() - renderedSince >= Math.max(settleMs, readiness.minimumWait?.(latest) ?? 0)
      && Date.now() - unchangedSince >= stableMs
    try {
      while (true) {
        check()
        const raw = await bounded(() => browserWork(() => browser.evaluate(instanceId!, SPOTIFY_PAGE_DATA_EXPRESSION)), pageDeadline, `Spotify ${route}`)
        check()
        const data = raw as SpotifyPageData
        if (!data || typeof data.url !== 'string' || typeof data.text !== 'string') throw new Error('Spotify returned unreadable page content.')
        const observed = new URL(data.url)
        if (observed.origin !== 'https://artists.spotify.com' || observed.pathname.replace(/\/$/, '') !== new URL(expected).pathname) {
          throw new Error('Spotify is not showing the verified artist page. Check Spotify for Artists access.')
        }
        const result = parse(data)
        if (result !== null) {
          const nextSignature = JSON.stringify(result)
          if (nextSignature !== signature) { signature = nextSignature; unchangedSince = Date.now(); matchingReads = 0 }
          matchingReads++
          latest = result
          if (stable() && (readiness.complete?.(result) ?? true)) return result
        } else {
          latest = null
          signature = undefined
          matchingReads = 0
        }
        await bounded(() => new Promise(resolve => setTimeout(resolve, pollMs)), pageDeadline, `Spotify ${route}`)
      }
    } catch (error) {
      if (error instanceof SpotifyPageTimeout && !options.isCancelled() && stable()
        && readiness.complete && latest !== null && !readiness.complete(latest)) {
        warnings.push(`Spotify ${route} loaded only part of its breakdown; retained the stable visible rows.`)
        return latest
      }
      throw error
    }
  }
  const save = async () => {
    check()
    const workspace = path.resolve(options.workspaceRoot)
    const captureDir = path.resolve(options.captureDir)
    const within = (root: string, child: string) => {
      const relative = path.relative(root, child)
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    }
    if (!within(workspace, captureDir)) throw new Error('Spotify capture folder must be inside the workspace.')
    await bounded(() => fs.mkdir(captureDir, { recursive: true }), deadline, 'Spotify capture directory')
    const [realWorkspace, realCaptureDir] = await bounded(() => Promise.all([fs.realpath(workspace), fs.realpath(captureDir)]), deadline, 'Spotify capture directory')
    if (!within(realWorkspace, realCaptureDir)) throw new Error('Spotify capture folder resolves outside the workspace.')
    const capturePath = path.join(captureDir, `spotify-capture-${randomUUID()}.json`)
    const capture = { snapshotDate: new Date().toISOString().slice(0, 10), ...home!, ...location, ...songs, artist: { spotifyUrl: `https://open.spotify.com/artist/${options.artistId}` }, capturedAt: new Date().toISOString() }
    await bounded(() => fs.writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' }), deadline, 'Spotify capture save')
    const result = await bounded(() => options.runSocialJson(['snapshot', 'spotify', '--profile', options.profile, '--capture-file', capturePath, '--workspace', workspace, '--json']), deadline, 'Spotify snapshot normalization')
    check()
    if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || !('status' in result) || result.status !== 'succeeded') {
      throw new Error('Spotify snapshot normalization did not succeed.')
    }
    try { options.onSaved() }
    catch (error) { publicationFailed = true; throw error }
    snapshotsSaved++
    savedLocation = location
    savedSongs = songs
  }

  try {
    check()
    instanceId = browser.useSocialProfileForSession(sessionId, 'spotify', options.profile, { show: true })
    browser.setAgentControl(sessionId, { displayName: 'Spotify Pulse', intent: 'Read Spotify for Artists stats' })
    browser.focus(instanceId)
    home = await readPage('home', parseSpotifyHome, { minimumWait: value => value.streams === 0 && value.listeners === 0 ? zeroSettleMs : settleMs })
    await save()
    // Each secondary page gets one bounded visit. No pagination or date switching.
    try {
      location = await readPage('audience/location', data => {
        const result = parseSpotifyLocation(data, home!.windowDays)
        return result.topCountries.length || result.topCities.length ? result : null
      }, { complete: value => value.topCountries.length > 0 && value.topCities.length > 0 })
    } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)) }
    check()
    if (browserOperations.size) throw new Error('Spotify browser operation is still finishing; saved core is unchanged.')
    try {
      songs = await readPage('music/songs', data => {
        const result = parseSpotifySongs(data, home!.windowDays)
        return result.topTracks.length ? result : null
      })
    } catch (error) { warnings.push(error instanceof Error ? error.message : String(error)) }
    if (location.topCountries.length || location.topCities.length || songs.topTracks.length) await save()
  } catch (error) {
    if (options.isCancelled() || publicationFailed || !snapshotsSaved || !home) throw error
    warnings.push(error instanceof Error ? error.message : String(error))
  } finally {
    const cleanup = async () => {
      if (instanceId) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            browser.clearVisualsForSession(sessionId),
            new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Spotify browser cleanup timed out.')), 1_000) }),
          ])
        } catch { try { browser.clearAgentControl(sessionId) } catch { /* Browser may already be detached. */ } }
        finally { if (timer) clearTimeout(timer) }
        try { browser.unbindAllForSession(sessionId) } catch { /* Preserve the saved result if the window closed. */ }
      }
      if (activeProfiles.get(options.profile) === browserOperations) activeProfiles.delete(options.profile)
      drainingSessions.delete(sessionId)
    }
    // Retain profile lease and binding until any timed-out Electron operation
    // settles. A new native collection cannot overlap the pending read.
    if (browserOperations.size) {
      drainingSessions.add(sessionId)
      void Promise.allSettled([...browserOperations]).then(cleanup)
    } else await cleanup()
  }
  if (options.isCancelled()) throw new Error('Spotify Pulse was cancelled.')
  return { ...home!, countries: savedLocation.topCountries.length, cities: savedLocation.topCities.length, tracks: savedSongs.topTracks.length, partial: warnings.length > 0, snapshotsSaved, warnings }
}
