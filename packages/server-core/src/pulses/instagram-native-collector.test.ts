import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IBrowserPaneManager } from '../handlers/browser-pane-manager-interface'
import type { InstagramPageData } from './instagram-page-data'
import { collectInstagramNative, isInstagramBrowserDraining, selectInstagramPulseProfile } from './instagram-native-collector'

const url = 'https://www.instagram.com/accounts/insights/?timeframe=30'
function page(metrics = { followers: 10815, views: 800, interactions: 19 }): InstagramPageData {
  return {
    url,
    text: `Professional dashboard\nLast 30 days\nAccount insights\nViews\nInfo\n${metrics.views}\nFollowers\n26.5%\nNon-followers\n73.5%\nViewers\n173\nInteractions\nInfo\n${metrics.interactions}\nAccounts engaged\n18\nProfile visits\n275\nFollowers\nInfo\n${metrics.followers}\nTotal followers`,
    headings: ['Views', String(metrics.views), 'Interactions', String(metrics.interactions), 'Followers', String(metrics.followers)].map(text => ({ text, level: 2 })),
    anchors: [{ href: 'https://www.instagram.com/findmikeymike/', imageAlt: "findmikeymike's profile picture" }],
  }
}
async function fixture() {
  const workspaceRoot = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'instagram-native-')))
  const events: string[] = []
  let cancelled = false
  const browser = {
    useSocialProfileForSession: (_session: string, platform: string, _profile: string, options: unknown) => { events.push(`${platform}:${JSON.stringify(options)}`); return 'browser' },
    setAgentControl: () => {}, focus: () => {}, clearAgentControl: () => {},
    clearVisualsForSession: async () => { events.push('clear') }, unbindAllForSession: () => { events.push('unbind') },
    navigate: async (_id: string, target: string) => { events.push(target); return { url: target, title: '' } },
    evaluate: async (): Promise<InstagramPageData> => page(),
  }
  const options = {
    browser: browser as unknown as IBrowserPaneManager, sessionId: randomUUID(),
    profile: { profile: randomUUID(), handle: 'findmikeymike', accountUrl: 'https://www.instagram.com/findmikeymike/' },
    workspaceRoot, captureDir: path.join(workspaceRoot, 'sessions', 'session', 'data'),
    timeoutMs: 100, settleMs: 0, stableMs: 0, zeroWaitMs: 0, pollMs: 1,
    isCancelled: () => cancelled, onSaved: () => { events.push('saved') },
  }
  const snapshots = async () => fs.readdir(path.join(workspaceRoot, 'data', 'instagram', 'snapshots')).catch(() => [])
  return { options, browser, events, snapshots, cancel: () => { cancelled = true } }
}

