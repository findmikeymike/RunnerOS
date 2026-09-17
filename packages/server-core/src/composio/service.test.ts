import { describe, expect, test } from 'bun:test'
import type { StoredCredential } from '@craft-agent/shared/credentials'
import { ComposioClient, validateConnectUrl } from './client.ts'
import { COMPOSIO_CREDENTIAL_ID, ComposioService, gmailArguments } from './service.ts'

class MemoryCredentials {
  value: StoredCredential | null = null
  async get() { return structuredClone(this.value) }
  async set(_id: unknown, value: StoredCredential) { this.value = structuredClone(value) }
  async delete() { const had = this.value !== null; this.value = null; return had }
}
type Request = { path: string; body: Record<string, any>; method: string; key: string }
function fixture() {
  const credentials = new MemoryCredentials()
  const requests: Request[] = []
  let accountStatus = 'ACTIVE'
  let wrongUser = false
  let wrongToolkit = false
  let disabled = false
  let profileFailure = false
  let profileEmail = 'artist@example.com'
  let executionResult: unknown
  let hasExecutionResult = false
  let sendFailure: 'network' | 'tool' | 'http' | 'missing' | undefined
  let now = 100_000
  let failKey = false
  let nextAccount = 'ca_one'
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)['x-api-key']!
    const path = new URL(String(url)).pathname
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    requests.push({ path, body, method: init?.method ?? 'GET', key })
    expect(init?.redirect).toBe('error')
    if (failKey) return Response.json({ error: `secret ${key}` }, { status: 401 })
    if (path.endsWith('/tool_router/session')) return Response.json({ session_id: `trs_${requests.length}` })
    if (path.endsWith('/link')) return Response.json({ connected_account_id: nextAccount, redirect_url: 'https://connect.composio.dev/link/lt_test' })
    if (path.includes('/connected_accounts/')) {
      const id = path.split('/').at(-1)!
      const saved = JSON.parse(credentials.value!.value)
      return Response.json({ id, user_id: wrongUser ? 'another_user' : saved.userId,
        toolkit: { slug: wrongToolkit ? 'slack' : 'gmail' }, status: accountStatus, is_disabled: disabled })
    }
    if (path.endsWith('/execute')) {
      if (body.tool_slug === 'GMAIL_GET_PROFILE') return Response.json({ data: profileFailure
        ? { successful: false, error: 'profile unavailable' }
        : { successful: true, data: { emailAddress: profileEmail } } })
      if (sendFailure === 'network') throw new Error(`network fail secret ${key}`)
      if (sendFailure === 'http') return Response.json({ message: `secret ${key}` }, { status: 502 })
      if (sendFailure === 'missing') return Response.json({ message: 'Session missing' }, { status: 404 })
      if (sendFailure === 'tool') return Response.json({ data: JSON.stringify({ successful: false, error: `secret ${key}` }) })
      if (hasExecutionResult) return Response.json(executionResult)
      if (body.tool_slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID') return Response.json({ data: { id: body.arguments.message_id, messageText: 'Hello from Gmail' } })
      return Response.json({ data: { successful: true, data: { id: 'message123', threadId: 'thread123' } } })
    }
    throw new Error(`Unexpected request ${path}`)
  }) as typeof fetch
  const service = new ComposioService(credentials, new ComposioClient(fetcher), () => now)
  return {
    service, credentials, requests,
    setStatus(value: string) { accountStatus = value },
    wrongUser() { wrongUser = true }, wrongToolkit() { wrongToolkit = true }, disable() { disabled = true },
    failSend(value: typeof sendFailure) { sendFailure = value }, failKey() { failKey = true },
    nextAccount(value: string) { nextAccount = value },
    advance(ms: number) { now += ms },
    failProfile() { profileFailure = true },
    changeProfileEmail(value: string) { profileEmail = value },
    result(value: unknown) { executionResult = value; hasExecutionResult = true },
  }
}
async function connected() {
  const f = fixture()
  await f.service.saveKey('test-project-key')
  await f.service.connect()
  expect((await f.service.refresh()).state).toBe('connected')
  return f
}
const message = { accountId: 'ca_one', accountEmail: 'artist@example.com', to: 'fan@example.com', subject: 'News', body: 'Hello' }

