/**
 * Reading a site the artist already has (spec 41 Slice D).
 *
 * The point is not to take it over. It is to know what is there, so the agent
 * can notice the site never mentions the new record without re-reading it
 * every conversation, and to find out whether anyone signing up is reaching
 * the artist's fan list or disappearing into a platform's own.
 *
 * Analysis is pure and works on HTML strings; the crawl is a thin wrapper.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { FetchLike } from './adapters/types'

/** Bounded so inspecting a large site cannot run away. */
const MAX_PAGES = 12
const MAX_HTML_BYTES = 2_000_000

export type SitePlatform =
  | 'squarespace'
  | 'wix'
  | 'wordpress'
  | 'shopify'
  | 'bandzoogle'
  | 'linktree'
  | 'webflow'
  | 'static'
  | 'unknown'

const PLATFORM_SIGNALS: Array<{ platform: SitePlatform; html?: RegExp; header?: string }> = [
  { platform: 'squarespace', html: /squarespace\.com|static1\.squarespace|Squarespace\b/i },
  { platform: 'wix', html: /wix\.com|wixstatic\.com|X-Wix-/i, header: 'x-wix-request-id' },
  { platform: 'wordpress', html: /wp-content|wp-json|generator"\s*content="WordPress/i },
  { platform: 'shopify', html: /cdn\.shopify\.com|Shopify\.theme/i, header: 'x-shopid' },
  { platform: 'bandzoogle', html: /bandzoogle/i },
  { platform: 'linktree', html: /linktr\.ee|linktree/i },
  { platform: 'webflow', html: /webflow\.(com|io)|data-wf-page/i },
]

/** Hosts that tell us where a static site lives, not what built it. */
const HOST_SIGNALS: Array<{ platform: SitePlatform; header: string }> = [
  { platform: 'static', header: 'x-vercel-id' },
  { platform: 'static', header: 'x-nf-request-id' },
  { platform: 'static', header: 'x-github-request-id' },
]

export function detectPlatform(html: string, headers: Record<string, string> = {}): SitePlatform {
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  )

  for (const signal of PLATFORM_SIGNALS) {
    if (signal.header && lowerHeaders[signal.header]) return signal.platform
    if (signal.html?.test(html)) return signal.platform
  }
  for (const signal of HOST_SIGNALS) {
    if (lowerHeaders[signal.header]) return signal.platform
  }
  return 'unknown'
}

/**
 * How an edit to this site actually gets made.
 *
 * Every one of these is "open the admin and use its editor". WordPress has a
 * REST API and we deliberately do not use it: on a site built with Elementor,
 * Divi or WPBakery the page lives in postmeta and `post_content` is a stub, so
 * an API write lands somewhere nobody renders and reports success. Driving the
 * real editor is the accurate route.
 *
 * What differs per platform is where the artist logs in, which is the one
 * thing worth telling the agent up front.
 */
export function howToEdit(platform: SitePlatform): string {
  switch (platform) {
    case 'wordpress':
      return 'Log in at /wp-admin and edit the page in whatever editor the site uses. Do not assume Gutenberg; a page builder stores its layout somewhere else.'
    case 'squarespace':
      return 'Log in at squarespace.com and edit the page there.'
    case 'wix':
      return 'Log in at wix.com and edit the page in the Wix editor.'
    case 'shopify':
      return 'Log in to the Shopify admin and edit the page or theme content there.'
    case 'bandzoogle':
      return 'Log in at bandzoogle.com and edit the page there.'
    case 'webflow':
      return 'Log in at webflow.com. Only CMS content is editable without republishing the whole site.'
    case 'linktree':
      return 'Log in at linktr.ee. This is a link list, not a site — there is not much here to change.'
    case 'static':
      return 'This is a static site deployed from somewhere. Editing it means changing its source, which the artist has to point you at.'
    default:
      return 'Ask the artist where they log in to edit this site.'
  }
}

export interface CaptureFinding {
  present: boolean
  /** Where the addresses currently go, when it can be told. */
  provider?: 'mailchimp' | 'squarespace' | 'wix' | 'convertkit' | 'substack' | 'artist-os' | 'unknown'
}

