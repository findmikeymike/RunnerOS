import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  applySiteContentOperations,
  defaultSiteContent,
  loadSiteContent,
  loadWebsiteManifest,
  saveSiteContent,
  saveWebsiteManifest,
  websiteDistDir,
  websiteExists,
  type SiteContentOperation,
  type WebsiteManifest,
} from '@craft-agent/shared/website'
import { createOutputBundle, readOutputManifest, writeOutputManifest } from '@craft-agent/shared/outputs'
import { OUTPUT_SHOW_IN_CANVAS_TAG } from '@craft-agent/shared/outputs/constants'

export interface WebsiteToolResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export interface WebsiteServiceOrigin {
  sessionId?: string
  agentSlug?: string
  agentName?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
}

function firstExistingPath(candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return resolve(candidate)
  }
  return resolve(candidates.find(Boolean) ?? fallback)
}

function findRepoRoot(startDir: string): string {
  let current = resolve(startDir)
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, 'tools'))) return current
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  return resolve(startDir)
}

/**
 * Locate the bundled site-builder CLI. Mirrors the resolution order used for
 * the other bundled tools in `builtin-sources.ts`.
 */
export function getSiteBuilderPath(): string {
  const resourcesBase = process.env.CRAFT_RESOURCES_BASE
  const appRoot = process.env.CRAFT_APP_ROOT || process.cwd()
  const repoRoot = findRepoRoot(process.cwd())
  return firstExistingPath(
    [
      resourcesBase ? join(resourcesBase, 'tools', 'site-builder') : '',
      join(appRoot, 'tools', 'site-builder'),
      join(repoRoot, 'tools', 'site-builder'),
      join(process.cwd(), 'tools', 'site-builder'),
    ],
    join('tools', 'site-builder'),
  )
}

interface PreviewServer {
  server: Server
  port: number
  dist: string
}

/**
 * Owns everything the website tools do on the host: running the bundled
 * builder, applying structured content edits, and serving previews.
 *
 * Publishing is deliberately absent — deploy adapters land in a later slice
 * and nothing here can reach an external host.
 */
export class WebsiteService {
  private readonly previews = new Map<string, PreviewServer>()

  constructor(private readonly toolPath: string = getSiteBuilderPath()) {}

  private cli(): string {
    return join(this.toolPath, 'bin', 'site.mjs')
  }

