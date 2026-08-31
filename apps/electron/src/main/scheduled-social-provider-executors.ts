import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { getSourceCredentialManager, loadAllSources, type LoadedSource } from '@craft-agent/shared/sources'
import type { ScheduledSocialBrowserExecutionInput, ScheduledSocialBrowserExecutionResult } from './scheduled-social-browser-executor'
import { resolveScheduledSocialBrowserMediaPath } from './scheduled-social-browser-executor'
import {
  ScheduledSocialProviderUnavailableError,
  type ScheduledSocialPreparedRoute,
  type ScheduledSocialProviderRoute,
} from './scheduled-social-auto-executor'

interface McpClientLike {
  listTools(): Promise<Array<{ name: string }>>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  close(): Promise<void>
}

type SocialProviderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface ScheduledSocialProviderRuntimeDeps {
  fetch: SocialProviderFetch
  loadSources(workspaceRootPath: string): LoadedSource[]
  getToken(source: LoadedSource): Promise<string | null>
  createMcpClient(config: { transport: 'http'; url: string; headers: Record<string, string> }): McpClientLike
  now(): Date
  sleep(ms: number): Promise<void>
  receiptPollMs: number
  receiptTimeoutMs: number
}

const defaultDeps: ScheduledSocialProviderRuntimeDeps = {
  fetch: globalThis.fetch,
  loadSources: loadAllSources,
  getToken: (source) => getSourceCredentialManager().getToken(source),
  createMcpClient: (config) => new CraftMcpClient(config),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  receiptPollMs: 2_000,
  receiptTimeoutMs: 60_000,
}

export function createScheduledSocialProviderRoutes(
  overrides: Partial<ScheduledSocialProviderRuntimeDeps> = {},
): ScheduledSocialProviderRoute[] {
  const deps = { ...defaultDeps, ...overrides }
  return [
    { provider: 'trypost', prepare: (input) => prepareTryPost(input, deps) },
    { provider: 'postiz', prepare: (input) => preparePostiz(input, deps) },
  ]
}

async function prepareTryPost(
  input: ScheduledSocialBrowserExecutionInput,
  deps: ScheduledSocialProviderRuntimeDeps,
): Promise<ScheduledSocialPreparedRoute | undefined> {
  const source = deps.loadSources(input.workspaceRootPath).find((candidate) => candidate.config.slug === 'trypost' && candidate.config.enabled)
  if (!source?.config.mcp?.url) return undefined
  const token = await deps.getToken(source)
  if (!token) return undefined
  const client = deps.createMcpClient({ transport: 'http', url: source.config.mcp.url, headers: { Authorization: `Bearer ${token}` } })
  try {
    const tools = new Set((await client.listTools()).map((tool) => tool.name))
    for (const required of ['list-social-accounts-tool', 'list-content-types-tool', 'create-post-tool', 'preview-post-tool', 'publish-post-tool', 'get-post-tool']) {
      if (!tools.has(required)) throw new Error(`missing ${required}`)
    }
    const target = resolveProviderTarget(input)
    const accounts = asArray(unwrap(await callMcpJson(client, 'list-social-accounts-tool', {}), ['accounts', 'data']))
    const account = uniqueAccount(accounts, target.platform, target.handle, ['username', 'display_username', 'handle'])
    if (!account) {
      await client.close()
      return undefined
    }
    const mediaPath = resolveScheduledSocialBrowserMediaPath(input.workspaceRootPath, input.order)
    const contentType = tryPostContentType(target.platform, mediaPath)
    if (!contentType) {
      await client.close()
      return undefined
    }
    const catalog = await callMcpJson(client, 'list-content-types-tool', {})
    if (!JSON.stringify(catalog).includes(contentType)) {
      await client.close()
      return undefined
    }
    if (mediaPath && (!tools.has('request-media-upload-tool') || !tools.has('attach-media-from-upload-tool'))) {
      await client.close()
      return undefined
    }
    return {
      provider: 'trypost',
      execute: async () => {
        try {
          return await executeTryPost(input, client, account, contentType, mediaPath, deps)
        } finally {
          await client.close().catch(() => {})
        }
      },
    }
  } catch (error) {
    await client.close().catch(() => {})
    throw new ScheduledSocialProviderUnavailableError(errorMessage(error))
  }
}

