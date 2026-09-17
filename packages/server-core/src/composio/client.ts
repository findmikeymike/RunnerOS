const API_BASE = 'https://backend.composio.dev/api/v3.1'
const MAX_RESPONSE_BYTES = 2_000_000
export const GMAIL_TOOLS = {
  search: 'GMAIL_FETCH_EMAILS',
  read: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
  draft: 'GMAIL_CREATE_EMAIL_DRAFT',
  send: 'GMAIL_SEND_EMAIL',
} as const
const ALLOWED_TOOLS = [...Object.values(GMAIL_TOOLS), 'GMAIL_GET_PROFILE']

export class ComposioApiError extends Error {
  constructor(message: string, readonly status?: number, readonly uncertain = false) {
    super(message)
    this.name = 'ComposioApiError'
  }
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/** Connect hosts documented by Composio; never pass arbitrary provider URLs to shell.openExternal. */
export function validateConnectUrl(value: unknown): string {
  if (typeof value !== 'string') throw new ComposioApiError('Composio did not return a connection link.')
  let url: URL
  try { url = new URL(value) } catch { throw new ComposioApiError('Composio returned an invalid connection link.') }
  if (url.protocol !== 'https:' || !['connect.composio.dev', 'app.composio.dev'].includes(url.hostname)
    || url.username || url.password || url.port || !/^\/link\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    throw new ComposioApiError('Composio returned an unsupported connection link.')
  }
  return url.href
}

function remoteId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new ComposioApiError(`Composio returned an invalid ${label}.`)
  }
  return value
}

export class ComposioClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  private async request(key: string, path: string, method = 'GET', body?: unknown, write = false): Promise<Record<string, unknown>> {
    let response: Response
    try {
      response = await this.fetcher(`${API_BASE}${path}`, {
        method, headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new ComposioApiError(write
        ? 'Composio did not confirm the result. Check Gmail before trying again.'
        : 'Could not reach Composio. Check your connection and try again.', undefined, write)
    }
    if (!response.ok) {
      const message = response.status === 401 ? 'The Composio API key is invalid or revoked. Replace it in Settings.'
        : response.status === 403 ? 'Composio denied access. Check project key permissions and the Google account grant.'
        : response.status === 429 ? 'Composio or Gmail has reached a usage or rate limit. Check Composio Usage before retrying.'
        : response.status === 404 ? 'This Composio connection or session is no longer available. Reconnect Gmail.'
        : 'Composio could not complete the request. Check its dashboard Logs for details.'
      throw new ComposioApiError(message, response.status, write && response.status >= 500)
    }
    try {
      const declared = Number(response.headers.get('content-length'))
      if (declared > MAX_RESPONSE_BYTES) throw new Error('response too large')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('empty response')
      const chunks: Uint8Array[] = []
      let length = 0
      while (true) {
        const next = await reader.read()
        if (next.done) break
        length += next.value.byteLength
        if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('response too large') }
        chunks.push(next.value)
      }
      const raw = Buffer.concat(chunks).toString('utf8')
      const result: unknown = JSON.parse(raw)
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('invalid response')
      return result as Record<string, unknown>
    } catch {
      throw new ComposioApiError(write
        ? 'Composio returned an unreadable result. Check Gmail before trying again.'
        : 'Composio returned an unreadable or oversized response. Try a smaller request.', undefined, write)
    }
  }

  async createSession(key: string, userId: string, accountId?: string): Promise<string> {
    const result = await this.request(key, '/tool_router/session', 'POST', {
      user_id: userId,
      toolkits: { enable: ['gmail'] },
      tools: { gmail: { enable: ALLOWED_TOOLS } },
      manage_connections: { enable: false, enable_connection_removal: false },
      workbench: { enable: false, enable_proxy_execution: false, enable_tool_execution: false },
      search: { enable: false }, execute: { enable_multi_execute: false },
      multi_account: { enable: false },
      ...(accountId ? { connected_accounts: { gmail: [accountId] } } : {}),
    })
    return remoteId(result.session_id, 'session ID')
  }

  async connect(key: string, sessionId: string): Promise<{ redirectUrl: string; accountId: string }> {
    const result = await this.request(key, `/tool_router/session/${remoteId(sessionId, 'session ID')}/link`, 'POST', { toolkit: 'gmail' })
    return { redirectUrl: validateConnectUrl(result.redirect_url), accountId: remoteId(result.connected_account_id, 'account ID') }
  }

  async account(key: string, accountId: string): Promise<Record<string, unknown>> {
    return this.request(key, `/connected_accounts/${remoteId(accountId, 'account ID')}`)
  }

  async execute(key: string, sessionId: string, accountId: string, slug: string, args: Record<string, unknown>, write: boolean): Promise<Record<string, unknown>> {
    if (!ALLOWED_TOOLS.includes(slug)) throw new ComposioApiError('This Gmail action is not supported.')
    // createSession pins exactly one account. The execute-level selector requires
    // project multi-account support and is rejected even for that same account.
    remoteId(accountId, 'account ID')
    return this.request(key, `/tool_router/session/${remoteId(sessionId, 'session ID')}/execute`, 'POST', {
      tool_slug: slug, arguments: args,
      enable_auto_workbench_offload: false,
    }, write)
  }
}
