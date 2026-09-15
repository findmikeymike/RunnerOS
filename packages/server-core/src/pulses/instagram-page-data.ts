/** Rendered Instagram insights only; no private page state or network requests. */
export const INSTAGRAM_PAGE_DATA_EXPRESSION = `(() => {
  const visible = element => element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden'
    && getComputedStyle(element).display !== 'none';
  const text = element => (element.innerText || '').trim();
  return {
    url: location.href,
    text: document.body ? document.body.innerText : '',
    headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')).filter(visible)
      .map(element => ({ text: text(element), level: Number(element.getAttribute('aria-level') || element.tagName.slice(1)) || undefined })),
    anchors: Array.from(document.querySelectorAll('a[href]')).filter(visible).map(element => ({
      href: element.href,
      text: text(element),
      label: element.getAttribute('aria-label') || '',
      imageAlt: Array.from(element.querySelectorAll('img[alt]')).filter(visible).map(image => image.alt).join(' '),
    })),
  };
})()`

export interface InstagramPageData {
  url: string
  text: string
  headings?: Array<{ level?: number; text: string }>
  anchors?: Array<{ href: string; text?: string; label?: string; imageAlt?: string }>
}
export interface InstagramInsightsMetrics {
  followers: number
  views: number
  interactions: number
  accountsEngaged?: number
  profileVisits?: number
  accountsReached?: number
  followerDelta?: number
}
export interface InstagramInsightsData { windowDays: number; metrics: InstagramInsightsMetrics }

function exactCount(value: string, signed = false): number | null {
  const clean = value.trim()
  if (!(signed ? /^[+-]?(?:\d+|\d{1,3}(?:[,\u00a0\u202f ]\d{3})+)$/ : /^(?:\d+|\d{1,3}(?:[,\u00a0\u202f ]\d{3})+)$/).test(clean)) return null
  const count = Number(clean.replace(/[,\u00a0\u202f ]/g, ''))
  return Number.isSafeInteger(count) && (signed || count >= 0) ? count : null
}

function ownProfileMatches(data: InstagramPageData, expectedHandle: string): boolean {
  const handle = expectedHandle.trim().replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) return false
  const identities = new Set<string>()
  for (const anchor of data.anchors ?? []) {
    const description = [anchor.imageAlt, anchor.label, anchor.text].filter(Boolean).join(' ')
    if (!/profile picture/i.test(description)) continue
    try {
      const url = new URL(anchor.href, data.url)
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname)) continue
      const match = /^\/([a-z0-9._]{1,30})\/?$/i.exec(url.pathname)
      if (match) identities.add(match[1]!.toLowerCase())
    } catch { /* Ignore malformed/non-profile links. */ }
  }
  return identities.size === 1 && identities.has(handle)
}

/** Labels may repeat in chart legends, but only exact adjacent counts qualify. */
function labeledCount(lines: string[], labels: string[], signed = false): number | null {
  const found = new Set<number>()
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    for (const label of labels) {
      const inline = new RegExp(`^${label}\\s*:?\\s+(.+)$`, 'i').exec(line)
      if (inline) {
        const count = exactCount(inline[1]!, signed)
        if (count !== null) found.add(count)
      } else if (line.toLowerCase() === label.toLowerCase()) {
        let next = index + 1
        while (/^(?:info|information|about this metric)$/i.test(lines[next]?.trim() ?? '')) next++
        const count = exactCount(lines[next] ?? '', signed)
        if (count !== null) found.add(count)
      }
    }
  }
  return found.size === 1 ? [...found][0]! : null
}

function headingOrBodyCount(data: InstagramPageData, labels: string[]): number | null {
  const headings = (data.headings ?? []).map(heading => heading.text.trim()).filter(Boolean)
  const body = data.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const fromHeadings = labeledCount(headings, labels)
  const fromBody = labeledCount(body, labels)
  // Conflicting exact values indicate an unstable or ambiguous render.
  if (fromHeadings !== null && fromBody !== null && fromHeadings !== fromBody) return null
  return fromHeadings ?? fromBody
}

export function parseInstagramInsights(data: InstagramPageData, expectedHandle: string): InstagramInsightsData | null {
  try {
    const url = new URL(data.url)
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)
      || url.pathname.replace(/\/$/, '') !== '/accounts/insights') return null
  } catch { return null }
  if (!ownProfileMatches(data, expectedHandle)) return null
  const windows = [...new Set([...data.text.matchAll(/\bLast\s+(\d+)\s+days?\b/gi)].map(match => Number(match[1])))]
  if (windows.length !== 1 || !Number.isSafeInteger(windows[0]) || windows[0]! <= 0) return null
  const followers = headingOrBodyCount(data, ['Followers', 'Total followers'])
  const views = headingOrBodyCount(data, ['Views'])
  const interactions = headingOrBodyCount(data, ['Interactions'])
  if (followers === null || views === null || interactions === null) return null
  const lines = data.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const accountsEngaged = labeledCount(lines, ['Accounts engaged'])
  const profileVisits = labeledCount(lines, ['Profile visits'])
  const accountsReached = labeledCount(lines, ['Accounts reached'])
  const followerDelta = labeledCount(lines, ['Net follows', 'Overall growth'], true)
  return {
    windowDays: windows[0]!,
    metrics: { followers, views, interactions,
      ...(accountsEngaged !== null ? { accountsEngaged } : {}),
      ...(profileVisits !== null ? { profileVisits } : {}),
      ...(accountsReached !== null ? { accountsReached } : {}),
      ...(followerDelta !== null ? { followerDelta } : {}),
    },
  }
}