async function executeTryPost(
  input: ScheduledSocialBrowserExecutionInput,
  client: McpClientLike,
  account: Record<string, unknown>,
  contentType: string,
  mediaPath: string | undefined,
  deps: ScheduledSocialProviderRuntimeDeps,
): Promise<ScheduledSocialBrowserExecutionResult> {
  const created = await callMcpJson(client, 'create-post-tool', {
    content: input.order.execution.type === 'social-publish' ? input.order.execution.caption : '',
    platforms: [{ social_account_id: stringField(account, 'id'), content_type: contentType, meta: {} }],
  })
  const postId = firstString(created, ['id', 'post_id'], ['post', 'id'])
  if (!postId) throw new Error('TryPost created a draft without returning a post ID.')
  if (mediaPath) {
    const upload = await callMcpJson(client, 'request-media-upload-tool', {})
    const uploadUrl = firstString(upload, ['upload_url'])
    const uploadToken = firstString(upload, ['upload_token'])
    if (!uploadUrl || !uploadToken) throw new Error('TryPost did not return a verifiable upload grant.')
    const form = new FormData()
    form.append('media', new Blob([readFileSync(mediaPath)], { type: mimeFor(mediaPath) }), basename(mediaPath))
    const response = await deps.fetch(uploadUrl, { method: 'POST', body: form })
    if (!response.ok) throw new Error(`TryPost media upload failed (${response.status}).`)
    await callMcpJson(client, 'attach-media-from-upload-tool', { post_id: postId, upload_token: uploadToken })
  }
  await callMcpJson(client, 'preview-post-tool', { post_id: postId })
  await callMcpJson(client, 'publish-post-tool', { post_id: postId })
  const published = await pollTryPostReceipt(client, postId, deps)
  return {
    receiptId: `trypost:${postId}`,
    externalUrl: published.externalUrl,
    summary: `Published through TryPost to ${input.order.execution.type === 'social-publish' ? input.order.execution.platform : 'social'}; provider receipt ${postId} verified.`,
  }
}

async function pollTryPostReceipt(client: McpClientLike, postId: string, deps: ScheduledSocialProviderRuntimeDeps): Promise<{ externalUrl?: string }> {
  const deadline = Date.now() + deps.receiptTimeoutMs
  while (true) {
    const post = await callMcpJson(client, 'get-post-tool', { post_id: postId })
    const status = firstString(post, ['status'], ['post', 'status'])?.toLowerCase()
    if (status === 'failed' || status === 'partially_published') throw new Error(`TryPost reported ${status} for ${postId}.`)
    if (status === 'published') return { externalUrl: findUrl(post) }
    if (Date.now() >= deadline) throw new Error(`TryPost did not confirm publication for ${postId} before the receipt timeout.`)
    await deps.sleep(deps.receiptPollMs)
  }
}

async function preparePostiz(
  input: ScheduledSocialBrowserExecutionInput,
  deps: ScheduledSocialProviderRuntimeDeps,
): Promise<ScheduledSocialPreparedRoute | undefined> {
  const source = deps.loadSources(input.workspaceRootPath).find((candidate) => candidate.config.slug === 'postiz' && candidate.config.enabled)
  if (!source?.config.mcp?.url) return undefined
  const token = await deps.getToken(source)
  if (!token) return undefined
  const target = resolveProviderTarget(input)
  const baseUrl = `${new URL(source.config.mcp.url).origin}/public/v1`
  let integrations: unknown
  try {
    integrations = await fetchJson(deps.fetch, `${baseUrl}/integrations`, token)
  } catch (error) {
    throw new ScheduledSocialProviderUnavailableError(errorMessage(error))
  }
  const integration = uniqueAccount(asArray(integrations), target.platform, target.handle, ['profile'])
  if (!integration || integration.disabled === true) return undefined
  const mediaPath = resolveScheduledSocialBrowserMediaPath(input.workspaceRootPath, input.order)
  if (target.platform === 'instagram' && !mediaPath) return undefined
  if (mediaPath && !postizSupportsMedia(mediaPath)) return undefined
  const settings = postizSettings(target.platform, stringField(integration, 'identifier'), mediaPath)
  if (!settings) return undefined
  return {
    provider: 'postiz',
    execute: () => executePostiz(input, baseUrl, token, integration, settings, mediaPath, deps),
  }
}

