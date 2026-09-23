import { describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IBrowserPaneManager } from '../handlers/browser-pane-manager-interface'
import type { SpotifyPageData } from './spotify-page-data'
import { collectSpotifyNative, isSpotifyBrowserDraining } from './spotify-native-collector'

const artistId = '1234567890123456789012'
const homeText = 'Last 28 days\nMonthly listeners\n81,259\nStreams\n179,642'
async function fixture() {
  const workspaceRoot = await fs.mkdtemp(path.join(tmpdir(), 'spotify-native-'))
  const events: string[] = []
  const captures: any[] = []
  let currentUrl = ''
  let cancelled = false
  const browser = {
    useSocialProfileForSession: (_session: string, platform: string, profile: string, options: unknown) => { events.push(`profile:${platform}:${JSON.stringify(options)}`); return 'browser' },
    setAgentControl: () => {}, focus: () => {}, clearAgentControl: () => {},
    clearVisualsForSession: async () => { events.push('clear') },
    unbindAllForSession: () => { events.push('unbind') },
    navigate: async (_id: string, url: string) => { currentUrl = url; events.push(url); return { url, title: '' } },
    evaluate: async (): Promise<SpotifyPageData> => {
      if (currentUrl.endsWith('/home')) return { url: currentUrl, text: homeText }
      if (currentUrl.endsWith('/location')) return { url: currentUrl, text: 'Last 28 days', tables: [{ headers: ['Country', 'Listeners'], rows: [['United States', '39,050']] }, { headers: ['City', 'Listeners'], rows: [['London\nUnited Kingdom', '1,317']] }] }
      return { url: currentUrl, text: 'Songs\n28 days', selectedWindowText: '28 days', tables: [{ headers: ['Title', 'Streams'], rows: [['Homebody', '1,200']] }] }
    },
  }
  const options = {
    browser: browser as unknown as IBrowserPaneManager, sessionId: 'session', artistId, profile: randomUUID(), workspaceRoot,
    captureDir: path.join(workspaceRoot, 'sessions', 'session', 'data'), pollMs: 1, pageTimeoutMs: 30, timeoutMs: 500, settleMs: 0, stableMs: 0, zeroSettleMs: 0,
    runSocialJson: async (args: string[]) => { captures.push(JSON.parse(await fs.readFile(args[args.indexOf('--capture-file') + 1]!, 'utf8'))); events.push('normalize'); return { ok: true, status: 'succeeded' } },
    isCancelled: () => cancelled, onSaved: () => { events.push('saved') },
  }
  return { options, browser, events, captures, cancel: () => { cancelled = true } }
}

