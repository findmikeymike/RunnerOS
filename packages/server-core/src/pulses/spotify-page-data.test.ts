import { describe, expect, test } from 'bun:test'
import { SPOTIFY_PAGE_DATA_EXPRESSION, parseExactSpotifyCount, parseSpotifyHome, parseSpotifyLocation, parseSpotifySongs, type SpotifyPageData } from './spotify-page-data'

const url = 'https://artists.spotify.com/c/artist/artist-id/home'
const homeText = 'Streaming stats\nLast 28 days\nMonthly listeners\n81,259\n-0.5%\nStreams\n179,642\n-0.5%\nAudience development'

describe('Spotify rendered page extraction', () => {
  test('reads exact live Home card values without treating movement percentages as metrics', () => {
    expect(parseSpotifyHome({ url, text: homeText })).toEqual({ streams: 179642, listeners: 81259, windowDays: 28 })
  })
  test('refuses rounded, missing, ambiguous, and wrong-site core data', () => {
    expect(parseSpotifyHome({ url, text: homeText.replace('179,642', '180K') })).toBeNull()
    expect(parseSpotifyHome({ url, text: homeText.replace('81,259', '') })).toBeNull()
    expect(parseSpotifyHome({ url, text: homeText.replace('Audience development', 'Streams\n100\nAudience development') })).toBeNull()
    expect(parseSpotifyHome({ url, text: homeText.replace('Audience development', 'Last 7 days\nAudience development') })).toBeNull()
    expect(parseSpotifyHome({ url: 'https://open.spotify.com', text: homeText })).toBeNull()
  })
  test('scopes Home stats independently of unrelated seven-day widgets', () => {
    const text = homeText + '\nYour top songs\nStreams\nLast 7 days\n123\nYour top playlists\nStreams\nLast 7 days\n456'
    expect(parseSpotifyHome({ url, text })).toEqual({ streams: 179642, listeners: 81259, windowDays: 28 })
  })
  test('uses agreeing visible stat-link dates only when the stat window label is absent', () => {
    const text = homeText.replace('Last 28 days', 'Date range dropdown') + '\nYour top songs\nLast 7 days'
    const anchors = ['listeners', 'streams'].map(metric => ({ text: metric, href: `https://artists.spotify.com/c/artist/artist-id/audience/stats?metric=${metric}&fromDate=2026-08-18&toDate=2026-09-14` }))
    expect(parseSpotifyHome({ url, text, anchors })).toEqual({ streams: 179642, listeners: 81259, windowDays: 28 })
    expect(parseSpotifyHome({ url, text })).toBeNull()
    expect(parseSpotifyHome({ url, text, anchors: anchors.slice(0, 1) })).toBeNull()
    expect(parseSpotifyHome({ url, text, anchors: [anchors[0]!, { ...anchors[1]!, href: anchors[1]!.href.replace('2026-08-18', '2026-08-19') }] })).toBeNull()
    expect(parseSpotifyHome({ url, text, anchors: anchors.map(anchor => ({ ...anchor, href: anchor.href.replace('/artist-id/', '/wrong-artist/') })) })).toBeNull()
    expect(parseSpotifyHome({ url, text, anchors: anchors.map(anchor => ({ ...anchor, href: anchor.href.replace('2026-08-18', '2026-02-30') })) })).toBeNull()
  })
  test('preserves exact zero and rejects malformed counts', () => {
    expect(parseExactSpotifyCount('0')).toBe(0)
    expect(parseExactSpotifyCount('179\u202f642')).toBe(179642)
    for (const value of ['180K', '81.2K', '12,34', '23%', '-50', '9e3', '9007199254740992']) expect(parseExactSpotifyCount(value)).toBeNull()
  })
  test('reads countries and multiline city cells with the real alternate city header', () => {
    const data: SpotifyPageData = { url, text: 'Top countries\nListeners • Last 28 Days • Worldwide\nTop cities\nListeners • Last 28 Days • Worldwide', tables: [
      { headers: ['#', 'Country', 'Listeners', '% Active', 'Active Listeners'], rows: [['1', 'United States', '39,050', '50.6%', '19,743'], ['2', 'United Kingdom', '4,100', '40%', '1,640']] },
      { headers: ['#', 'Last 28 Days', 'Listeners'], rows: [['1', 'London\nUnited Kingdom, ENG', '1,317'], ['2', 'Chicago\nUnited States IL', '802']] },
    ] }
    expect(parseSpotifyLocation(data, 28)).toEqual({ topCountries: [{ country: 'United States', listeners: 39050 }, { country: 'United Kingdom', listeners: 4100 }], topCities: [{ city: 'London', country: 'United Kingdom', listeners: 1317 }, { city: 'Chicago', country: 'United States', listeners: 802 }] })
    expect(parseSpotifyLocation(data, 7)).toEqual({ topCountries: [], topCities: [] })
  })
  test('DOM extraction expands the live city header colspan before parsing ranked rows', () => {
    const cell = (innerText: string, colSpan = 1) => ({ innerText, colSpan, getClientRects: () => [{}], getAttribute: () => null })
    const headers = [cell('Last 28 Days', 2), cell('Listeners')]
    const row = { ...cell(''), querySelectorAll: () => [cell('1'), cell('London\nUnited Kingdom, ENG'), cell('1,317')] }
    const table = { ...cell(''), querySelectorAll: (selector: string) => selector.startsWith('th') ? headers : [row] }
    const document = { body: { innerText: 'Listeners • Last 28 Days • Worldwide' }, querySelectorAll: (selector: string) => selector.startsWith('table') ? [table] : [] }
    const evaluate = new Function('document', 'location', 'getComputedStyle', `return ${SPOTIFY_PAGE_DATA_EXPRESSION}`)
    const data = evaluate(document, { href: url }, () => ({ visibility: 'visible', display: 'block' })) as SpotifyPageData
    expect(data.tables?.[0]?.headers).toEqual(['', 'Last 28 Days', 'Listeners'])
    expect(parseSpotifyLocation(data, 28).topCities).toEqual([{ city: 'London', country: 'United Kingdom', listeners: 1317 }])
  })
  test('caps geography at five rows per kind and skips rounded values', () => {
    const rows = [['0', 'Rounded', '18K'], ...Array.from({ length: 7 }, (_, i) => [String(i + 1), `Country ${i}`, String(100 - i)])]
    const result = parseSpotifyLocation({ url, text: 'Last 28 days', tables: [{ headers: ['#', 'Country', 'Listeners'], rows }] }, 28)
    expect(result.topCountries).toHaveLength(5)
    expect(result.topCountries[0]).toEqual({ country: 'Country 0', listeners: 100 })
  })
  test('requires a selected window instead of inferring it from Songs filter options', () => {
    const data: SpotifyPageData = { url, text: 'Songs\n24 hours\n7 days\n28 days', tables: [{ headers: ['#', 'Title', 'Streams', 'Listeners', 'Canvas views', 'Saves', 'First released'], rows: [['1', 'Homebody\nArtist', '24,123', '9,002', '0', '45', 'Jan 1, 2026']] }] }
    expect(parseSpotifySongs(data, 28)).toEqual({ topTracks: [] })
    expect(parseSpotifySongs({ ...data, selectedWindowText: '28 days' }, 28)).toEqual({ topTracks: [{ name: 'Homebody', streams: 24123 }] })
    expect(parseSpotifySongs({ ...data, selectedWindowText: '7 days' }, 28)).toEqual({ topTracks: [] })
  })
  test('caps Songs and rejects contradictory reporting windows', () => {
    const data: SpotifyPageData = { url, text: 'Last 28 days', tables: [{ headers: ['Title', 'Streams'], rows: Array.from({ length: 8 }, (_, i) => [`Track ${i}`, String(i)]) }] }
    expect(parseSpotifySongs(data, 28).topTracks).toHaveLength(5)
    expect(parseSpotifySongs({ ...data, selectedWindowText: '7 days' }, 28).topTracks).toHaveLength(0)
  })
})
