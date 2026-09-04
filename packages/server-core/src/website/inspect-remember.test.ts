import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWebsiteManifest, saveWebsiteManifest, defaultWebsiteManifest } from '@craft-agent/shared/website'
import { WebsiteService, getSiteBuilderPath } from './WebsiteService'
import type { FetchLike } from './adapters/types'

function workspace(): string {
  return mkdtempSync(join(tmpdir(), 'website-inspect-'))
}

/**
 * A fake site that counts how many times each page was read, so a test can
 * tell "answered from memory" from "crawled again".
 */
function fakeSite(pages: Record<string, string>) {
  const reads: string[] = []
  const fetchImpl = (async (url: string) => {
    reads.push(url)
    const html = pages[url]
    if (!html) return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
    return { ok: true, status: 200, json: async () => ({}), text: async () => html }
  }) as unknown as FetchLike
  return { reads, fetchImpl }
}

const SQUARESPACE = {
  'https://lowtide.com/': `
    <html><head><title>Low Tide</title></head><body>
      <img src="https://static1.squarespace.com/hero.jpg" alt="band">
      <a href="/shows">Shows</a>
      <form action="https://x.us1.list-manage.com/subscribe"><input type="email"></form>
    </body></html>`,
  'https://lowtide.com/shows': '<html><head><title>Shows</title></head><body></body></html>',
}

describe('reading a site the artist already has', () => {
  test('the reading is kept, so the next question does not crawl again', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      const first = fakeSite(SQUARESPACE)

      const read = await service.inspectExternal(root, { url: 'lowtide.com' }, { fetchImpl: first.fetchImpl })
      expect(read.ok).toBe(true)
      expect(read.platform).toBe('squarespace')
      expect(read.fromMemory).toBe(false)
      expect(first.reads).toHaveLength(2)

      // Same site, asked again: no network at all.
      const second = fakeSite(SQUARESPACE)
      const again = await service.inspectExternal(root, { url: 'https://www.lowtide.com/shows' }, { fetchImpl: second.fetchImpl })
      expect(again.fromMemory).toBe(true)
      expect(again.platform).toBe('squarespace')
      expect(second.reads).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('refresh goes back to the site', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      await service.inspectExternal(root, { url: 'lowtide.com' }, { fetchImpl: fakeSite(SQUARESPACE).fetchImpl })

      const second = fakeSite(SQUARESPACE)
      const refreshed = await service.inspectExternal(root, { refresh: true }, { fetchImpl: second.fetchImpl })
      expect(refreshed.fromMemory).toBe(false)
      expect(second.reads.length).toBeGreaterThan(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the artist is told their signups are going somewhere they cannot reach', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      const read = await service.inspectExternal(root, { url: 'lowtide.com' }, { fetchImpl: fakeSite(SQUARESPACE).fetchImpl })

      const findings = read.findings as Array<{ message: string }>
      expect(findings.some(item => item.message.includes('mailchimp'))).toBe(true)
      expect(read.howToEdit).toContain('squarespace.com')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a WordPress site is pointed at its own admin, not at an API', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      const read = await service.inspectExternal(root, { url: 'lowtide.com' }, {
        fetchImpl: fakeSite({
          'https://lowtide.com/': '<html><head><title>Low Tide</title><link href="/wp-content/x.css"></head></html>',
        }).fetchImpl,
      })

      expect(read.platform).toBe('wordpress')
      expect(read.howToEdit).toContain('/wp-admin')
      expect(loadWebsiteManifest(root)!.mode).toBe('wordpress')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a managed site is not relabelled by looking at one elsewhere', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      saveWebsiteManifest(root, defaultWebsiteManifest())

      await service.inspectExternal(root, { url: 'lowtide.com' }, { fetchImpl: fakeSite(SQUARESPACE).fetchImpl })

      const manifest = loadWebsiteManifest(root)!
      expect(manifest.mode).toBe('managed')
      expect(manifest.external!.platform).toBe('squarespace')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('reading somebody else’s site does not claim it as the artist’s', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      const read = await service.inspectExternal(root, { url: 'lowtide.com', remember: false }, {
        fetchImpl: fakeSite(SQUARESPACE).fetchImpl,
      })

      expect(read.ok).toBe(true)
      expect(loadWebsiteManifest(root)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('with nothing on file and no address, it asks rather than guessing', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      const read = await service.inspectExternal(root, {})
      expect(read.ok).toBe(false)
      expect(read.error).toContain('No site has been connected')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a site on the local network is refused before any request', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      const probe = fakeSite({})
      const read = await service.inspectExternal(root, { url: 'http://192.168.1.1/' }, { fetchImpl: probe.fetchImpl })

      expect(read.ok).toBe(false)
      expect(read.error).toContain('private network')
      expect(probe.reads).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a stored reading older than a week says so', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService(getSiteBuilderPath())
      await service.inspectExternal(root, { url: 'lowtide.com' }, { fetchImpl: fakeSite(SQUARESPACE).fetchImpl })

      const manifest = loadWebsiteManifest(root)!
      saveWebsiteManifest(root, {
        ...manifest,
        external: { ...manifest.external!, inspectedAt: '2020-01-01T00:00:00.000Z' },
      })

      const read = await service.inspectExternal(root, {})
      expect(read.fromMemory).toBe(true)
      expect(read.note).toContain('refresh')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