describe('native Spotify collector', () => {
  test('normalizes and publishes exact core before bounded enrichment; preserves identity and core', async () => {
    const f = await fixture()
    // This checks content/order, not timeout behavior. Allow loaded suite runs
    // to schedule the fixture without exhausting its 30 ms default page budget.
    f.options.pageTimeoutMs = 1_000
    f.options.timeoutMs = 3_000
    const result = await collectSpotifyNative(f.options)
    expect(result).toMatchObject({ streams: 179642, listeners: 81259, windowDays: 28, countries: 1, tracks: 1, snapshotsSaved: 2, partial: false })
    expect(f.events[0]).toBe('profile:spotify:{"show":true}')
    expect(f.events.indexOf('saved')).toBeLessThan(f.events.findIndex(event => event.endsWith('/audience/location')))
    expect(f.captures[0].artist.spotifyUrl).toBe(`https://open.spotify.com/artist/${artistId}`)
    expect(f.captures[1].streams).toBe(f.captures[0].streams)
    expect(f.captures[1].topTracks).toEqual([{ name: 'Homebody', streams: 1200 }])
    expect(f.events.slice(-2)).toEqual(['clear', 'unbind'])
  })
  test.each([1, 10])('waits for changing Home placeholders and persists only stable hydrated counts (poll %d ms)', async (pollMs) => {
    const f = await fixture()
    f.options.pollMs = pollMs
    f.options.settleMs = 12
    f.options.stableMs = 5
    f.options.zeroSettleMs = 25
    f.options.pageTimeoutMs = 1_000
    f.options.timeoutMs = 3_000
    const evaluate = f.browser.evaluate
    let homeReads = 0
    f.browser.evaluate = async () => {
      const data = await evaluate()
      if (!data.url.endsWith('/home')) return data
      homeReads++
      if (homeReads === 1) return { ...data, text: 'Last 28 days\nMonthly listeners\n0\nStreams\n0' }
      // Provisional counts must change on every sample. Repeating an interim
      // value can legitimately satisfy stableMs when a busy runner polls slowly.
      if (homeReads <= 7) return { ...data, text: `Last 28 days\nMonthly listeners\n81,259\nStreams\n${100 + homeReads}` }
      return data
    }
    await collectSpotifyNative(f.options)
    expect(homeReads).toBeGreaterThanOrEqual(9)
    expect(f.captures[0].streams).toBe(179642)
    expect(f.captures[0].listeners).toBe(81259)
  })
  test('allows real zero metrics after their longer stable wait', async () => {
    const f = await fixture()
    f.options.settleMs = 2
    f.options.stableMs = 2
    f.options.zeroSettleMs = 15
    f.options.pageTimeoutMs = 80
    const evaluate = f.browser.evaluate
    let firstHomeRead = 0
    let firstSave = 0
    f.browser.evaluate = async () => {
      const data = await evaluate()
      if (!data.url.endsWith('/home')) return data
      firstHomeRead ||= Date.now()
      return { ...data, text: 'Last 28 days\nMonthly listeners\n0\nStreams\n0' }
    }
    f.options.onSaved = () => { firstSave ||= Date.now() }
    await collectSpotifyNative(f.options)
    expect(firstSave - firstHomeRead).toBeGreaterThanOrEqual(14)
    expect(f.captures[0].streams).toBe(0)
    expect(f.captures[0].listeners).toBe(0)
  })
  test('waits for both Location tables instead of saving the first countries-only response', async () => {
    const f = await fixture()
    // This asserts hydration and two matching reads, not the timeout fallback.
    // The 30 ms fixture budget can expire between reads on a loaded suite runner.
    f.options.pageTimeoutMs = 1_000
    f.options.timeoutMs = 3_000
    const evaluate = f.browser.evaluate
    let locationReads = 0
    f.browser.evaluate = async () => {
      const data = await evaluate()
      if (!data.url.endsWith('/location')) return data
      locationReads++
      return locationReads < 4 ? { ...data, tables: data.tables!.slice(0, 1) } : data
    }
    const result = await collectSpotifyNative(f.options)
    expect(locationReads).toBeGreaterThanOrEqual(5)
    expect(result.cities).toBe(1)
    expect(result.countries).toBe(1)
    expect(result.partial).toBe(false)
  })
  test('retains stable partial Location rows only when its bounded wait expires', async () => {
    const f = await fixture()
    const evaluate = f.browser.evaluate
    f.browser.evaluate = async () => {
      const data = await evaluate()
      return data.url.endsWith('/location') ? { ...data, tables: data.tables!.slice(0, 1) } : data
    }
    const result = await collectSpotifyNative(f.options)
    expect(result).toMatchObject({ countries: 1, cities: 0, tracks: 1, partial: true, snapshotsSaved: 2 })
    expect(result.warnings.join(' ')).toContain('retained the stable visible rows')
  })
  test('wrong artist redirect never produces a capture and detaches browser', async () => {
    const f = await fixture()
    f.browser.evaluate = async () => ({ url: 'https://artists.spotify.com/c/artist/other/home', text: homeText })
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('verified artist page')
    expect(f.captures).toHaveLength(0)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('empty or rounded Home fails within the page budget without saving', async () => {
    const f = await fixture()
    f.browser.evaluate = async () => ({ url: `https://artists.spotify.com/c/artist/${artistId}/home`, text: homeText.replace('179,642', '180K') })
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('timed out')
    expect(f.captures).toHaveLength(0)
  })
  test('cancel after core preserves saved data and performs no secondary navigation', async () => {
    const f = await fixture()
    f.options.onSaved = f.cancel
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('cancelled')
    expect(f.captures).toHaveLength(1)
    expect(f.events.some(event => event.endsWith('/location'))).toBe(false)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('cancellation during browser cleanup cannot report a successful run', async () => {
    const f = await fixture()
    f.browser.clearVisualsForSession = async () => {
      f.events.push('clear')
      f.cancel()
    }
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('cancelled')
    expect(f.captures).toHaveLength(2)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('cancellation on Songs without any enrichment retains core but rejects the run', async () => {
    const f = await fixture()
    const evaluate = f.browser.evaluate
    f.browser.evaluate = async () => {
      const data = await evaluate()
      if (data.url.endsWith('/home')) return data
      if (data.url.endsWith('/songs')) f.cancel()
      return { ...data, text: 'Last 7 days', selectedWindowText: '7 days', tables: [] }
    }
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('cancelled')
    expect(f.captures).toHaveLength(1)
    expect(f.captures[0].streams).toBe(179642)
    expect(f.events.filter(event => event === 'saved')).toHaveLength(1)
    expect(f.events.some(event => event.endsWith('/music/songs'))).toBe(true)
    expect(f.events.at(-1)).toBe('unbind')
  })
  test('mismatched secondary windows keep core and never write an incorrect enriched snapshot', async () => {
    const f = await fixture()
    const evaluate = f.browser.evaluate
    f.browser.evaluate = async () => {
      const data = await evaluate()
      return data.url.endsWith('/home') ? data : { ...data, text: 'Last 7 days', selectedWindowText: '7 days' }
    }
    const result = await collectSpotifyNative(f.options)
    expect(result.snapshotsSaved).toBe(1)
    expect(result.partial).toBe(true)
    expect(result.tracks).toBe(0)
    expect(f.captures).toHaveLength(1)
  })
  test('holds the profile lease while a timed-out browser operation is still pending', async () => {
    const f = await fixture()
    let release!: (value: { url: string; title: string }) => void
    f.browser.navigate = () => new Promise(resolve => { release = resolve })
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('timed out')
    expect(isSpotifyBrowserDraining(f.options.sessionId)).toBe(true)
    expect(f.events).not.toContain('unbind')
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('still in use')
    release({ url: '', title: '' })
    await new Promise(resolve => setTimeout(resolve, 1))
    expect(isSpotifyBrowserDraining(f.options.sessionId)).toBe(false)
    f.cancel()
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('cancelled')
  })
  test('reports only durable core if enriched normalization fails', async () => {
    const f = await fixture()
    const normalize = f.options.runSocialJson
    let calls = 0
    f.options.runSocialJson = async args => {
      if (++calls === 2) throw new Error('normalizer failed')
      return normalize(args)
    }
    const result = await collectSpotifyNative(f.options)
    expect(result).toMatchObject({ snapshotsSaved: 1, countries: 0, cities: 0, tracks: 0, partial: true })
  })
  test('publication failure cannot report a successful widget update', async () => {
    const f = await fixture()
    f.options.onSaved = () => { throw new Error('context publication failed') }
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('context publication failed')
  })
  test('failed normalization does not claim a saved snapshot', async () => {
    const f = await fixture()
    f.options.runSocialJson = async () => ({ ok: false, status: 'failed' })
    await expect(collectSpotifyNative(f.options)).rejects.toThrow('normalization did not succeed')
    expect(f.events).not.toContain('saved')
  })
})