async function executePostiz(
  input: ScheduledSocialBrowserExecutionInput,
  baseUrl: string,
  token: string,
  integration: Record<string, unknown>,
  settings: Record<string, unknown>,
  mediaPath: string | undefined,
  deps: ScheduledSocialProviderRuntimeDeps,
): Promise<ScheduledSocialBrowserExecutionResult> {
  let media: Array<{ id: string; path: string }> = []
  if (mediaPath) {
    const form = new FormData()
    form.append('file', new Blob([readFileSync(mediaPath)], { type: mimeFor(mediaPath) }), basename(mediaPath))
    const uploaded = await fetchJson(deps.fetch, `${baseUrl}/upload`, token, { method: 'POST', body: form })
    const id = firstString(uploaded, ['id'])
    const path = firstString(uploaded, ['path'])
    if (!id || !path) throw new Error('Postiz uploaded media without returning its exact asset receipt.')
    media = [{ id, path }]
  }
  const caption = input.order.execution.type === 'social-publish' ? input.order.execution.caption : ''
  const created = await fetchJson(deps.fetch, `${baseUrl}/posts`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'now', date: deps.now().toISOString(), shortLink: false, tags: [],
      posts: [{ integration: { id: stringField(integration, 'id') }, value: [{ content: caption, image: media }], settings }],
    }),
  })
  const row = asArray(created).find(isRecord)
  const postId = row ? firstString(row, ['postId', 'id']) : undefined
  if (!postId) throw new Error('Postiz accepted the publish call without returning a post ID.')
  const externalUrl = await pollPostizReceipt(baseUrl, token, postId, stringField(integration, 'id'), caption, deps)
  return {
    receiptId: `postiz:${postId}`,
    externalUrl,
    summary: `Published through Postiz to ${input.order.execution.type === 'social-publish' ? input.order.execution.platform : 'social'}; provider receipt ${postId} verified.`,
  }
}

async function pollPostizReceipt(
  baseUrl: string,
  token: string,
  postId: string,
  integrationId: string,
  caption: string,
  deps: ScheduledSocialProviderRuntimeDeps,
): Promise<string> {
  const started = deps.now().getTime()
  const startDate = new Date(started - 5 * 60_000).toISOString()
  const endDate = new Date(started + 60 * 60_000).toISOString()
  const deadline = Date.now() + deps.receiptTimeoutMs
  while (true) {
    const response = await fetchJson(deps.fetch, `${baseUrl}/posts?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`, token)
    const posts = asArray(unwrap(response, ['posts']))
    const exactMatch = posts.find((post) => stringField(post, 'id') === postId)
    const fallbackMatches = posts.filter((post) => {
      const integration = recordField(post, 'integration')
      return stringField(integration, 'id') === integrationId
        && stringField(post, 'content') === caption
    })
    const match = exactMatch ?? (fallbackMatches.length === 1 ? fallbackMatches[0] : undefined)
    const url = match ? firstString(match, ['releaseURL', 'releaseUrl']) : undefined
    if (url) return url
    if (Date.now() >= deadline) throw new Error(`Postiz did not return a live publication URL for ${postId} before the receipt timeout.`)
    await deps.sleep(deps.receiptPollMs)
  }
}

function resolveProviderTarget(input: ScheduledSocialBrowserExecutionInput): { platform: string; handle: string } {
  if (input.order.execution.type !== 'social-publish') throw new Error('Scheduled work is not a social publish action.')
  const plan = recordField(input.preview.dryRun, 'browserPlan')
  const verification = recordField(plan, 'accountVerification')
  const expectedHandle = firstString(verification, ['expectedHandle'])
  const expectedAccountUrl = firstString(verification, ['expectedAccountUrl'])
  const urlHandle = expectedAccountUrl ? safeUrlLastSegment(expectedAccountUrl) : undefined
  const handle = normalizeHandle(expectedHandle ?? urlHandle ?? '')
  if (!handle) throw new ScheduledSocialProviderUnavailableError('approved destination has no exact provider-matchable handle')
  return { platform: normalizePlatform(input.order.execution.platform), handle }
}