describe('native Instagram collector', () => {
  test('normalizes observed account data and publishes with isolated visible browser', async () => {
    const f = await fixture()
    const snapshot = await collectInstagramNative(f.options)
    expect(snapshot.metrics).toMatchObject({ followers: 10815, views: 800, interactions: 19, accountsEngaged: 18, profileVisits: 275 })
    expect(snapshot.metrics.accountsReached).toBeNull()
    expect(f.events[0]).toBe('instagram:{"show":true}')
    expect(f.events).toContain(url)
    expect(await f.snapshots()).toHaveLength(1)
    expect(f.events.slice(-3)).toEqual(['saved', 'clear', 'unbind'])
  })
  test('waits through zero and changing placeholders until rendered values stabilize', async () => {
    const f = await fixture()
    f.options.timeoutMs = 1_000
    f.options.settleMs = 12
    f.options.stableMs = 5
    f.options.zeroWaitMs = 30
    let reads = 0
    f.browser.evaluate = async () => {
      reads++
      // Repeated interim values can legitimately settle when suite load slows
      // polling. Keep hydration samples changing until the final page arrives.
      return reads === 1 ? page({ followers: 0, views: 0, interactions: 0 })
        : reads <= 7 ? page({ followers: 10815, views: reads, interactions: 0 }) : page()
    }
    const snapshot = await collectInstagramNative(f.options)
    expect(reads).toBeGreaterThanOrEqual(9)
    expect(snapshot.metrics.views).toBe(800)
    expect(snapshot.metrics.interactions).toBe(19)
  })
  test('zero activity gets the longer hydration wait even when followers have already loaded', async () => {
    const f = await fixture()
    f.options.zeroWaitMs = 30
    let firstRead = 0
    f.browser.evaluate = async () => {
      firstRead ||= Date.now()
      return Date.now() - firstRead < 12 ? page({ followers: 10815, views: 0, interactions: 0 }) : page()
    }
    const snapshot = await collectInstagramNative(f.options)
    expect(snapshot.metrics.followers).toBe(10815)
    expect(snapshot.metrics.views).toBe(800)
    expect(snapshot.metrics.interactions).toBe(19)
  })
  test('genuine zero activity remains valid after the longer hydration wait', async () => {
    const f = await fixture()
    f.options.zeroWaitMs = 20
    let firstRead = 0
    let savedAt = 0
    f.browser.evaluate = async () => {
      firstRead ||= Date.now()
      return page({ followers: 10815, views: 0, interactions: 0 })
    }
    f.options.onSaved = () => { savedAt = Date.now() }
    const snapshot = await collectInstagramNative(f.options)
    expect(savedAt - firstRead).toBeGreaterThanOrEqual(19)
    expect(snapshot.metrics.views).toBe(0)
    expect(snapshot.metrics.interactions).toBe(0)
  })
  test('wrong visible account never saves a snapshot', async () => {
    const f = await fixture()
    f.options.timeoutMs = 20
    f.browser.evaluate = async () => ({ ...page(), anchors: [{ href: 'https://www.instagram.com/wronguser/', imageAlt: "wronguser's profile picture" }] })
    await expect(collectInstagramNative(f.options)).rejects.toThrow('timed out')
    expect(await f.snapshots()).toHaveLength(0)
    expect(f.events).not.toContain('saved')
  })
  test('accepts a consistent symlinked workspace spelling while validating real containment', async () => {
    const f = await fixture()
    const aliasParent = await fs.mkdtemp(path.join(tmpdir(), 'instagram-alias-'))
    const alias = path.join(aliasParent, 'workspace')
    await fs.symlink(f.options.workspaceRoot, alias)
    f.options.workspaceRoot = alias
    f.options.captureDir = path.join(alias, 'sessions', 'session', 'data')
    const snapshot = await collectInstagramNative(f.options)
    expect(snapshot.metrics.views).toBe(800)
  })
  test('same-day runs append unique snapshots without replacing the earlier file', async () => {
    const f = await fixture()
    await collectInstagramNative(f.options)
    const [first] = await f.snapshots()
    const firstPath = path.join(f.options.workspaceRoot, 'data', 'instagram', 'snapshots', first!)
    const original = await fs.readFile(firstPath, 'utf8')
    f.browser.evaluate = async () => page({ followers: 10816, views: 810, interactions: 20 })
    await collectInstagramNative(f.options)
    expect(await f.snapshots()).toHaveLength(2)
    expect(await fs.readFile(firstPath, 'utf8')).toBe(original)
  })
  test('cancellation during a read saves nothing and detaches the session', async () => {
    const f = await fixture()
    f.browser.evaluate = async () => { f.cancel(); return page() }
    await expect(collectInstagramNative(f.options)).rejects.toThrow('cancelled')
    expect(await f.snapshots()).toHaveLength(0)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('publication errors propagate instead of declaring the widget updated', async () => {
    const f = await fixture()
    f.options.onSaved = () => { throw new Error('publication failed') }
    await expect(collectInstagramNative(f.options)).rejects.toThrow('publication failed')
    expect(await f.snapshots()).toHaveLength(1)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('retains browser ownership and blocks a second run until timed-out navigation settles', async () => {
    const f = await fixture()
    f.options.timeoutMs = 20
    let release!: (value: { url: string; title: string }) => void
    f.browser.navigate = () => new Promise(resolve => { release = resolve })
    await expect(collectInstagramNative(f.options)).rejects.toThrow('timed out')
    expect(isInstagramBrowserDraining(f.options.sessionId)).toBe(true)
    expect(f.events).not.toContain('unbind')
    await expect(collectInstagramNative(f.options)).rejects.toThrow('still finishing')
    release({ url, title: '' })
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(isInstagramBrowserDraining(f.options.sessionId)).toBe(false)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('cancellation during final cleanup cannot report success', async () => {
    const f = await fixture()
    f.browser.clearVisualsForSession = async () => { f.cancel() }
    await expect(collectInstagramNative(f.options)).rejects.toThrow('cancelled')
    expect(await f.snapshots()).toHaveLength(1)
  })
  test('selects a single verified account and rejects ambiguity or unsafe identities', () => {
    expect(selectInstagramPulseProfile({ profiles: [{ platform: 'instagram', profile: 'main', accountUrl: 'https://www.instagram.com/findmikeymike/' }] }).handle).toBe('findmikeymike')
    expect(() => selectInstagramPulseProfile({ profiles: [{ platform: 'instagram', profile: 'main', accountUrl: 'https://evil.test/findmikeymike/' }] })).toThrow('Connect')
    expect(() => selectInstagramPulseProfile({ profiles: ['first', 'second'].map(profile => ({ platform: 'instagram', profile, accountUrl: 'https://www.instagram.com/findmikeymike/' })) })).toThrow('multiple')
  })
})
