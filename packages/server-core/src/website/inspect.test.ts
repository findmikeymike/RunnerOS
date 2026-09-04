import { describe, expect, test } from 'bun:test'
import {
  analyzePage,
  detectPlatform,
  findCaptureForm,
  inspectExternalSite,
  internalLinks,
  reviewSite,
  type PageReport,
} from './inspect'
import type { FetchLike } from './adapters/types'

function page(overrides: Partial<PageReport> = {}): PageReport {
  return {
    url: 'https://lowtide.com/',
    title: 'Low Tide',
    description: 'Official site',
    h1Count: 1,
    hasCanonical: true,
    hasOpenGraph: true,
    hasStructuredData: true,
    imagesMissingAlt: 0,
    bytes: 40_000,
    ...overrides,
  }
}

describe('knowing what built the site', () => {
  test('common builders are recognised from their markup', () => {
    expect(detectPlatform('<img src="https://static1.squarespace.com/x.jpg">')).toBe('squarespace')
    expect(detectPlatform('<script src="https://static.wixstatic.com/a.js">')).toBe('wix')
    expect(detectPlatform('<link href="/wp-content/themes/x.css">')).toBe('wordpress')
    expect(detectPlatform('<div data-wf-page="abc">')).toBe('webflow')
    expect(detectPlatform('<a href="https://linktr.ee/lowtide">')).toBe('linktree')
  })

  test('a header settles it when the markup is quiet', () => {
    expect(detectPlatform('<html></html>', { 'X-Wix-Request-Id': 'abc' })).toBe('wix')
    expect(detectPlatform('<html></html>', { 'x-vercel-id': 'abc' })).toBe('static')
  })

  test('an unrecognised site is unknown rather than guessed at', () => {
    expect(detectPlatform('<html><body>Hello</body></html>')).toBe('unknown')
  })

  test('only WordPress can be edited without a browser', () => {
    expect(detectPlatform('<link href="/wp-content/x.css">')).toBe('wordpress')
    // Everything else means the agent drives the browser or hands over copy.
    expect(findCaptureForm('').present).toBe(false)
  })
})

describe('finding out where the fans go', () => {
  test('a form is found and its destination named', () => {
    const mailchimp = findCaptureForm('<form action="https://x.us1.list-manage.com/subscribe"><input type="email"></form>')
    expect(mailchimp).toEqual({ present: true, provider: 'mailchimp' })

    const ours = findCaptureForm('<form action="/api/signup"><input type="email"></form>')
    expect(ours.provider).toBe('artist-os')
  })

  test('a form with an unrecognised destination is still a form', () => {
    const found = findCaptureForm('<form action="/subscribe"><input name="email"></form>')
    expect(found).toEqual({ present: true, provider: 'unknown' })
  })

  test('no email input means no door', () => {
    expect(findCaptureForm('<form><input type="text" name="q"></form>').present).toBe(false)
  })
})

describe('what is worth telling the artist', () => {
  test('no door at all is the first thing raised', () => {
    const findings = reviewSite([page()], { present: false })
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.message).toContain('cannot reach them again')
  })

  test('a door pointing elsewhere is called out as fans you cannot reach', () => {
    const findings = reviewSite([page()], { present: true, provider: 'mailchimp' })
    const message = findings.find(item => item.message.includes('mailchimp'))!
    expect(message.message).toContain('not in your list here')
  })

  test('a door that already feeds Artist OS is not complained about', () => {
    const findings = reviewSite([page()], { present: true, provider: 'artist-os' })
    expect(findings.some(item => item.message.includes('signup'))).toBe(false)
  })

  test('missing titles are explained by consequence, not by rule', () => {
    const findings = reviewSite([page({ title: '' })], { present: true, provider: 'artist-os' })
    expect(findings.find(item => item.message.includes('no title'))!.message)
      .toContain('search results show the URL')
  })

  test('a healthy site is left alone', () => {
    expect(reviewSite([page()], { present: true, provider: 'artist-os' })).toEqual([])
  })
})

