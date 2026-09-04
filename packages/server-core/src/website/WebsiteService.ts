import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CloudflareWorkersAdapter } from './adapters/cloudflare'
import type { SiteDeployAdapter } from './adapters/types'
import { publishSite, recentReceipts, rollbackSite, siteHistory, type PublishDeps } from './publish'
import { ResendCaptureSource, type CaptureSource } from './capture-sources'
import {
  applySiteContentOperations,
  computeDesignHash,
  defaultSiteContent,
  describeCapture,
  importCapturedSubscribers,
  isTrustedModeEligible,
  writeChangeReceipt,
  loadSiteContent,
  loadWebsiteManifest,
  saveSiteContent,
  saveWebsiteManifest,
  websiteAssetsDir,
  websiteDistDir,
  websiteExists,
  websiteRoot,
  type ApprovalBinding,
  type ChangeClass,
  type ChangeReceiptOrigin,
  type DeployTarget,
  type SiteContentOperation,
  type WebsiteAssetKind,
  type WebsiteAssetRecord,
  type WebsiteManifest,
} from '@craft-agent/shared/website'
import {
  loadArtistVaultManifest,
  resolveArtistVaultAssetPath,
  type VaultAssetRecord,
} from '@craft-agent/shared/artist-vault'
import {
  getReleaseKitManifestPath,
  loadReleaseKitManifest,
  resolveReleaseKitItemPath,
  type ReleaseKitItem,
} from '@craft-agent/shared/release-kit'
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

export interface WebsitePreviewTarget {
  workspaceRootPath: string
  workspaceId: string
}

export interface WebsiteAssetContext {
  workspaceRootPath: string
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

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])
const BUILDER_TIMEOUT_MS = 60_000
const BUILDER_OUTPUT_LIMIT = 1_000_000

function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function containedAssetPath(root: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '.' || part === '..')) return null
  const base = resolve(root)
  const target = resolve(base, normalized)
  return target.startsWith(`${base}${sep}`) ? target : null
}

function isSafeManagedPath(root: string, candidate: string): boolean {
  const base = resolve(root)
  const target = resolve(candidate)
  if (target !== base && !target.startsWith(`${base}${sep}`)) return false
  if (existsSync(base) && lstatSync(base).isSymbolicLink()) return false
  let current = base
  const relativeParts = target.slice(base.length).split(sep).filter(Boolean)
  for (const part of relativeParts) {
    current = join(current, part)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return false
  }
  return true
}

function isRealFileInside(root: string, path: string): boolean {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) return false
  const realRoot = realpathSync(root)
  const realFile = realpathSync(path)
  return realFile.startsWith(`${realRoot}${sep}`)
}

function referencedAssetIds(content: ReturnType<typeof loadSiteContent>): Set<string> {
  if (!content) return new Set()
  return new Set([
    content.seo.ogImageAssetId,
    ...content.releases.map(item => item.artworkAssetId),
    ...content.videos.map(item => item.assetId),
    ...content.journal.map(item => item.assetId),
    ...content.signup.forms.map(item => item.reward?.assetId),
  ].filter((id): id is string => Boolean(id)))
}

function websiteAssetKind(path: string, mimeType?: string): WebsiteAssetKind {
  if (mimeType?.startsWith('image/') || IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) return 'image'
  if (mimeType?.startsWith('video/')) return 'video'
  if (mimeType?.startsWith('audio/')) return 'audio'
  return 'download'
}

interface ResolvedWebsiteAsset {
  id: string
  path: string
  sha256: string
  mimeType?: string
  sourceKind: WebsiteAssetRecord['source']['kind']
}

function resolveVaultAsset(workspaceRootPath: string, id: string): ResolvedWebsiteAsset | null {
  const asset = loadArtistVaultManifest(workspaceRootPath).assets.find(candidate => candidate.id === id)
  if (!asset) return null
  if (!asset.usableByAgents || !['approved', 'final'].includes(asset.status) || asset.rightsStatus !== 'safe-to-use') {
    throw new Error(`Vault asset is not approved and safe for website use: ${id}`)
  }
  return resolvedVaultRecord(workspaceRootPath, asset)
}

