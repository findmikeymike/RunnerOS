import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSiteContent, loadWebsiteManifest } from '@craft-agent/shared/website'
import { WebsiteService } from './WebsiteService'

const service = new WebsiteService()
const roots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'website-service-'))
  roots.push(root)
  return root
}

afterEach(() => {
  service.dispose()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('WebsiteService', () => {
  test('reports no site before one exists', async () => {
    const result = await service.getManifest(workspace())
    expect(result.ok).toBe(true)
    expect(result.mode).toBe('none')
    expect(result.exists).toBe(false)
  })

  test('refuses to edit, build, or preview before a site exists', async () => {
    const root = workspace()
    for (const result of [
      await service.setContent(root, { operations: [{ op: 'set-signup-enabled', value: true }] }),
      await service.build(root),
      await service.audit(root),
      await service.preview(root, 'ws-1'),
    ]) {
      expect(result.ok).toBe(false)
      expect(String(result.error)).toContain('No website exists')
    }
  })

  test('creates, edits, builds, and audits a site end to end', async () => {
    const root = workspace()

    const created = await service.create(root, { artistName: 'Vera Lane' })
    expect(created.ok).toBe(true)
    expect(existsSync(join(root, 'website', 'site.json'))).toBe(true)
    expect(existsSync(join(root, 'website', 'site', 'home.html'))).toBe(true)

    const edited = await service.setContent(root, {
      operations: [
        { op: 'set-seo', value: { canonicalBase: 'https://veralane.com' } },
        { op: 'set-artist', value: { tagline: 'Songs from a cold room.', bio: { short: 'Quiet.', long: 'A songwriter from Duluth.' } } },
        { op: 'upsert-release', value: { id: 'r1', title: 'Cold Room', type: 'album', date: '2026-08-01', featured: true, links: { spotify: 'https://open.spotify.com/album/x' } } },
        { op: 'upsert-show', value: { id: 's1', date: '2999-11-14', city: 'Minneapolis, MN', venue: '7th St Entry', ticketUrl: 'https://tickets.example.com/1' } },
      ],
    })
    expect(edited.ok).toBe(true)
    expect(edited.applied).toBe(4)
    expect(edited.changeClass).toBe('content-only')
    expect(loadSiteContent(root)?.releases).toHaveLength(1)

    const built = await service.build(root)
    expect(built.ok).toBe(true)
    expect(built.auditScore).toBe(100)
    expect(String(built.hash)).toMatch(/^[a-f0-9]{64}$/)

    // The manifest remembers the build so the UI and routines can compare hashes.
    const manifest = loadWebsiteManifest(root)
    expect(manifest?.lastBuild?.hash).toBe(built.hash as string)
    expect(manifest?.lastBuild?.auditScore).toBe(100)

    const home = readFileSync(join(root, 'website', 'dist', 'index.html'), 'utf8')
    expect(home).toContain('Cold Room')
    expect(home).toContain('7th St Entry')

    const audited = await service.audit(root)
    expect(audited.ok).toBe(true)
    expect(audited.score).toBe(100)
  })

  test('refuses to create a second site in the same workspace', async () => {
    const root = workspace()
    expect((await service.create(root, { artistName: 'Vera Lane' })).ok).toBe(true)
    const again = await service.create(root, { artistName: 'Someone Else' })
    expect(again.ok).toBe(false)
    expect(String(again.error)).toContain('already exists')
    expect(loadSiteContent(root)?.artist.name).toBe('Vera Lane')
  })

  test('surfaces a credential in content as a build failure, not a published page', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    await service.setContent(root, {
      operations: [{ op: 'set-artist', value: { bio: { short: '', long: 'key re_AbCdEf0123456789XyZq' } } }],
    })
    const built = await service.build(root)
    expect(built.ok).toBe(false)
    expect(String(built.error)).toContain('Resend API key')
  })

  test('rejects an empty operation list', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    const result = await service.setContent(root, { operations: [] })
    expect(result.ok).toBe(false)
  })

  test('preview builds, serves the site locally, and records a canvas output', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })

    const preview = await service.preview(root, 'ws-1', {}, { sessionId: 'sess-1', agentSlug: 'site-builder' })
    expect(preview.ok).toBe(true)
    expect(String(preview.url)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(preview.outputId).toBeTruthy()

    const home = await fetch(String(preview.url))
    expect(home.status).toBe(200)
    expect(await home.text()).toContain('Vera Lane')

    // Stylesheet resolves through the same server, so relative paths work.
    const css = await fetch(`${String(preview.url)}styles.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toContain('text/css')

    // Unknown paths fall through to the generated 404 page.
    expect((await fetch(`${String(preview.url)}nope`)).status).toBe(404)

    const manifestPath = join(root, 'outputs', String(preview.outputId), 'output.json')
    expect(existsSync(manifestPath)).toBe(true)
    const output = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(output.preview.mode).toBe('web')
    expect(output.links[0].url).toBe(preview.url)
    expect(output.origin.sessionId).toBe('sess-1')
  })

  test('preview reuses one server across repeated calls', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    const first = await service.preview(root, 'ws-1')
    const second = await service.preview(root, 'ws-1')
    expect(second.url).toBe(first.url)
  })

  test('the preview server refuses to serve files outside the build output', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    const preview = await service.preview(root, 'ws-1')
    const escaped = await fetch(`${String(preview.url)}../content/site.json`)
    expect(escaped.status).not.toBe(200)
  })
})