describe('reading a page', () => {
  test('the things that matter are pulled out', () => {
    const report = analyzePage('https://lowtide.com/', `
      <html><head>
        <title>Low Tide</title>
        <meta name="description" content="Official site">
        <link rel="canonical" href="https://lowtide.com/">
        <meta property="og:title" content="Low Tide">
        <script type="application/ld+json">{}</script>
      </head><body>
        <h1>Low Tide</h1>
        <img src="a.jpg" alt="cover"><img src="b.jpg">
      </body></html>`)

    expect(report.title).toBe('Low Tide')
    expect(report.description).toBe('Official site')
    expect(report.h1Count).toBe(1)
    expect(report.hasCanonical).toBe(true)
    expect(report.hasStructuredData).toBe(true)
    expect(report.imagesMissingAlt).toBe(1)
  })
})

describe('following links', () => {
  test('only same-site links are followed, and never twice', () => {
    const links = internalLinks(`
      <a href="/shows">Shows</a>
      <a href="/shows">Shows again</a>
      <a href="https://lowtide.com/press">Press</a>
      <a href="https://twitter.com/lowtide">Twitter</a>
      <a href="mailto:a@b.com">Email</a>
      <a href="#top">Top</a>
    `, 'https://lowtide.com/', 10)

    expect(links).toEqual(['https://lowtide.com/shows', 'https://lowtide.com/press'])
  })

  test('the follow count is capped', () => {
    const html = Array.from({ length: 30 }, (_, i) => `<a href="/p${i}">p</a>`).join('')
    expect(internalLinks(html, 'https://lowtide.com/', 3)).toHaveLength(3)
  })
})

describe('inspecting a whole site', () => {
  function fakeSite(pages: Record<string, string>, headers: Record<string, string> = {}): FetchLike {
    return (async (url: string) => {
      const html = pages[url]
      if (!html) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => html,
        headers: { forEach: (cb: (v: string, k: string) => void) => Object.entries(headers).forEach(([k, v]) => cb(v, k)) },
      }
    }) as unknown as FetchLike
  }

  test('the home page and its links are read once each', async () => {
    const result = await inspectExternalSite('https://lowtide.com/', {
      fetchImpl: fakeSite({
        'https://lowtide.com/': '<html><title>Low Tide</title><a href="/shows">Shows</a></html>',
        'https://lowtide.com/shows': '<html><title>Shows</title></html>',
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.pages).toHaveLength(2)
    expect(result.pages![1]!.title).toBe('Shows')
  })

  test('a signup found on an inner page still counts', async () => {
    const result = await inspectExternalSite('lowtide.com', {
      fetchImpl: fakeSite({
        'https://lowtide.com/': '<html><a href="/contact">Contact</a></html>',
        'https://lowtide.com/contact': '<form action="https://x.list-manage.com/s"><input type="email"></form>',
      }),
    })

    expect(result.capture).toEqual({ present: true, provider: 'mailchimp' })
  })

  test('a bare hostname is accepted and upgraded to https', async () => {
    const result = await inspectExternalSite('lowtide.com', {
      fetchImpl: fakeSite({ 'https://lowtide.com/': '<html><title>Low Tide</title></html>' }),
    })
    expect(result.url).toBe('https://lowtide.com/')
  })

  test('an unreachable site says so in plain terms', async () => {
    const result = await inspectExternalSite('https://lowtide.com/', { fetchImpl: fakeSite({}) })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Could not reach lowtide.com')
  })

  test('a nonsense address is refused before any request', async () => {
    let called = false
    const result = await inspectExternalSite('not a url at all', {
      fetchImpl: (async () => { called = true; return { ok: true, status: 200, json: async () => ({}), text: async () => '' } }) as unknown as FetchLike,
    })
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  test('a dead inner link does not fail the whole inspection', async () => {
    const result = await inspectExternalSite('https://lowtide.com/', {
      fetchImpl: fakeSite({
        'https://lowtide.com/': '<html><title>Low Tide</title><a href="/gone">Gone</a></html>',
      }),
    })
    expect(result.ok).toBe(true)
    expect(result.pages).toHaveLength(1)
  })
})