function resolvedVaultRecord(workspaceRootPath: string, asset: VaultAssetRecord): ResolvedWebsiteAsset {
  const path = resolveArtistVaultAssetPath(workspaceRootPath, asset)
  if (!path || !asset.sha256 || !isRealFileInside(workspaceRootPath, path) || hashFile(path) !== asset.sha256) {
    throw new Error(`Vault asset failed integrity verification: ${asset.id}`)
  }
  return { id: asset.id, path, sha256: asset.sha256, mimeType: asset.mimeType, sourceKind: 'vault' }
}

function resolveReleaseKitAsset(workspaceRootPath: string, id: string): ResolvedWebsiteAsset | null {
  const manifestPath = getReleaseKitManifestPath(workspaceRootPath)
  if (!existsSync(manifestPath)) return null
  let identity: { workspaceId?: string; campaignId?: string }
  try {
    identity = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof identity
  } catch {
    throw new Error('Release Kit manifest is invalid.')
  }
  if (!identity.workspaceId || !identity.campaignId) throw new Error('Release Kit manifest identity is missing.')
  const item = loadReleaseKitManifest(workspaceRootPath, identity.workspaceId, identity.campaignId).items.find(candidate => candidate.id === id)
  if (!item) return null
  if (item.status !== 'ready' || item.usage.restrictions.blockedFromUse || item.usage.restrictions.needsRightsClearance || item.usage.restrictions.artistLikenessRestricted) {
    throw new Error(`Release Kit asset is not approved for website use: ${id}`)
  }
  return resolvedReleaseKitRecord(workspaceRootPath, item)
}

