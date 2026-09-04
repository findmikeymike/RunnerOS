import type { DeployAdapterId, DeployTarget, WebsiteDomainState } from '@craft-agent/shared/website'

export interface AdapterCredentials {
  /** Scoped API token or OAuth access token for the host. */
  token: string
  accountId?: string
}

export interface AdapterSiteRef {
  siteId: string
  previewSiteId?: string
}

export interface AdapterDeployInput {
  distDir: string
  target: DeployTarget
  /** Build hash from the builder. Carried through to the receipt. */
  buildHash: string
}

export interface AdapterDeployResult {
  deployId: string
  url: string
}

export interface AdapterStatus {
  live: boolean
  url?: string
  lastDeployAt?: string
  domain?: WebsiteDomainState
  /** Plan or quota note worth showing the artist, e.g. a credit ceiling. */
  planNote?: string
}

export interface AdapterCapabilities {
  previewDeploys: boolean
  functions: boolean
  kv: boolean
  /** True when a custom domain can be attached without moving nameservers. */
  externalDns: boolean
}

/**
 * A deploy target the Website Agent can operate without knowing which host it
 * is. Rollback is deliberately NOT part of this interface: it is implemented
 * once, above the adapters, by re-deploying a retained dist snapshot. That
 * keeps rollback identical on every host instead of depending on each one's
 * version API.
 */
export interface SiteDeployAdapter {
  readonly id: DeployAdapterId
  readonly capabilities: AdapterCapabilities
  /** Verify the credential works and the account is usable. */
  verify(): Promise<{ ok: true; accountId?: string } | { ok: false; error: string }>
  createSite(input: { name: string }): Promise<AdapterSiteRef>
  deploy(input: AdapterDeployInput): Promise<AdapterDeployResult>
  status(): Promise<AdapterStatus>
  /**
   * Attach a custom domain. Returns the exact DNS steps when the host cannot
   * complete it alone. Never reports `active` on hope.
   */
  setDomain(domain: string): Promise<WebsiteDomainState>
  checkDomain(domain: string): Promise<WebsiteDomainState>
}

export type FetchLike = (input: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
}) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export class AdapterError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message)
    this.name = 'AdapterError'
  }
}
