import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { IBrowserPaneManager } from '../handlers/browser-pane-manager-interface'
import { normalizeInstagramCapture } from '@craft-agent/shared/artist-context'
import { INSTAGRAM_PAGE_DATA_EXPRESSION, parseInstagramInsights, type InstagramPageData } from './instagram-page-data'

export interface InstagramPulseProfile { profile: string; handle: string; accountUrl: string }
export function selectInstagramPulseProfile(catalog: unknown): InstagramPulseProfile {
  const rows = (catalog as { profiles?: unknown } | null)?.profiles
  const found = new Map<string, InstagramPulseProfile>()
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.platform !== 'instagram' || typeof row.profile !== 'string' || !row.profile.trim()) continue
    try {
      const url = new URL(row.accountUrl)
      const handle = url.pathname.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/)?.[1]
      if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port || !handle) continue
      found.set(row.profile, { profile: row.profile, handle, accountUrl: `https://www.instagram.com/${handle}/` })
    } catch { /* A saved account identity is required. */ }
  }
  if (!found.size) throw new Error('Connect an Instagram account in Settings before running Instagram Insights.')
  if (found.size !== 1) throw new Error('Choose one Instagram account for Insights; multiple saved profiles are available.')
  return [...found.values()][0]!
}

const activeProfiles = new Set<string>()
const drainingSessions = new Set<string>()
export function isInstagramBrowserDraining(sessionId: string): boolean { return drainingSessions.has(sessionId) }

export async function collectInstagramNative(options: {
  browser: IBrowserPaneManager; sessionId: string; profile: InstagramPulseProfile;
  workspaceRoot: string; captureDir: string; isCancelled: () => boolean; onSaved: () => void;
  timeoutMs?: number; settleMs?: number; stableMs?: number; zeroWaitMs?: number; pollMs?: number;
}) {
  const { browser, sessionId, profile } = options
  if (activeProfiles.has(profile.profile)) throw new Error('This Instagram profile is still finishing another Insights refresh.')
  activeProfiles.add(profile.profile)
  const pending = new Set<Promise<unknown>>()
  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  const check = () => {
    if (options.isCancelled()) throw new Error('Instagram Insights was cancelled.')
    if (Date.now() >= deadline) throw new Error('Instagram Insights timed out before verified account data was ready. Your previous data is unchanged.')
  }
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    check()
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel: ReturnType<typeof setInterval> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(() => { check(); return work() }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Instagram Insights timed out. Your previous data is unchanged.')), Math.max(1, deadline - Date.now()))
          cancel = setInterval(() => { if (options.isCancelled()) reject(new Error('Instagram Insights was cancelled.')) }, 100)
        }),
      ])
    } finally { if (timer) clearTimeout(timer); if (cancel) clearInterval(cancel) }
  }
  const browserWork = <T>(work: () => Promise<T>) => {
    const promise = Promise.resolve().then(work)
    pending.add(promise)
    void promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  let instance: string | undefined
  let savedSnapshot: ReturnType<typeof normalizeInstagramCapture> | undefined
  try {
    check()
    instance = browser.useSocialProfileForSession(sessionId, 'instagram', profile.profile, { show: true })
    browser.setAgentControl(sessionId, { displayName: 'Instagram Insights', intent: 'Read account Insights' })
    browser.focus(instance)
    await bounded(() => browserWork(() => browser.navigate(instance!, 'https://www.instagram.com/accounts/insights/?timeframe=30')))
    const arrivedAt = Date.now()
    let signature = ''
    let stableSince = arrivedAt
    let matchingReads = 0
    let data: ReturnType<typeof parseInstagramInsights> = null
    while (true) {
      const page = await bounded(() => browserWork(() => browser.evaluate(instance!, INSTAGRAM_PAGE_DATA_EXPRESSION))) as InstagramPageData
      check()
      const url = new URL(page.url)
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.protocol !== 'https:' || !/^\/accounts\/insights\/?$/.test(url.pathname)) {
        throw new Error('Instagram did not open account Insights. Check the saved login and professional-account access in Settings.')
      }
      data = parseInstagramInsights(page, profile.handle)
      if (data) {
        const current = JSON.stringify(data)
        if (current !== signature) { signature = current; stableSince = Date.now(); matchingReads = 0 }
        matchingReads++
        const zeroOnly = data.metrics.views === 0 && data.metrics.interactions === 0
        const minimumWait = zeroOnly ? options.zeroWaitMs ?? 8_000 : options.settleMs ?? 3_000
        if (matchingReads >= 2 && Date.now() - arrivedAt >= minimumWait && Date.now() - stableSince >= (options.stableMs ?? 1_500)) break
      } else { signature = ''; matchingReads = 0 }
      await bounded(() => new Promise(resolve => setTimeout(resolve, options.pollMs ?? 750)))
    }
    check()
    const lexicalWorkspace = path.resolve(options.workspaceRoot)
    const workspace = await fs.realpath(lexicalWorkspace)
    const within = (root: string, candidate: string) => {
      const relative = path.relative(root, candidate)
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
    }
    const captureDir = path.resolve(options.captureDir)
    if (!within(lexicalWorkspace, captureDir)) throw new Error('Instagram capture folder must stay inside the workspace.')
    const snapshotDir = path.join(workspace, 'data', 'instagram', 'snapshots')
    await fs.mkdir(captureDir, { recursive: true })
    await fs.mkdir(snapshotDir, { recursive: true })
    if (!within(workspace, await fs.realpath(captureDir)) || !within(workspace, await fs.realpath(snapshotDir))) throw new Error('Instagram snapshot folders resolve outside the workspace.')
    const capture = { snapshotDate: new Date().toISOString().slice(0, 10), ...data, profile: { ...profile, handle: `@${profile.handle}` }, partial: false, errors: [] }
    const snapshot = normalizeInstagramCapture(capture)
    check()
    await fs.writeFile(path.join(captureDir, `instagram-capture-${randomUUID()}.json`), JSON.stringify(capture, null, 2) + '\n', { flag: 'wx' })
    check()
    await fs.writeFile(path.join(snapshotDir, `${snapshot.snapshotDate}-insights-${randomUUID()}.json`), JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx' })
    check()
    options.onSaved()
    savedSnapshot = snapshot
  } finally {
    const cleanup = async () => {
      if (instance) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([browser.clearVisualsForSession(sessionId), new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Browser cleanup timed out')), 1000) })])
        } catch { try { browser.clearAgentControl(sessionId) } catch { /* Window closed. */ } }
        finally { if (timer) clearTimeout(timer) }
        try { browser.unbindAllForSession(sessionId) } catch { /* Window closed. */ }
      }
      activeProfiles.delete(profile.profile)
      drainingSessions.delete(sessionId)
    }
    if (pending.size) { drainingSessions.add(sessionId); void Promise.allSettled([...pending]).then(cleanup) }
    else await cleanup()
  }
  if (options.isCancelled()) throw new Error('Instagram Insights was cancelled.')
  return savedSnapshot!
}
