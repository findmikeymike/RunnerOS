import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import type { WebsiteDomainState } from '@craft-agent/shared/website'
import {
  AdapterError,
  type AdapterCapabilities,
  type AdapterDeployInput,
  type AdapterDeployResult,
  type AdapterSiteRef,
  type AdapterStatus,
  type FetchLike,
  type SiteDeployAdapter,
} from './types'

const API = 'https://api.cloudflare.com/client/v4'

/**
 * Cloudflare pins the compatibility date at deploy time so a later platform
 * change cannot alter how an already-published site behaves.
 */
const COMPATIBILITY_DATE = '2026-09-01'

/** Cloudflare's documented manifest hash: sha256 over base64(content)+ext, first 32 hex chars. */
export function assetHash(contents: Buffer, filePath: string): string {
  return createHash('sha256')
    .update(contents.toString('base64') + extname(filePath))
    .digest('hex')
    .slice(0, 32)
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

export interface CloudflareManifestEntry {
  hash: string
  size: number
}

export function buildAssetManifest(distDir: string): {
  manifest: Record<string, CloudflareManifestEntry>
  byHash: Map<string, { path: string; contents: Buffer }>
} {
  const manifest: Record<string, CloudflareManifestEntry> = {}
  const byHash = new Map<string, { path: string; contents: Buffer }>()

  for (const file of walk(distDir)) {
    const contents = readFileSync(file)
    const key = `/${relative(distDir, file).replaceAll('\\', '/')}`
    const hash = assetHash(contents, file)
    manifest[key] = { hash, size: contents.byteLength }
    // Two paths with identical bytes and extension share a hash; upload once.
    if (!byHash.has(hash)) byHash.set(hash, { path: key, contents })
  }
  return { manifest, byHash }
}

interface CloudflareEnvelope<T> {
  success?: boolean
  result?: T
  errors?: Array<{ code?: number; message?: string }>
}

export interface CloudflareAdapterOptions {
  token: string
  accountId: string
  scriptName: string
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: FetchLike
  /** Zone id, required only for custom domains. */
  zoneId?: string
}

export class CloudflareWorkersAdapter implements SiteDeployAdapter {
  readonly id = 'cloudflare-workers' as const
  readonly capabilities: AdapterCapabilities = {
    previewDeploys: true,
    functions: true,
    kv: true,
    // A Workers custom domain requires the zone on Cloudflare, so the artist
    // must move nameservers. Netlify does not. The Website Agent reads this
    // to decide which guidance to give.
    externalDns: false,
  }

  private readonly fetchImpl: FetchLike

  constructor(private readonly options: CloudflareAdapterOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as never)
  }

  private scriptFor(target: AdapterDeployInput['target']): string {
    return target === 'production' ? this.options.scriptName : `${this.options.scriptName}-preview`
  }

  private async call<T>(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
    token = this.options.token,
  ): Promise<T> {
    const response = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    })
    const payload = await response.json().catch(() => undefined) as CloudflareEnvelope<T> | undefined

    if (!response.ok || payload?.success === false) {
      const detail = payload?.errors?.map(error => error.message).filter(Boolean).join('; ')
      // 429 and 5xx are worth another attempt; a 403 on a scoped token is not.
      throw new AdapterError(
        detail || `Cloudflare request failed (${response.status})`,
        response.status === 429 || response.status >= 500,
      )
    }
    if (payload?.result === undefined) {
      throw new AdapterError('Cloudflare returned no result body.')
    }
    return payload.result
  }

  async verify(): Promise<{ ok: true; accountId?: string } | { ok: false; error: string }> {
    try {
      await this.call<unknown>(`/accounts/${this.options.accountId}/workers/scripts`)
      return { ok: true, accountId: this.options.accountId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        error: `${message} Check the token has Workers Scripts Write on this account.`,
      }
    }
  }

  async createSite(input: { name: string }): Promise<AdapterSiteRef> {
    // Workers scripts are created by the first deploy, so there is nothing to
    // reserve here. Normalizing the name now keeps the id stable later.
    const siteId = input.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54)
    if (!siteId) throw new AdapterError('Site name produced an empty script name.')
    return { siteId, previewSiteId: `${siteId}-preview` }
  }

  async deploy(input: AdapterDeployInput): Promise<AdapterDeployResult> {
    const script = this.scriptFor(input.target)
    const { manifest, byHash } = buildAssetManifest(input.distDir)
    if (Object.keys(manifest).length === 0) {
      throw new AdapterError('Refusing to deploy an empty build.')
    }

    const session = await this.call<{ jwt?: string; buckets?: string[][] }>(
      `/accounts/${this.options.accountId}/workers/scripts/${script}/assets-upload-session`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
      },
    )

    // No jwt means every asset was already stored from a previous deploy.
    let completionToken = session.jwt
    const buckets = session.buckets ?? []

    for (const bucket of buckets) {
      if (bucket.length === 0) continue
      if (!session.jwt) throw new AdapterError('Cloudflare asked for uploads without an upload token.')

      const form = new FormData()
      for (const hash of bucket) {
        const asset = byHash.get(hash)
        if (!asset) throw new AdapterError(`Cloudflare asked for an unknown asset hash: ${hash}`)
        form.append(
          hash,
          new Blob([asset.contents.toString('base64')], { type: contentType(asset.path) }),
          hash,
        )
      }

      const uploaded = await this.call<{ jwt?: string }>(
        `/accounts/${this.options.accountId}/workers/assets/upload?base64=true`,
        { method: 'POST', body: form },
        session.jwt,
      )
      // The last bucket's response carries the completion token.
      if (uploaded.jwt) completionToken = uploaded.jwt
    }

    if (!completionToken) {
      throw new AdapterError('Cloudflare did not return an asset completion token.')
    }

    const metadata = {
      compatibility_date: COMPATIBILITY_DATE,
      assets: {
        jwt: completionToken,
        config: { html_handling: 'auto-trailing-slash', not_found_handling: '404-page' },
      },
    }

    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))

    const result = await this.call<{ id?: string; etag?: string; startup_time_ms?: number }>(
      `/accounts/${this.options.accountId}/workers/scripts/${script}`,
      { method: 'PUT', body: form },
    )

    return {
      deployId: result.id ?? result.etag ?? `${script}-${input.buildHash.slice(0, 12)}`,
      url: `https://${script}.workers.dev`,
    }
  }

  async status(): Promise<AdapterStatus> {
    try {
      const script = await this.call<{ modified_on?: string }>(
        `/accounts/${this.options.accountId}/workers/scripts/${this.options.scriptName}`,
      )
      return {
        live: true,
        url: `https://${this.options.scriptName}.workers.dev`,
        lastDeployAt: script.modified_on,
      }
    } catch {
      return { live: false }
    }
  }

  async setDomain(domain: string): Promise<WebsiteDomainState> {
    if (!this.options.zoneId) {
      return {
        name: domain,
        state: 'pending-dns',
        checkedAt: new Date().toISOString(),
        steps: [
          `Add ${domain} to Cloudflare as a site (Websites → Add a site).`,
          'Cloudflare will give you two nameservers.',
          'At your registrar, replace the current nameservers with those two.',
          'Nameserver changes usually finish within an hour, sometimes up to 24.',
          'Come back and press Check so Artist OS can confirm and attach it.',
        ],
      }
    }
    try {
      await this.call<unknown>(
        `/accounts/${this.options.accountId}/workers/domains/records`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            environment: 'production',
            hostname: domain,
            service: this.options.scriptName,
            zone_id: this.options.zoneId,
          }),
        },
      )
      return { name: domain, state: 'active', checkedAt: new Date().toISOString() }
    } catch (error) {
      return {
        name: domain,
        state: 'error',
        checkedAt: new Date().toISOString(),
        steps: [error instanceof Error ? error.message : String(error)],
      }
    }
  }

  async checkDomain(domain: string): Promise<WebsiteDomainState> {
    try {
      const domains = await this.call<Array<{ hostname?: string }>>(
        `/accounts/${this.options.accountId}/workers/domains/records`,
      )
      const attached = Array.isArray(domains) && domains.some(entry => entry.hostname === domain)
      return {
        name: domain,
        state: attached ? 'active' : 'pending-dns',
        checkedAt: new Date().toISOString(),
      }
    } catch {
      return { name: domain, state: 'pending-dns', checkedAt: new Date().toISOString() }
    }
  }
}

function contentType(path: string): string {
  const map: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.txt': 'text/plain',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }
  return map[extname(path).toLowerCase()] ?? 'application/octet-stream'
}