const CAPTURE_PROVIDERS: Array<{ provider: NonNullable<CaptureFinding['provider']>; re: RegExp }> = [
  { provider: 'artist-os', re: /\/api\/signup/i },
  { provider: 'mailchimp', re: /list-manage\.com|mailchimp/i },
  { provider: 'convertkit', re: /convertkit\.com|ck\.page/i },
  { provider: 'substack', re: /substack\.com/i },
  { provider: 'squarespace', re: /squarespace\.com\/api\/.*form|sqs-block-form/i },
  { provider: 'wix', re: /wix.*subscribe|wixapps.*form/i },
]

/**
 * Is there anywhere on this page for a visitor to leave an address, and where
 * does it go?
 *
 * A form pointing at Mailchimp is not the same as no form: the artist has
 * fans, they are just somewhere the rest of the system cannot reach.
 */
export function findCaptureForm(html: string): CaptureFinding {
  const hasEmailInput = /<input[^>]+type\s*=\s*["']?email["']?/i.test(html)
    || /<input[^>]+name\s*=\s*["']?(email|EMAIL)["']?/i.test(html)
  if (!hasEmailInput) return { present: false }

  for (const candidate of CAPTURE_PROVIDERS) {
    if (candidate.re.test(html)) return { present: true, provider: candidate.provider }
  }
  return { present: true, provider: 'unknown' }
}

export interface PageReport {
  url: string
  title?: string
  description?: string
  h1Count: number
  hasCanonical: boolean
  hasOpenGraph: boolean
  hasStructuredData: boolean
  imagesMissingAlt: number
  bytes: number
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1]
}

export function analyzePage(url: string, html: string): PageReport {
  const descriptionTag = /<meta[^>]+name\s*=\s*"description"[^>]*>/i.exec(html)?.[0]
  return {
    url,
    title: /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim(),
    description: descriptionTag ? attr(descriptionTag, 'content') : undefined,
    h1Count: (html.match(/<h1[\s>]/gi) ?? []).length,
    hasCanonical: /<link[^>]+rel\s*=\s*"canonical"/i.test(html),
    hasOpenGraph: /<meta[^>]+property\s*=\s*"og:title"/i.test(html),
    hasStructuredData: /application\/ld\+json/i.test(html),
    imagesMissingAlt: (html.match(/<img[^>]*>/gi) ?? [])
      .filter(tag => attr(tag, 'alt') === undefined).length,
    bytes: Buffer.byteLength(html),
  }
}

export interface SiteFinding {
  severity: 'warning' | 'notice'
  message: string
}

/**
 * What is worth telling the artist about a site they already have.
 *
 * Framed as observations, not a score. Nobody wants their own site graded,
 * and a number does not tell them what to do next.
 */
export function reviewSite(pages: PageReport[], capture: CaptureFinding): SiteFinding[] {
  const findings: SiteFinding[] = []
  if (pages.length === 0) return findings

  if (!capture.present) {
    findings.push({
      severity: 'warning',
      message: 'There is no way for a visitor to give you their email. Everyone who finds you leaves and you cannot reach them again.',
    })
  } else if (capture.provider && capture.provider !== 'artist-os') {
    findings.push({
      severity: 'warning',
      message: `Your signup goes to ${capture.provider === 'unknown' ? 'somewhere else' : capture.provider}, so those fans are not in your list here and cannot be emailed from Artist OS.`,
    })
  }

  const untitled = pages.filter(page => !page.title?.trim()).length
  if (untitled > 0) {
    findings.push({
      severity: 'warning',
      message: `${untitled} ${untitled === 1 ? 'page has' : 'pages have'} no title, so search results show the URL instead of your name.`,
    })
  }

  const noDescription = pages.filter(page => !page.description?.trim()).length
  if (noDescription > 0) {
    findings.push({
      severity: 'notice',
      message: `${noDescription} ${noDescription === 1 ? 'page is' : 'pages are'} missing a description, so search engines write their own.`,
    })
  }

  if (!pages[0]!.hasStructuredData) {
    findings.push({
      severity: 'notice',
      message: 'The site does not tell search engines it belongs to a musician, so releases and shows will not show up as music results.',
    })
  }

  const missingAlt = pages.reduce((sum, page) => sum + page.imagesMissingAlt, 0)
  if (missingAlt > 3) {
    findings.push({
      severity: 'notice',
      message: `${missingAlt} images have no alt text, which hurts both search and anyone using a screen reader.`,
    })
  }

  const heavy = pages.filter(page => page.bytes > 1_000_000).length
  if (heavy > 0) {
    findings.push({
      severity: 'notice',
      message: `${heavy} ${heavy === 1 ? 'page is' : 'pages are'} over a megabyte, which is slow on a phone.`,
    })
  }

  return findings
}

/** Internal links worth following, in document order and de-duplicated. */
export function internalLinks(html: string, base: string, limit: number): string[] {
  const origin = new URL(base).origin
  const seen = new Set<string>()
  const out: string[] = []

  for (const tag of html.match(/<a\b[^>]+href\s*=\s*"[^"]*"/gi) ?? []) {
    const href = attr(tag, 'href')
    if (!href || /^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue
    let resolved: URL
    try {
      resolved = new URL(href, base)
    } catch {
      continue
    }
    if (resolved.origin !== origin) continue
    resolved.hash = ''
    const key = resolved.toString()
    if (seen.has(key) || key === base) continue
    seen.add(key)
    out.push(key)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Is this address somewhere on the artist's own network rather than the open
 * web?
 *
 * The URL for this crawl can come from an agent, and an agent can be talked
 * into things by whatever it just read. A site inspection has no business
 * reaching a router admin page or a service bound to localhost, so resolve the
 * host first and refuse anything that lands inside.
 */
async function isPrivateHost(hostname: string): Promise<boolean> {
  const bare = hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(bare)
    ? [bare]
    : await lookup(bare, { all: true }).then(
      results => results.map(entry => entry.address),
      () => [] as string[],
    )
  // An unresolvable host is left to fetch, which will fail on its own and
  // produce the friendlier "could not reach" message.
  return addresses.some(address => {
    if (isIP(address) === 6) {
      const lower = address.toLowerCase()
      if (lower === '::1' || lower === '::') return true
      if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true // unique-local
      if (/^fe[89ab][0-9a-f]:/.test(lower)) return true // link-local
      // IPv4-mapped (::ffff:10.0.0.1) is checked through the v4 rules below.
      const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(lower)?.[1]
      return mapped ? isPrivateV4(mapped) : false
    }
    return isPrivateV4(address)
  })
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  return false
}

export interface InspectResult {
  ok: boolean
  error?: string
  url?: string
  platform?: SitePlatform
  howToEdit?: string
  pages?: PageReport[]
  capture?: CaptureFinding
  findings?: SiteFinding[]
  inspectedAt?: string
}

/**
 * Read a site once and report what is there.
 *
 * Read-only by construction: it fetches and parses, and writes nothing
 * anywhere. The result is stored by the caller so the agent does not have to
 * crawl again every time it is asked a question.
 */
export async function inspectExternalSite(
  rawUrl: string,
  options: { fetchImpl?: FetchLike; maxPages?: number } = {},
): Promise<InspectResult> {
  let base: URL
  try {
    base = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { ok: false, error: `That does not look like a web address: ${rawUrl}` }
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    return { ok: false, error: 'Only http and https addresses can be inspected.' }
  }
  if (await isPrivateHost(base.hostname)) {
    return { ok: false, error: `${base.hostname} is on a private network, not the public web. Only a live site can be inspected.` }
  }

  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as never)
  const limit = Math.min(Math.max(options.maxPages ?? MAX_PAGES, 1), MAX_PAGES)

  const read = async (url: string): Promise<{ html: string; headers: Record<string, string> } | null> => {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'text/html' } }) as unknown as {
        ok: boolean
        status: number
        text: () => Promise<string>
        headers?: { forEach?: (cb: (value: string, key: string) => void) => void }
      }
      if (!response.ok) return null
      const html = (await response.text()).slice(0, MAX_HTML_BYTES)
      const headers: Record<string, string> = {}
      response.headers?.forEach?.((value, key) => { headers[key] = value })
      return { html, headers }
    } catch {
      return null
    }
  }

  const home = await read(base.toString())
  if (!home) {
    return { ok: false, error: `Could not reach ${base.hostname}. Check the address, or the site may be down.` }
  }

  const platform = detectPlatform(home.html, home.headers)
  const pages: PageReport[] = [analyzePage(base.toString(), home.html)]
  let capture = findCaptureForm(home.html)

  for (const link of internalLinks(home.html, base.toString(), limit - 1)) {
    const page = await read(link)
    if (!page) continue
    pages.push(analyzePage(link, page.html))
    // A signup can live on any page, not just the home page.
    if (!capture.present) capture = findCaptureForm(page.html)
  }

  return {
    ok: true,
    url: base.toString(),
    platform,
    howToEdit: howToEdit(platform),
    pages,
    capture,
    findings: reviewSite(pages, capture),
    inspectedAt: new Date().toISOString(),
  }
}
