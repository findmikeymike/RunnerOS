/** Read rendered Spotify for Artists content only; no page state or network access. */
export const SPOTIFY_PAGE_DATA_EXPRESSION = `(() => {
  const visible = (element) => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
    && getComputedStyle(element).display !== 'none';
  const text = (element) => (element.innerText || '').trim();
  return {
    url: location.href,
    text: document.body ? document.body.innerText : '',
    selectedWindowText: Array.from(document.querySelectorAll('[aria-pressed="true"], [aria-selected="true"], [aria-checked="true"]')).filter(visible).map(text).join('\\n'),
    anchors: Array.from(document.querySelectorAll('a[href]')).filter(visible)
      .map(element => ({ text: text(element), href: element.href })),
    tables: Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]')).filter(visible)
      .map(table => ({
        headers: Array.from(table.querySelectorAll('th, [role="columnheader"]')).filter(visible).flatMap(element => {
          const rawSpan = Number(element.getAttribute('aria-colspan') || element.colSpan || 1);
          const span = Number.isInteger(rawSpan) && rawSpan > 0 && rawSpan <= 100 ? rawSpan : 1;
          return [...Array(span - 1).fill(''), text(element)];
        }),
        rows: Array.from(table.querySelectorAll('tr, [role="row"]')).filter(visible)
          .map(row => Array.from(row.querySelectorAll('td, [role="cell"], [role="gridcell"]')).filter(visible).map(text))
          .filter(row => row.length > 0),
      })),
  };
})()`

export interface SpotifyPageData {
  url: string
  text: string
  selectedWindowText?: string
  anchors?: Array<{ text: string; href: string }>
  tables?: Array<{ headers: string[]; rows: string[][] }>
}
export interface SpotifyHomeMetrics { streams: number; listeners: number; windowDays: number }
export interface SpotifyLocationMetrics {
  topCountries: Array<{ country: string; listeners: number }>
  topCities: Array<{ city: string; country?: string; listeners: number }>
}
export interface SpotifySongMetrics { topTracks: Array<{ name: string; streams: number }> }

function isArtistPage(data: SpotifyPageData): boolean {
  try { return new URL(data.url).hostname === 'artists.spotify.com' }
  catch { return false }
}