function resolvedReleaseKitRecord(workspaceRootPath: string, item: ReleaseKitItem): ResolvedWebsiteAsset {
  const path = resolveReleaseKitItemPath(workspaceRootPath, item.relativePath)
  if (!isRealFileInside(workspaceRootPath, path) || hashFile(path) !== item.sha256) {
    throw new Error(`Release Kit asset failed integrity verification: ${item.id}`)
  }
  return { id: item.id, path, sha256: item.sha256, mimeType: item.mimeType, sourceKind: 'release-kit' }
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
  private readonly operationTails = new Map<string, Promise<void>>()

  constructor(private readonly toolPath: string = getSiteBuilderPath()) {}

  private async withWebsiteLock<T>(workspaceRootPath: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(workspaceRootPath)
    const previous = this.operationTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolveGate => { release = resolveGate })
    const tail = previous.catch(() => undefined).then(() => gate)
    this.operationTails.set(key, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.operationTails.get(key) === tail) this.operationTails.delete(key)
    }
  }

  private cli(): string {
    return join(this.toolPath, 'bin', 'site.mjs')
  }

  private runBuilder(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn(process.execPath, [this.cli(), ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '' },
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let timedOut = false
      const append = (current: string, chunk: unknown): string => `${current}${String(chunk)}`.slice(-BUILDER_OUTPUT_LIMIT)
      const finish = (result: { code: number; stdout: string; stderr: string }) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolvePromise(result)
      }
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, BUILDER_TIMEOUT_MS)
      child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
      child.on('error', error => finish({ code: -1, stdout, stderr: String(error) }))
      child.on('close', code => finish({
        code: timedOut ? -1 : (code ?? -1),
        stdout,
        stderr: timedOut ? `${stderr}\nWebsite builder timed out after 60 seconds.`.trim() : stderr,
      }))
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
    const managedRoot = websiteRoot(workspaceRootPath)
    const manifestPath = join(managedRoot, 'site.json')
    if (websiteExists(workspaceRootPath)) {
      if (!isSafeManagedPath(workspaceRootPath, manifestPath)) {
        return { ok: false, error: 'The website folder contains an unsafe symbolic link.', mode: 'none' }
      }
      return null
    }
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
    if (websiteExists(workspaceRootPath)) {
      const unsafe = this.requireSite(workspaceRootPath)
      if (unsafe) return unsafe
    }
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
    return this.withWebsiteLock(workspaceRootPath, () => this.createUnlocked(workspaceRootPath, input))
  }

  private async createUnlocked(
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
    return this.withWebsiteLock(workspaceRootPath, () => this.setContentUnlocked(workspaceRootPath, input))
  }

  private async setContentUnlocked(
    workspaceRootPath: string,
    input: { operations: unknown[] },
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing
    if (!isSafeManagedPath(workspaceRootPath, join(websiteRoot(workspaceRootPath), 'content', 'site.json'))) {
      return { ok: false, error: 'The website content path contains an unsafe symbolic link.' }
    }

    const operations = input.operations as SiteContentOperation[]
    if (!Array.isArray(operations) || operations.length === 0) {
      return { ok: false, error: 'No operations supplied.' }
    }
    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (operations.some(operation => operation.op === 'set-signup-enabled' && operation.value === true) && manifest?.capture.backend === 'none') {
      return {
        ok: false,
        error: 'Signup cannot be enabled until a capture connection is configured. The site will not show a dead form.',
      }
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

  private async stageReferencedAssets(
    websiteWorkspaceRootPath: string,
    assetContext: WebsiteAssetContext = { workspaceRootPath: websiteWorkspaceRootPath },
  ): Promise<void> {
    const managedRoot = websiteRoot(websiteWorkspaceRootPath)
    if (!isSafeManagedPath(websiteWorkspaceRootPath, join(managedRoot, 'content', 'site.json'))) {
      throw new Error('The website content path contains an unsafe symbolic link.')
    }
    const content = loadSiteContent(websiteWorkspaceRootPath)
    const manifest = loadWebsiteManifest(websiteWorkspaceRootPath)
    if (!content || !manifest) return

    const ids = referencedAssetIds(content)
    const assetsRoot = websiteAssetsDir(websiteWorkspaceRootPath)
    if (existsSync(managedRoot) && lstatSync(managedRoot).isSymbolicLink()) throw new Error('website/ cannot be a symbolic link.')
    if (existsSync(assetsRoot) && lstatSync(assetsRoot).isSymbolicLink()) throw new Error('website/assets cannot be a symbolic link.')
    const existingById = new Map((manifest.assets ?? []).map(asset => [asset.id, asset]))
    const staged: WebsiteAssetRecord[] = []
    if (!isSafeManagedPath(websiteWorkspaceRootPath, join(assetsRoot, 'files'))) throw new Error('website/assets contains an unsafe symbolic link.')
    mkdirSync(join(assetsRoot, 'files'), { recursive: true })
    if (!realpathSync(assetsRoot).startsWith(`${realpathSync(managedRoot)}${sep}`)) throw new Error('website/assets escapes website/.')

    for (const id of [...ids].sort()) {
      const existing = existingById.get(id)
      const existingPath = existing ? containedAssetPath(assetsRoot, existing.path) : null
      const existingIsValid = Boolean(
        existing
        && existingPath
        && existsSync(existingPath)
        && !lstatSync(existingPath).isSymbolicLink()
        && statSync(existingPath).isFile()
        && hashFile(existingPath) === existing.sha256,
      )
      const contextDiffers = assetContext.workspaceRootPath !== websiteWorkspaceRootPath
      const resolved = contextDiffers
        ? resolveReleaseKitAsset(assetContext.workspaceRootPath, id)
          ?? resolveVaultAsset(assetContext.workspaceRootPath, id)
          ?? resolveVaultAsset(websiteWorkspaceRootPath, id)
          ?? resolveReleaseKitAsset(websiteWorkspaceRootPath, id)
        : resolveVaultAsset(websiteWorkspaceRootPath, id)
          ?? resolveReleaseKitAsset(websiteWorkspaceRootPath, id)
      if (!resolved) {
        if (existing && existingIsValid) {
          staged.push(existing)
          continue
        }
        throw new Error(`Website asset was not found in the approved Vault or Release Kit: ${id}`)
      }
      if (
        existing
        && existing.source.kind === resolved.sourceKind
        && existing.source.id === resolved.id
        && existing.source.sha256 === resolved.sha256
        && existingIsValid
      ) {
        staged.push(existing)
        continue
      }

      const kind = websiteAssetKind(resolved.path, resolved.mimeType)
      const key = createHash('sha256').update(id).digest('hex').slice(0, 16)
      const sourceExtension = extname(resolved.path).toLowerCase()
      const outputExtension = kind === 'image' ? '.webp' : sourceExtension
      if (!outputExtension) throw new Error(`Website asset has no supported file extension: ${id}`)
      const relativePath = `files/${key}-${resolved.sha256.slice(0, 12)}${outputExtension}`
      const target = containedAssetPath(assetsRoot, relativePath)
      if (!target) throw new Error(`Could not create a safe staged path for website asset: ${id}`)
      const temp = `${target}.tmp-${process.pid}-${randomUUID()}`

      try {
        if (kind === 'image') {
          await sharp(resolved.path, { animated: sourceExtension === '.gif', failOn: 'error', limitInputPixels: 100_000_000 })
            .rotate()
            .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 84, effort: 4 })
            .toFile(temp)
        } else {
          writeFileSync(temp, readFileSync(resolved.path))
        }
        renameSync(temp, target)
      } catch (error) {
        rmSync(temp, { force: true })
        throw new Error(`Could not prepare website asset ${id}: ${error instanceof Error ? error.message : String(error)}`)
      }

      staged.push({
        id,
        path: relativePath,
        sha256: hashFile(target),
        kind,
        mimeType: kind === 'image' ? 'image/webp' : resolved.mimeType,
        source: { kind: resolved.sourceKind, id: resolved.id, sha256: resolved.sha256 },
      })
    }

    saveWebsiteManifest(websiteWorkspaceRootPath, { ...manifest, assets: staged })
  }

  async build(
    workspaceRootPath: string,
    _input: { audit?: boolean } = {},
    assetContext: WebsiteAssetContext = { workspaceRootPath },
  ): Promise<WebsiteToolResult> {
    return this.withWebsiteLock(workspaceRootPath, () => this.buildUnlocked(workspaceRootPath, _input, assetContext))
  }

  private async buildUnlocked(
    workspaceRootPath: string,
    _input: { audit?: boolean } = {},
    assetContext: WebsiteAssetContext = { workspaceRootPath },
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    try {
      await this.stageReferencedAssets(workspaceRootPath, assetContext)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

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
          // Recorded at build time so publish can classify the change without
          // trusting the caller to say whether templates moved.
          designHash: computeDesignHash(workspaceRootPath),
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
    _input: object = {},
  ): Promise<WebsiteToolResult> {
    return this.withWebsiteLock(workspaceRootPath, () => this.auditUnlocked(workspaceRootPath, _input))
  }

  private async auditUnlocked(
    workspaceRootPath: string,
    _input: object = {},
  ): Promise<WebsiteToolResult> {
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
    target: WebsitePreviewTarget,
    input: { build?: boolean } = {},
    origin: WebsiteServiceOrigin = {},
    assetContext: WebsiteAssetContext = { workspaceRootPath },
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    if (input.build !== false) {
      const built = await this.build(workspaceRootPath, {}, assetContext)
      if (!built.ok) return built
    }

    const dist = websiteDistDir(workspaceRootPath)
    if (!existsSync(dist)) {
      return { ok: false, error: 'No build output. Build first.' }
    }
    if (!isSafeManagedPath(workspaceRootPath, dist)) {
      return { ok: false, error: 'The website preview path contains an unsafe symbolic link.' }
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

    createOutputBundle(target.workspaceRootPath, {
      id: outputId,
      workspaceId: target.workspaceId,
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
    const created = readOutputManifest(target.workspaceRootPath, outputId)
    if (created) {
      writeOutputManifest(target.workspaceRootPath, { ...created, preview: { mode: 'web' } })
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

    const root = realpathSync(dist)
    const server = createServer((req, res) => {
      let requested: string
      try {
        requested = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
      } catch {
        res.writeHead(400).end('Bad request')
        return
      }
      const candidate = resolve(root, `.${requested}`)
      // Contain every request inside the build output.
      if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
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
      if (lstatSync(target).isSymbolicLink() || !realpathSync(target).startsWith(`${root}${sep}`)) {
        res.writeHead(403).end('Forbidden')
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

  // -------------------------------------------------------------------------
  // Publishing (spec 41 Slice A)
  // -------------------------------------------------------------------------

  /**
   * Build the configured deploy adapter from stored credentials.
   *
   * Credentials live in the encrypted user-secret store, never in the
   * website folder, and are read at call time so a rotated token takes
   * effect without a restart.
   */
  private async resolveAdapter(manifest: WebsiteManifest): Promise<SiteDeployAdapter> {
    const adapterId = manifest.adapter
    if (!adapterId) {
      throw new Error('No host is connected yet. Connect one in Settings before publishing.')
    }
    if (adapterId !== 'cloudflare-workers') {
      throw new Error(`The ${adapterId} adapter is not available yet.`)
    }

    const credentials = getCredentialManager()
    const [token, accountId] = await Promise.all([
      credentials.getUserSecret('CLOUDFLARE_API_TOKEN'),
      credentials.getUserSecret('CLOUDFLARE_ACCOUNT_ID'),
    ])
    if (!token) throw new Error('Save CLOUDFLARE_API_TOKEN in Settings before publishing.')

    const resolvedAccount = manifest.provider?.accountId ?? accountId
    if (!resolvedAccount) throw new Error('Save CLOUDFLARE_ACCOUNT_ID in Settings before publishing.')

    const scriptName = manifest.provider?.siteId
    if (!scriptName) throw new Error('This site has no host project yet. Connect a host first.')

    return new CloudflareWorkersAdapter({
      token,
      accountId: resolvedAccount,
      scriptName,
      zoneId: manifest.domain?.state === 'active' ? manifest.provider?.kvNamespaceId : undefined,
    })
  }

  private publishDeps(machineId: string): PublishDeps {
    return { resolveAdapter: manifest => this.resolveAdapter(manifest), machineId }
  }

  /**
   * Publish the current build.
   *
   * Preview is free and is how a change gets seen. Production is the one
   * place a human decision is required, and this refuses rather than asks:
   * the approval is recorded by the UI, not by the agent calling this.
   */
  async deploy(
    workspaceRootPath: string,
    input: {
      target?: DeployTarget
      buildHash?: string
      changeClass?: ChangeClass
      summary?: string
      why?: string[]
      changes?: string[]
      previewOutputId?: string
    },
    context: { machineId: string; origin: ChangeReceiptOrigin; approval?: ApprovalBinding },
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (!manifest) return { ok: false, error: 'No website in this workspace yet.' }

    const buildHash = input.buildHash ?? manifest.lastBuild?.hash
    if (!buildHash) return { ok: false, error: 'Build the site before publishing.' }

    try {
      const result = await publishSite(workspaceRootPath, {
        target: input.target ?? 'preview',
        buildHash,
        changeClass: input.changeClass ?? 'content-only',
        approval: context.approval,
        origin: context.origin,
        summary: input.summary ?? 'Published the site.',
        why: input.why,
        changes: input.changes,
        previewOutputId: input.previewOutputId,
      }, this.publishDeps(context.machineId))

      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          ...(result.needsApproval ? { needsApproval: true, failure: result.failure } : { failure: result.failure }),
        }
      }
      return {
        ok: true,
        deployId: result.deployId,
        url: result.url,
        target: result.target,
        approvalTier: result.tier,
        receiptId: result.receiptId,
        ...(result.trustedModeOffered ? { trustedModeOffered: true } : {}),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async rollback(
    workspaceRootPath: string,
    input: { deployId?: string; reason?: string },
    context: { machineId: string; origin: ChangeReceiptOrigin },
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing
    try {
      const result = await rollbackSite(
        workspaceRootPath,
        { deployId: input.deployId, reason: input.reason, origin: context.origin },
        this.publishDeps(context.machineId),
      )
      return result.ok
        ? {
          ok: true,
          deployId: result.deployId,
          url: result.url,
          receiptId: result.receiptId,
          trustedModeRevoked: result.trustedModeRevoked,
        }
        : { ok: false, error: result.error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async history(workspaceRootPath: string, input: { limit?: number } = {}): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
    return {
      ok: true,
      deploys: siteHistory(workspaceRootPath, limit),
      receipts: recentReceipts(workspaceRootPath, limit).map(receipt => ({
        id: receipt.id,
        kind: receipt.kind,
        at: receipt.at,
        summary: receipt.summary,
        approvalTier: receipt.approval.tier,
        rollback: receipt.rollback,
      })),
    }
  }

  /** Manifest state plus a live check of what is actually being served. */
  async status(workspaceRootPath: string): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (!manifest) return { ok: false, error: 'No website in this workspace yet.' }

    const live = manifest.history.find(entry => entry.target === 'production' && entry.status === 'live')
    const base = {
      ok: true as const,
      mode: manifest.mode,
      adapter: manifest.adapter,
      urls: manifest.urls,
      domain: manifest.domain,
      lastBuild: manifest.lastBuild,
      publishPolicy: manifest.publishPolicy,
      trustedModeEligible: isTrustedModeEligible(manifest),
      targetApproved: Boolean(manifest.targetApproval),
      liveDeploy: live ? { id: live.id, at: live.at, url: live.url, buildHash: live.buildHash } : undefined,
    }

    if (!manifest.adapter || !live) return { ...base, live: false }

    try {
      const adapter = await this.resolveAdapter(manifest)
      const hostStatus = await adapter.status()
      return { ...base, live: hostStatus.live, hostUrl: hostStatus.url, lastDeployAt: hostStatus.lastDeployAt }
    } catch (error) {
      // A missing credential must not make the page look broken.
      return { ...base, live: false, hostError: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Drain the capture door into Community.
   *
   * Runs unattended: importing a fan who asked to hear from the artist needs
   * no approval. It is bounded per pass and resumes from a cursor so a large
   * backlog arrives over several runs instead of one long stall.
   */
  async syncCapture(
    workspaceRootPath: string,
    context: { machineId: string; origin: ChangeReceiptOrigin },
    options: { limit?: number; source?: CaptureSource } = {},
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (!manifest) return { ok: false, error: 'No website in this workspace yet.' }

    if (manifest.capture.backend === 'none') {
      return { ok: true, imported: 0, note: 'No capture backend is connected, so there is nothing to drain.' }
    }

    let source = options.source
    if (!source) {
      if (manifest.capture.backend !== 'resend') {
        return { ok: false, error: `The ${manifest.capture.backend} capture backend is not available yet.` }
      }
      const apiKey = await getCredentialManager().getUserSecret('RESEND_API_KEY')
      if (!apiKey) return { ok: false, error: 'Save RESEND_API_KEY in Settings before draining signups.' }
      source = new ResendCaptureSource({ apiKey })
    }

    try {
      const fetched = await source.fetchSince(manifest.capture.drainCursor, options.limit ?? 100)
      const result = importCapturedSubscribers(
        workspaceRootPath,
        context.machineId,
        fetched.subscribers,
      )

      const at = new Date().toISOString()
      saveWebsiteManifest(workspaceRootPath, {
        ...manifest,
        capture: {
          ...manifest.capture,
          lastDrainAt: at,
          // Hold the old cursor when a page ends, so the next run resumes here.
          drainCursor: fetched.cursor ?? manifest.capture.drainCursor,
        },
      })

      let receiptId: string | undefined
      if (result.imported > 0 || result.skippedSuppressed > 0) {
        receiptId = writeChangeReceipt(workspaceRootPath, context.machineId, {
          kind: 'subscriber-import',
          origin: context.origin,
          approval: { tier: 'free', boundTo: '' },
          summary: describeCapture(result),
          why: ['Fans signed up through the site.'],
          changes: result.changes,
          counts: {
            imported: result.imported,
            duplicates: result.duplicates,
            skippedSuppressed: result.skippedSuppressed,
          },
        }, { now: at }).id
      }

      return {
        ok: true,
        imported: result.imported,
        duplicates: result.duplicates,
        skippedSuppressed: result.skippedSuppressed,
        invalid: result.invalid,
        summary: describeCapture(result),
        hasMore: Boolean(fetched.cursor),
        receiptId,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Point a domain the artist owns at their Artist OS site.
   *
   * The existing DNS is read and recorded *before* any instruction is shown,
   * because this is the one destructive act in the loop: whatever the domain
   * pointed at before stops being reachable there. The receipt is the way
   * back.
   */
  async setDomain(
    workspaceRootPath: string,
    input: { domain: string },
    context: { machineId: string; origin: ChangeReceiptOrigin },
    options: { resolveDns?: (domain: string) => Promise<string[]> } = {},
  ): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const domain = input.domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return { ok: false, error: `That does not look like a domain: ${input.domain}` }
    }

    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (!manifest) return { ok: false, error: 'No website in this workspace yet.' }

    // Capture what the domain resolves to today, before anything changes.
    const previousDns = await (options.resolveDns ?? resolveDomainRecords)(domain).catch(() => [])

    try {
      const adapter = await this.resolveAdapter(manifest)
      const state = await adapter.setDomain(domain)

      saveWebsiteManifest(workspaceRootPath, { ...manifest, domain: state })

      const receipt = writeChangeReceipt(workspaceRootPath, context.machineId, {
        kind: 'domain-cutover',
        origin: context.origin,
        approval: {
          tier: 'one-click',
          approvedAt: new Date().toISOString(),
          approvedBy: 'user',
          boundTo: domain,
        },
        summary: state.state === 'active'
          ? `Pointed ${domain} at the Artist OS site.`
          : `Started pointing ${domain} at the Artist OS site.`,
        why: ['The artist connected their own domain.'],
        changes: [`Domain ${domain} is now ${state.state}`],
        before: { dns: previousDns },
        after: { url: `https://${domain}` },
        rollback: previousDns.length > 0
          ? {
            kind: 'dns-steps',
            steps: [
              `At the registrar for ${domain}, restore these records:`,
              ...previousDns,
            ],
          }
          : { kind: 'none' },
      })

      return { ok: true, domain: state, receiptId: receipt.id, previousDns, steps: state.steps }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Re-check a domain. Never claims active on hope; the host decides. */
  async checkDomain(workspaceRootPath: string): Promise<WebsiteToolResult> {
    const missing = this.requireSite(workspaceRootPath)
    if (missing) return missing

    const manifest = loadWebsiteManifest(workspaceRootPath)
    if (!manifest) return { ok: false, error: 'No website in this workspace yet.' }
    if (!manifest.domain) return { ok: true, domain: undefined, note: 'No domain is connected yet.' }

    try {
      const adapter = await this.resolveAdapter(manifest)
      const state = await adapter.checkDomain(manifest.domain.name)
      saveWebsiteManifest(workspaceRootPath, { ...manifest, domain: state })
      return { ok: true, domain: state }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Stop every preview server. Called on shutdown. */
  dispose(): void {
    for (const preview of this.previews.values()) closeServer(preview.server)
    this.previews.clear()
  }
}

/**
 * What a domain resolves to right now.
 *
 * Recorded before a cutover so the receipt can tell the artist exactly what
 * to restore if they change their mind. Failures are not fatal: an
 * unregistered or unreachable domain simply has nothing to preserve.
 */
async function resolveDomainRecords(domain: string): Promise<string[]> {
  const dns = await import('node:dns/promises')
  const records: string[] = []
  await Promise.all([
    dns.resolveNs(domain).then(
      values => { for (const value of values) records.push(`NS ${value}`) },
      () => undefined,
    ),
    dns.resolve4(domain).then(
      values => { for (const value of values) records.push(`A ${value}`) },
      () => undefined,
    ),
    dns.resolveCname(domain).then(
      values => { for (const value of values) records.push(`CNAME ${value}`) },
      () => undefined,
    ),
  ])
  return records.sort()
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
