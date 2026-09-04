import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSiteContent, loadWebsiteManifest } from '@craft-agent/shared/website'
import { emptyArtistVaultManifest, saveArtistVaultManifest } from '@craft-agent/shared/artist-vault'
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
      await service.preview(root, { workspaceRootPath: root, workspaceId: 'ws-1' }),
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

  test('refuses to enable a dead signup form before capture is connected', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    const result = await service.setContent(root, { operations: [{ op: 'set-signup-enabled', value: true }] })
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('capture connection')
    expect(loadSiteContent(root)?.signup.enabled).toBe(false)
  })

  test('stages an approved Vault image as a hash-bound metadata-free web asset', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    const source = join(root, 'vault', 'visuals', 'cover-art', 'cover.png')
    mkdirSync(join(root, 'vault', 'visuals', 'cover-art'), { recursive: true })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    writeFileSync(source, png)
    const sourceHash = createHash('sha256').update(png).digest('hex')
    const vault = emptyArtistVaultManifest('ws-1')
    vault.assets.push({
      id: 'cover-1', category: 'visuals', kind: 'cover-art', label: 'Cover',
      relativePath: 'vault/visuals/cover-art/cover.png', mimeType: 'image/png',
      sizeBytes: png.length, sha256: sourceHash, source: 'copy', status: 'approved',
      rightsStatus: 'safe-to-use', usableByAgents: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    saveArtistVaultManifest(root, vault)
    await service.setContent(root, {
      operations: [{
        op: 'upsert-release',
        value: { id: 'r1', title: 'Cold Room', type: 'album', date: '2026-08-01', artworkAssetId: 'cover-1', links: {} },
      }],
    })

    const built = await service.build(root)
    expect(built.ok).toBe(true)
    const asset = loadWebsiteManifest(root)?.assets[0]
    expect(asset?.id).toBe('cover-1')
    expect(asset?.path.endsWith('.webp')).toBe(true)
    expect(asset?.source.sha256).toBe(sourceHash)
    expect(existsSync(join(root, 'website', 'dist', asset!.path.startsWith('assets/') ? asset!.path : `assets/${asset!.path}`))).toBe(true)

    vault.assets[0]!.rightsStatus = 'private'
    vault.assets[0]!.usableByAgents = false
    saveArtistVaultManifest(root, vault)
    const afterRevocation = await service.build(root)
    expect(afterRevocation.ok).toBe(false)
    expect(String(afterRevocation.error)).toContain('not approved and safe')
  })

  test('keeps a verified campaign asset snapshot available to later HQ builds', async () => {
    const hqRoot = workspace()
    const campaignRoot = workspace()
    await service.create(hqRoot, { artistName: 'Vera Lane' })
    const source = join(campaignRoot, 'vault', 'visuals', 'cover-art', 'cover.png')
    mkdirSync(join(campaignRoot, 'vault', 'visuals', 'cover-art'), { recursive: true })
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    writeFileSync(source, png)
    const vault = emptyArtistVaultManifest('campaign-1')
    vault.assets.push({
      id: 'campaign-cover', category: 'visuals', kind: 'cover-art', label: 'Campaign Cover',
      relativePath: 'vault/visuals/cover-art/cover.png', mimeType: 'image/png',
      sizeBytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), source: 'copy', status: 'approved',
      rightsStatus: 'safe-to-use', usableByAgents: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })
    saveArtistVaultManifest(campaignRoot, vault)
    await service.setContent(hqRoot, {
      operations: [{
        op: 'upsert-release',
        value: { id: 'r1', title: 'Cold Room', type: 'album', date: '2026-08-01', artworkAssetId: 'campaign-cover', links: {} },
      }],
    })

    expect((await service.build(hqRoot, {}, { workspaceRootPath: campaignRoot })).ok).toBe(true)
    saveArtistVaultManifest(campaignRoot, emptyArtistVaultManifest('campaign-1'))
    expect((await service.build(hqRoot)).ok).toBe(true)
  })

  test('serializes content edits against builds so staged assets and rendered content cannot diverge', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })

    const build = service.build(root)
    const edit = service.setContent(root, {
      operations: [{
        op: 'upsert-release',
        value: { id: 'r1', title: 'Later Edit', type: 'single', date: '2026-09-04', artworkAssetId: 'not-staged-yet', links: {} },
      }],
    })
    const [built, edited] = await Promise.all([build, edit])

    expect(built.ok).toBe(true)
    expect(edited.ok).toBe(true)
    expect(readFileSync(join(root, 'website', 'dist', 'index.html'), 'utf8')).not.toContain('Later Edit')
    const nextBuild = await service.build(root)
    expect(nextBuild.ok).toBe(false)
    expect(String(nextBuild.error)).toContain('not found in the approved Vault or Release Kit')
  })

  test('preview builds, serves the site locally, and records a canvas output', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })

    const preview = await service.preview(root, { workspaceRootPath: root, workspaceId: 'ws-1' }, {}, { sessionId: 'sess-1', agentSlug: 'site-builder' })
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
    const first = await service.preview(root, { workspaceRootPath: root, workspaceId: 'ws-1' })
    const second = await service.preview(root, { workspaceRootPath: root, workspaceId: 'ws-1' })
    expect(second.url).toBe(first.url)
  })

  test('the preview server refuses to serve files outside the build output', async () => {
    const root = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    const preview = await service.preview(root, { workspaceRootPath: root, workspaceId: 'ws-1' })
    const escaped = await fetch(`${String(preview.url)}../content/site.json`)
    expect(escaped.status).not.toBe(200)
    const malformed = await fetch(`${String(preview.url)}%`)
    expect(malformed.status).toBe(400)
    expect((await fetch(String(preview.url))).status).toBe(200)
  })

  test('preview without a rebuild refuses a replaced dist symlink', async () => {
    const root = workspace()
    const outside = workspace()
    await service.create(root, { artistName: 'Vera Lane' })
    expect((await service.build(root)).ok).toBe(true)
    const dist = join(root, 'website', 'dist')
    rmSync(dist, { recursive: true, force: true })
    writeFileSync(join(outside, 'index.html'), '<h1>private</h1>')
    symlinkSync(outside, dist)
    const preview = await service.preview(root, { workspaceRootPath: root, workspaceId: 'ws-1' }, { build: false })
    expect(preview.ok).toBe(false)
    expect(String(preview.error)).toContain('unsafe symbolic link')
  })

  test('records a campaign-requested preview in the campaign workspace, not HQ', async () => {
    const hqRoot = workspace()
    const campaignRoot = workspace()
    await service.create(hqRoot, { artistName: 'Vera Lane' })
    const preview = await service.preview(hqRoot, { workspaceRootPath: campaignRoot, workspaceId: 'campaign-1' })
    expect(preview.ok).toBe(true)
    expect(existsSync(join(campaignRoot, 'outputs', String(preview.outputId), 'output.json'))).toBe(true)
    expect(existsSync(join(hqRoot, 'outputs', String(preview.outputId), 'output.json'))).toBe(false)
  })
})