/** Rounded K/M values, percentages, signs, and chart/date text are not counts. */
export function parseExactSpotifyCount(text: string): number | null {
  const value = text.trim()
  if (!/^(?:\d+|\d{1,3}(?:[,\u00a0\u202f ]\d{3})+)$/.test(value)) return null
  const count = Number(value.replace(/[,\u00a0\u202f ]/g, ''))
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

export function parseSpotifyWindowDays(text: string): number | null {
  const windows = [...text.matchAll(/\bLast\s+(\d+)\s+days?\b/gi)].map(match => Number(match[1]))
  const distinct = [...new Set(windows)]
  return distinct.length === 1 && Number.isSafeInteger(distinct[0]) && distinct[0]! > 0 ? distinct[0]! : null
}

function pageWindowDays(data: SpotifyPageData): number | null {
  const visibleWindow = parseSpotifyWindowDays(data.text)
  if (visibleWindow === null && /\bLast\s+\d+\s+days?\b/i.test(data.text)) return null
  const selected = (data.selectedWindowText ?? '').split(/\r?\n/)
    .map(text => /^(?:Last\s+)?(\d+)\s*days?$/i.exec(text.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => Number(match[1]))
  const windows = [...new Set([...(visibleWindow === null ? [] : [visibleWindow]), ...selected])]
  return windows.length === 1 && windows[0]! > 0 ? windows[0]! : null
}

function labeledCount(text: string, labels: string[]): number | null {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const found: number[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    for (const label of labels) {
      const inline = new RegExp(`^${label}\\s*:?\\s+([\\d, \\u00a0\\u202f]+)$`, 'i').exec(line)
      if (inline) {
        const count = parseExactSpotifyCount(inline[1]!)
        if (count !== null) found.push(count)
      } else if (line.toLowerCase() === label.toLowerCase()) {
        // Dashboard cards render their label immediately before the count.
        const count = parseExactSpotifyCount(lines[index + 1] ?? '')
        if (count !== null) found.push(count)
      }
    }
  }
  const distinct = [...new Set(found)]
  return distinct.length === 1 ? distinct[0]! : null
}

function homeStatsText(text: string): string {
  const start = /\bStreaming stats\b/i.exec(text)
  const section = start ? text.slice(start.index + start[0].length) : text
  const end = /\b(?:Audience development|Your top songs|Your top playlists|Latest releases?)\b/i.exec(section)
  return end ? section.slice(0, end.index) : section
}

/** Visible stat links carry the same explicit date filter as their metric card. */
function homeAnchorWindowDays(data: SpotifyPageData): number | null {
  const page = new URL(data.url)
  const artistPrefix = /^(\/c\/artist\/[^/]+)\//.exec(page.pathname)?.[1]
  if (!artistPrefix) return null
  const ranges = new Map<string, Set<string>>()
  for (const anchor of data.anchors ?? []) {
    try {
      const target = new URL(anchor.href, data.url)
      if (target.origin !== page.origin || target.pathname !== `${artistPrefix}/audience/stats`) continue
      const metric = target.searchParams.get('metric')
      if (metric !== 'streams' && metric !== 'listeners') continue
      const from = target.searchParams.get('fromDate') ?? ''
      const to = target.searchParams.get('toDate') ?? ''
      const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
      if (!validDate(from) || !validDate(to) || from > to) continue
      const key = `${from}/${to}`
      const metrics = ranges.get(key) ?? new Set<string>()
      metrics.add(metric)
      ranges.set(key, metrics)
    } catch { /* Ignore malformed or unrelated visible links. */ }
  }
  // Both metric links must name the same dates, without conflicting stat links.
  if (ranges.size !== 1) return null
  const [range, metrics] = [...ranges.entries()][0]!
  if (!metrics.has('streams') || !metrics.has('listeners')) return null
  const [from, to] = range.split('/')
  return (Date.parse(to!) - Date.parse(from!)) / 86_400_000 + 1
}

export function parseSpotifyHome(data: SpotifyPageData): SpotifyHomeMetrics | null {
  if (!isArtistPage(data)) return null
  const text = homeStatsText(data.text)
  const displayedWindow = parseSpotifyWindowDays(text)
  // A contradictory explicit window must not be replaced by link inference.
  if (displayedWindow === null && /\bLast\s+\d+\s+days?\b/i.test(text)) return null
  const windowDays = displayedWindow ?? homeAnchorWindowDays(data)
  const streams = labeledCount(text, ['Streams'])
  const listeners = labeledCount(text, ['Monthly listeners', 'Listeners'])
  return windowDays !== null && streams !== null && listeners !== null ? { streams, listeners, windowDays } : null
}

function headerIndex(headers: string[], pattern: RegExp): number {
  return headers.findIndex(header => pattern.test(header.replace(/\s+/g, ' ').trim()))
}

export function parseSpotifyLocation(data: SpotifyPageData, windowDays: number): SpotifyLocationMetrics {
  const result: SpotifyLocationMetrics = { topCountries: [], topCities: [] }
  if (!isArtistPage(data) || pageWindowDays(data) !== windowDays) return result
  for (const table of data.tables ?? []) {
    const countryIndex = headerIndex(table.headers, /^countr(?:y|ies)$/i)
    const cityIndex = headerIndex(table.headers, /^(?:cit(?:y|ies)|last\s+\d+\s+days)$/i)
    const countIndex = headerIndex(table.headers, /^listeners$/i)
    if (countIndex < 0 || (countryIndex < 0 && cityIndex < 0)) continue
    for (const row of table.rows) {
      const listeners = parseExactSpotifyCount(row[countIndex] ?? '')
      if (listeners === null) continue
      if (cityIndex >= 0 && result.topCities.length < 5) {
        const [city, ...details] = (row[cityIndex] ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)
        const country = countryIndex >= 0 ? row[countryIndex]?.trim() : details.join(' ').replace(/[, ]+[A-Z]{2,3}$/, '').trim()
        if (city && !result.topCities.some(item => item.city === city && item.country === (country || undefined))) {
          result.topCities.push({ city, ...(country ? { country } : {}), listeners })
        }
      } else if (cityIndex < 0 && countryIndex >= 0 && result.topCountries.length < 5) {
        const country = row[countryIndex]?.trim()
        if (country && !result.topCountries.some(item => item.country === country)) result.topCountries.push({ country, listeners })
      }
    }
  }
  return result
}

export function parseSpotifySongs(data: SpotifyPageData, windowDays: number): SpotifySongMetrics {
  const result: SpotifySongMetrics = { topTracks: [] }
  if (!isArtistPage(data) || pageWindowDays(data) !== windowDays) return result
  for (const table of data.tables ?? []) {
    const nameIndex = headerIndex(table.headers, /^(?:song|track|title)s?$/i)
    const countIndex = headerIndex(table.headers, /^streams$/i)
    if (nameIndex < 0 || countIndex < 0) continue
    for (const row of table.rows) {
      const name = (row[nameIndex] ?? '').split(/\r?\n/)[0]?.trim()
      const streams = parseExactSpotifyCount(row[countIndex] ?? '')
      if (name && streams !== null && !result.topTracks.some(item => item.name === name)) result.topTracks.push({ name, streams })
      if (result.topTracks.length === 5) return result
    }
  }
  return result
}