describe('Composio Gmail host integration', () => {
  test('stores dedicated encrypted-record payload and stable user identity across reload', async () => {
    const f = await connected()
    expect(COMPOSIO_CREDENTIAL_ID.type).toBe('source_apikey')
    const saved = JSON.parse(f.credentials.value!.value)
    expect(saved.userId).toMatch(/^artist_os_/)
    expect(saved.accountId).toBe('ca_one')
    const loaded = new ComposioService(f.credentials)
    expect(await loaded.status()).toEqual({ configured: true, state: 'connected', accountId: 'ca_one', accountLabel: 'artist@example.com', accountEmail: 'artist@example.com' })
    expect(JSON.stringify(await loaded.status())).not.toContain('test-project-key')
    await f.service.saveKey('test-project-key')
    expect(JSON.parse(f.credentials.value!.value).userId).toBe(saved.userId)
  })
  test('session toolkit/tool allowlists disable meta execution and workbench; execution pins account', async () => {
    const f = await connected()
    expect((await f.service.execute('send', message)).ok).toBe(true)
    const sessions = f.requests.filter(r => r.path.endsWith('/tool_router/session'))
    expect(sessions[0]!.body.toolkits).toEqual({ enable: ['gmail'] })
    expect(sessions[0]!.body.tools.gmail.enable).toEqual([
      'GMAIL_FETCH_EMAILS', 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', 'GMAIL_CREATE_EMAIL_DRAFT', 'GMAIL_SEND_EMAIL', 'GMAIL_GET_PROFILE',
    ])
    expect(sessions[0]!.body.workbench.enable).toBe(false)
    expect(sessions[0]!.body.manage_connections.enable).toBe(false)
    expect(sessions.at(-1)!.body.connected_accounts).toEqual({ gmail: ['ca_one'] })
    const request = f.requests.at(-1)!
    // The session pin selects the account; this field fails on single-account projects.
    expect(request.body.account).toBeUndefined()
    expect(request.body.arguments).toEqual({ user_id: 'me', recipient_email: 'fan@example.com', subject: 'News', body: 'Hello', is_html: false })
  })
  test('pending connection only becomes connected after server-confirmed matching identity', async () => {
    const f = fixture()
    await f.service.saveKey('test-project-key')
    await f.service.connect()
    f.setStatus('INITIATED')
    expect((await f.service.refresh()).state).toBe('pending')
    f.setStatus('ACTIVE'); f.wrongUser()
    expect((await f.service.refresh()).state).toBe('error')
    expect(JSON.parse(f.credentials.value!.value).accountId).toBeUndefined()
  })
  test('rejects wrong toolkit even for an ACTIVE matching user', async () => {
    const f = await connected(); f.wrongToolkit()
    expect((await f.service.execute('send', message)).ok).toBe(false)
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(0)
  })
  test.each(['EXPIRED', 'REVOKED', 'FAILED', 'INACTIVE'])('blocks %s accounts', async status => {
    const f = await connected(); f.setStatus(status)
    expect((await f.service.refresh()).state).toBe('expired')
    expect((await f.service.execute('send', message)).ok).toBe(false)
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(0)
  })
  test('blocks disabled accounts even when status still says ACTIVE', async () => {
    const f = await connected(); f.disable()
    expect((await f.service.refresh()).state).toBe('expired')
  })
  test('new key cannot inherit previous connection, invalid replacement preserves existing key', async () => {
    const f = await connected()
    const old = f.credentials.value!.value
    f.failKey()
    await expect(f.service.saveKey('bad-replacement')).rejects.toThrow('invalid or revoked')
    expect(f.credentials.value!.value).toBe(old)
    const g = await connected()
    const oldUser = JSON.parse(g.credentials.value!.value).userId
    await g.service.saveKey('new-project-key')
    const saved = JSON.parse(g.credentials.value!.value)
    expect(saved.userId).not.toBe(oldUser)
    expect(saved.accountId).toBeUndefined()
    expect(saved.pendingAccountId).toBeUndefined()
    expect((await g.service.execute('send', message)).ok).toBe(false)
  })
  test('requires exact account in approved writes, including a pending replacement becoming active', async () => {
    const f = await connected()
    expect((await f.service.execute('send', { ...message, accountId: 'ca_other' })).ok).toBe(false)
    expect((await f.service.execute('send', { ...message, accountId: undefined } as any)).ok).toBe(false)
    f.nextAccount('ca_two')
    await f.service.connect()
    expect((await f.service.execute('send', message)).ok).toBe(false)
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(0)
    expect((await f.service.status()).accountId).toBe('ca_two')
  })
  test('requires the verified readable sender in an approved write', async () => {
    const f = await connected()
    for (const accountEmail of ['fake@example.com', undefined, 'Gmail via Composio']) {
      expect((await f.service.execute('send', { ...message, accountEmail } as any)).ok).toBe(false)
    }
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(0)
  })
  test('profile lookup failure permits reads but fails closed for sends and drafts', async () => {
    const f = fixture()
    f.failProfile()
    await f.service.saveKey('test-key'); await f.service.connect()
    const status = await f.service.refresh()
    expect(status.state).toBe('connected')
    expect(status.accountEmail).toBeUndefined()
    expect((await f.service.execute('read', { messageId: 'abc123' })).ok).toBe(true)
    expect((await f.service.execute('send', message)).ok).toBe(false)
    expect((await f.service.execute('draft', message)).ok).toBe(false)
    expect(f.requests.filter(r => ['GMAIL_SEND_EMAIL', 'GMAIL_CREATE_EMAIL_DRAFT'].includes(r.body.tool_slug))).toHaveLength(0)
  })
  test('rechecks sender before every write when provider account identity changes or becomes unverifiable', async () => {
    const f = await connected()
    f.changeProfileEmail('different@example.com')
    expect((await f.service.execute('send', message)).ok).toBe(false)
    expect((await f.service.status()).accountEmail).toBe('different@example.com')
    f.failProfile()
    expect((await f.service.execute('send', { ...message, accountEmail: 'different@example.com' })).ok).toBe(false)
    expect((await f.service.status()).accountEmail).toBeUndefined()
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(0)
  })
  test.each(['network', 'http', 'tool'] as const)('uncertain %s sends are not retried or reported successful', async failure => {
    const f = await connected(); f.failSend(failure)
    const result = await f.service.execute('send', message)
    expect(result.ok).toBe(false)
    expect(result.uncertain).toBe(true)
    expect(JSON.stringify(result)).not.toContain('test-project-key')
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(1)
  })
  test.each([null, {}, { successful: true }, { id: '' }, { id: ' ' }, { id: 'message123', successful: false }])('does not report writes successful without a verified receipt: %j', async data => {
    const f = await connected()
    f.result({ data })
    for (const operation of ['send', 'draft'] as const) {
      const result = await f.service.execute(operation, message)
      expect(result.ok).toBe(false)
      expect(result.uncertain).toBe(true)
    }
  })
  test('recognizes Gmail send and draft receipt shapes', async () => {
    const f = await connected()
    for (const data of [{ id: 'abc123' }, { messageId: 'abc123' }, { message: { id: 'abc123' } }]) {
      f.result({ data }); expect((await f.service.execute('send', message)).ok).toBe(true)
    }
    for (const data of [{ id: 'r-123' }, { draft_id: 'r-123' }, { draft: { id: 'r-123' } }]) {
      f.result({ data }); expect((await f.service.execute('draft', message)).ok).toBe(true)
    }
  })
  test('read null or unusable results fail while empty searches remain valid', async () => {
    const f = await connected()
    for (const data of [null, '', {}, { successful: true }, { id: 'abc123' }]) {
      f.result({ data }); expect((await f.service.execute('read', { messageId: 'abc123' })).ok).toBe(false)
    }
    for (const data of [{ messages: [] }, {}]) {
      f.result({ data }); expect((await f.service.execute('search', { query: 'is:unread' })).ok).toBe(true)
    }
    f.result({ data: null }); expect((await f.service.execute('search', { query: 'is:unread' })).ok).toBe(false)
  })
  test('local disconnect leaves hosted accounts untouched and clears local service state', async () => {
    const f = await connected()
    const before = f.requests.length
    expect(await f.service.disconnect()).toEqual({ configured: false, state: 'not_configured' })
    expect(f.credentials.value).toBeNull()
    expect(f.requests.length).toBe(before)
    expect((await f.service.execute('read', { messageId: 'abc123' })).ok).toBe(false)
  })
  test('reopening pending sign-in reuses its validated link, then expires the local link window', async () => {
    const f = fixture()
    await f.service.saveKey('test-key')
    const first = await f.service.connect()
    const before = f.requests.length
    expect(await f.service.connect()).toEqual(first)
    expect(f.requests.length).toBe(before)
    const reloaded = new ComposioService(f.credentials, undefined, () => 100_001)
    expect(await reloaded.connect()).toEqual(first)
    f.advance(10 * 60_000)
    await f.service.connect()
    expect(f.requests.filter(r => r.path.endsWith('/link'))).toHaveLength(2)
  })
  test('refreshes an old local session cache before a new action', async () => {
    const f = await connected()
    const before = f.requests.filter(r => r.path.endsWith('/tool_router/session')).length
    f.advance(5 * 60_000)
    expect((await f.service.execute('send', message)).ok).toBe(true)
    expect(f.requests.filter(r => r.path.endsWith('/tool_router/session'))).toHaveLength(before + 1)
  })
  test('missing session invalidates cache for next approved attempt without retrying a send', async () => {
    const f = await connected()
    f.failSend('missing')
    expect((await f.service.execute('send', message)).ok).toBe(false)
    expect(f.requests.filter(r => r.body.tool_slug === 'GMAIL_SEND_EMAIL')).toHaveLength(1)
    const before = f.requests.filter(r => r.path.endsWith('/tool_router/session')).length
    f.failSend(undefined)
    expect((await f.service.execute('send', message)).ok).toBe(true)
    expect(f.requests.filter(r => r.path.endsWith('/tool_router/session'))).toHaveLength(before + 1)
  })
  test('disconnect serialized after in-flight refresh cannot be undone by a stale result', async () => {
    const credentials = new MemoryCredentials()
    let release!: () => void
    let started!: () => void
    const startedPromise = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    credentials.value = { value: JSON.stringify({ version: 1, apiKey: 'test-key', userId: 'user', accountId: 'ca_one',
      status: { configured: true, state: 'connected', accountLabel: 'artist@example.com', accountEmail: 'artist@example.com', accountId: 'ca_one' } }) }
    const fetcher = (async () => {
      started(); await gate
      return Response.json({ id: 'ca_one', user_id: 'user', toolkit: { slug: 'gmail' }, status: 'ACTIVE' })
    }) as unknown as typeof fetch
    const service = new ComposioService(credentials, new ComposioClient(fetcher))
    const refresh = service.refresh()
    await startedPromise
    const disconnect = service.disconnect()
    release()
    await refresh; await disconnect
    expect(await service.status()).toEqual({ configured: false, state: 'not_configured' })
    expect(credentials.value).toBeNull()
  })
  test('constructs only allowed bounded arguments and never accepts account/user/slug overrides', () => {
    expect(gmailArguments('search', { query: 'is:unread', user_id: 'someone-else', tool_slug: 'GMAIL_SEND_EMAIL' } as any))
      .toEqual({ user_id: 'me', query: 'is:unread', max_results: 10, verbose: false, include_payload: false })
    expect(() => gmailArguments('search', { query: 'x', maxResults: 51 })).toThrow()
    expect(() => gmailArguments('read', { messageId: 'my subject' })).toThrow()
    expect(() => gmailArguments('delete' as any, message)).toThrow()
    expect(() => gmailArguments('send', { ...message, to: 'x@example.com\nBcc: secret@example.com' })).toThrow()
    expect(() => gmailArguments('send', { ...message, subject: 'Hello\nBcc: victim' })).toThrow()
  })
})

describe('Composio auth URL handling', () => {
  test.each(['https://connect.composio.dev/link/ln_123', 'https://app.composio.dev/link/lt_123'])('accepts documented %s', url => {
    expect(validateConnectUrl(url)).toBe(url)
  })
  test.each(['http://connect.composio.dev/link/a', 'https://connect.composio.dev.evil.com/link/a', 'javascript:alert(1)',
    'https://evil@connect.composio.dev/link/a', 'https://connect.composio.dev:444/link/a', 'https://connect.composio.dev/redirect/a'])('rejects %s', url => {
    expect(() => validateConnectUrl(url)).toThrow()
  })
})