function uniqueAccount(
  values: unknown[],
  platform: string,
  handle: string,
  handleFields: string[],
): Record<string, unknown> | undefined {
  const matches = values.filter((value): value is Record<string, unknown> => {
    if (!isRecord(value)) return false
    const candidatePlatform = normalizePlatform(firstString(value, ['platform', 'identifier']) ?? '')
    const candidateHandle = normalizeHandle(handleFields.map((field) => stringField(value, field)).find(Boolean) ?? '')
    return candidatePlatform === platform && candidateHandle === handle
      && value.is_active !== false && value.disabled !== true && stringField(value, 'status').toLowerCase() !== 'disconnected'
  })
  return matches.length === 1 ? matches[0] : undefined
}

function tryPostContentType(platform: string, mediaPath?: string): string | undefined {
  if (platform === 'x') return 'x_post'
  if (platform === 'instagram') return mediaPath && isVideo(mediaPath) ? 'instagram_reel' : 'instagram_feed'
  return undefined
}

function postizSettings(platform: string, providerIdentifier: string, mediaPath?: string): Record<string, unknown> | undefined {
  if (platform === 'x') return { __type: 'x', who_can_reply_post: 'everyone' }
  if (platform === 'instagram') {
    const type = providerIdentifier === 'instagram-standalone' ? providerIdentifier : 'instagram'
    return { __type: type, post_type: mediaPath && isVideo(mediaPath) ? 'reel' : 'post' }
  }
  return undefined
}

function postizSupportsMedia(path: string): boolean {
  return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff', '.mp4'].includes(extname(path).toLowerCase())
}

async function callMcpJson(client: McpClientLike, name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = await client.callTool(name, args) as { isError?: boolean; content?: Array<{ type?: string; text?: unknown }> }
  if (response?.isError) throw new Error(`${name} failed: ${mcpText(response)}`)
  const text = mcpText(response)
  if (!text) return response
  try { return JSON.parse(text) } catch { return response }
}

function mcpText(response: { content?: Array<{ type?: string; text?: unknown }> }): string {
  return (response.content ?? []).filter((block) => block.type === 'text').map((block) => typeof block.text === 'string' ? block.text : JSON.stringify(block.text)).join('\n')
}

async function fetchJson(fetcher: SocialProviderFetch, url: string, token: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetcher(url, { ...init, headers: { Authorization: token, ...(init.headers ?? {}) } })
  const text = await response.text()
  if (!response.ok) throw new Error(`Provider request failed (${response.status}): ${text.slice(0, 300)}`)
  try { return JSON.parse(text) } catch { throw new Error('Provider returned a non-JSON response.') }
}

function unwrap(value: unknown, keys: string[]): unknown {
  if (!isRecord(value)) return value
  for (const key of keys) if (value[key] !== undefined) return value[key]
  return value
}

function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function recordField(value: unknown, key: string): Record<string, unknown> { return isRecord(value) && isRecord(value[key]) ? value[key] : {} }
function stringField(value: unknown, key: string): string { return isRecord(value) && typeof value[key] === 'string' ? value[key] as string : '' }
function firstString(value: unknown, direct: string[], nested?: [string, string]): string | undefined {
  for (const key of direct) { const found = stringField(value, key); if (found) return found }
  if (nested) { const found = stringField(recordField(value, nested[0]), nested[1]); if (found) return found }
  return undefined
}
function normalizeHandle(value: string): string { return value.trim().replace(/^@/, '').toLowerCase() }
function normalizePlatform(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'twitter') return 'x'
  if (normalized === 'instagram-standalone') return 'instagram'
  return normalized
}
function safeUrlLastSegment(value: string): string | undefined { try { return new URL(value).pathname.split('/').filter(Boolean).at(-1) } catch { return undefined } }
function isVideo(path: string): boolean { return ['.mp4', '.mov', '.m4v'].includes(extname(path).toLowerCase()) }
function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase()
  if (extension === '.mp4') return 'video/mp4'
  if (extension === '.mov') return 'video/quicktime'
  if (extension === '.png') return 'image/png'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  return 'image/jpeg'
}
function findUrl(value: unknown): string | undefined {
  if (Array.isArray(value)) { for (const item of value) { const found = findUrl(item); if (found) return found } }
  if (isRecord(value)) {
    for (const key of ['platform_url', 'external_url']) { const found = stringField(value, key); if (/^https?:\/\//.test(found)) return found }
    for (const nested of Object.values(value)) { const found = findUrl(nested); if (found) return found }
  }
  return undefined
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