  private runBuilder(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [this.cli(), ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_OPTIONS: '' },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += String(chunk) })
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.on('error', error => resolvePromise({ code: -1, stdout, stderr: String(error) }))
      child.on('close', code => resolvePromise({ code: code ?? -1, stdout, stderr }))
    })
  }

  private parseReceipt(stdout: string): Record<string, unknown> | null {
    const start = stdout.indexOf('{')
    if (start === -1) return null
    try {
      return JSON.parse(stdout.slice(start)) as Record<string, unknown>
    } catch {
      return null
    }
  }

  private requireSite(workspaceRootPath: string): WebsiteToolResult | null {
    if (websiteExists(workspaceRootPath)) return null
    return {
      ok: false,
      error: 'No website exists in this workspace yet. Create one first, then edit and build it.',
      mode: 'none',
    }
  }

  // -------------------------------------------------------------------------

  async getManifest(
    workspaceRootPath: string,
    input: { includeHistory?: boolean } = {},
  ): Promise<WebsiteToolResult> {
    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (!manifest) {
      return {
        ok: true,
        mode: 'none',
        exists: false,
        note: 'No website in this workspace yet.',
      }
    }
    const content = loadSiteContent(workspaceRootPath)
    return {
      ok: true,
      exists: true,
      mode: manifest.mode,
      adapter: manifest.adapter,
      urls: manifest.urls,
      domain: manifest.domain,
      external: manifest.external,
      publishPolicy: manifest.publishPolicy,
      capture: { backend: manifest.capture.backend, formIds: manifest.capture.formIds },
      lastBuild: manifest.lastBuild,
      targetApproved: Boolean(manifest.targetApproval),
      counts: content
        ? {
          releases: content.releases.length,
          shows: content.shows.length,
          videos: content.videos.length,
          links: content.links.length,
          press: content.press.length,
          journal: content.journal.length,
          pages: content.pages.length,
        }
        : undefined,
      ...(input.includeHistory ? { history: manifest.history } : {}),
    }
  }

  /**
   * Scaffold `website/` from a starter template. Local files only: this
   * creates nothing on any host and connects no account.
   */
  async create(
    workspaceRootPath: string,
    input: { artistName: string; template?: string },
  ): Promise<WebsiteToolResult> {
    if (websiteExists(workspaceRootPath)) {
      return { ok: false, error: 'A website already exists in this workspace.' }
    }
    const artistName = input.artistName?.trim()
    if (!artistName) return { ok: false, error: 'An artist name is required.' }

    const args = ['init', workspaceRootPath, '--name', artistName]
    if (input.template) args.push('--template', input.template)
    const { code, stdout, stderr } = await this.runBuilder(args)
    const receipt = this.parseReceipt(stdout)
    if (code !== 0 || !receipt || receipt.ok !== true) {
      return { ok: false, error: stderr.trim() || 'Could not scaffold the website.' }
    }
    return {
      ok: true,
      mode: 'managed',
      template: receipt.template,
      note: 'Website scaffolded locally. Edit content, build, then preview. Nothing is published until a host is connected.',
    }
  }

  async setContent(
    workspaceRootPath: string,
    input: { operations: unknown[] },
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const operations = input.operations as SiteContentOperation[]
    if (!Array.isArray(operations) || operations.length === 0) {
      return { ok: false, error: 'No operations supplied.' }
    }

    const current = loadSiteContent(workspaceRootPath) ?? defaultSiteContent('Artist')
    let result
    try {
      result = applySiteContentOperations(current, operations)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    saveSiteContent(workspaceRootPath, result.content)

    return {
      ok: true,
      applied: result.applied,
      changes: result.changes,
      changeClass: result.changeClass,
      note: 'Content saved. Build to render it, then preview to show the artist.',
    }
  }

  async build(
    workspaceRootPath: string,
    _input: { audit?: boolean } = {},
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const { code, stdout, stderr } = await this.runBuilder(['build', workspaceRootPath, '--json'])
    const receipt = this.parseReceipt(stdout)
    if (code !== 0 || !receipt || receipt.ok !== true) {
      return {
        ok: false,
        error: (receipt?.error as string) ?? stderr.trim() ?? 'Build failed.',
      }
    }

    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (manifest) {
      saveWebsiteManifest(workspaceRootPath, {
        ...manifest,
        lastBuild: {
          at: new Date().toISOString(),
          hash: String(receipt.hash),
          auditScore: Number(receipt.auditScore ?? 0),
          warnings: Number(receipt.warnings ?? 0),
          fileCount: Number(receipt.fileCount ?? 0),
          bytes: Number(receipt.bytes ?? 0),
        },
      } satisfies WebsiteManifest)
    }

    return {
      ok: true,
      hash: receipt.hash,
      pages: receipt.pages,
      fileCount: receipt.fileCount,
      bytes: receipt.bytes,
      auditScore: receipt.auditScore,
      warnings: receipt.warnings,
      note: 'Rendered to website/dist. Nothing was published.',
    }
  }

  async audit(
    workspaceRootPath: string,
    input: { url?: string } = {},
  ): Promise<WebsiteToolResult> {
    if (input.url) {
      return {
        ok: false,
        error: 'Auditing a live URL is not available yet. Build the local site and audit that instead.',
      }
    }
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const { code, stdout, stderr } = await this.runBuilder(['audit', workspaceRootPath, '--json'])
    const receipt = this.parseReceipt(stdout)
    if (code !== 0 || !receipt) {
      return { ok: false, error: stderr.trim() || 'Audit failed.' }
    }
    return { ok: true, ...receipt }
  }

  async preview(
    workspaceRootPath: string,
    workspaceId: string,
    input: { build?: boolean } = {},
    origin: WebsiteServiceOrigin = {},
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    if (input.build !== false) {
      const built = await this.build(workspaceRootPath)
      if (!built.ok) return built
    }

    const dist = websiteDistDir(workspaceRootPath)
    if (!existsSync(dist)) {
      return { ok: false, error: 'No build output. Build first.' }
    }

    let preview: PreviewServer
    try {
      preview = await this.ensurePreviewServer(workspaceRootPath, dist)
    } catch (error) {
      return { ok: false, error: `Could not start the preview server: ${error instanceof Error ? error.message : String(error)}` }
    }

    const url = `http://127.0.0.1:${preview.port}/`
    const manifest = loadWebsiteManifest(workspaceRootPath)
    const outputId = randomUUID()

    createOutputBundle(workspaceRootPath, {
      id: outputId,
      workspaceId,
      title: 'Website preview',
      // `web` is a preview mode, not an output kind; the built site is code.
      kind: 'code',
      status: 'draft',
      summary: manifest?.lastBuild
        ? `Local preview · audit ${manifest.lastBuild.auditScore}/100 · ${manifest.lastBuild.fileCount} files`
        : 'Local preview of the artist website.',
      origin: {
        source: 'session',
        sessionId: origin.sessionId,
        agentSlug: origin.agentSlug,
        agentName: origin.agentName,
      },
      links: [{ id: randomUUID(), label: 'Website preview', url, role: 'primary' }],
      tags: [OUTPUT_SHOW_IN_CANVAS_TAG],
    })

    // `web` preview mode is what routes the link into the Visual sidecar frame.
    const created = readOutputManifest(workspaceRootPath, outputId)
    if (created) {
      writeOutputManifest(workspaceRootPath, { ...created, preview: { mode: 'web' } })
    }

    return {
      ok: true,
      url,
      outputId,
      auditScore: manifest?.lastBuild?.auditScore,
      warnings: manifest?.lastBuild?.warnings,
      note: 'Preview is live locally and shown in the canvas. Nothing was published.',
    }
  }

  // -------------------------------------------------------------------------

  private ensurePreviewServer(workspaceRootPath: string, dist: string): Promise<PreviewServer> {
    const existing = this.previews.get(workspaceRootPath)
    if (existing && existing.dist === dist && existing.server.listening) return Promise.resolve(existing)
    if (existing) {
      closeServer(existing.server)
      this.previews.delete(workspaceRootPath)
    }

    const root = resolve(dist)
    const server = createServer((req, res) => {
      const requested = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
      const candidate = resolve(root, `.${requested}`)
      // Contain every request inside the build output.
      if (candidate !== root && !candidate.startsWith(`${root}/`)) {
        res.writeHead(403).end('Forbidden')
        return
      }
      let target = candidate
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html')
      if (!existsSync(target)) {
        const notFound = join(root, '404.html')
        if (existsSync(notFound)) {
          res.writeHead(404, { 'content-type': MIME['.html']! }).end(readFileSync(notFound))
          return
        }
        res.writeHead(404).end('Not found')
        return
      }
      res.writeHead(200, {
        'content-type': MIME[extname(target)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(readFileSync(target))
    })

    return new Promise((resolvePromise, reject) => {
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Preview server did not bind to a port.'))
          return
        }
        const entry: PreviewServer = { server, port: address.port, dist }
        this.previews.set(workspaceRootPath, entry)
        resolvePromise(entry)
      })
    })
  }

  /** Stop every preview server. Called on shutdown. */
  dispose(): void {
    for (const preview of this.previews.values()) closeServer(preview.server)
    this.previews.clear()
  }
}

/**
 * Close a preview server and drop its sockets.
 *
 * `close()` alone only stops new connections; keep-alive sockets from a
 * browser or a fetch stay open and keep the process alive.
 */
function closeServer(server: Server): void {
  const closeable = server as Server & { closeAllConnections?: () => void }
  closeable.closeAllConnections?.()
  server.close()
  server.unref()
}
