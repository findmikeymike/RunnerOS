import { randomUUID } from 'node:crypto'
import { getCredentialManager, type CredentialId, type StoredCredential } from '@craft-agent/shared/credentials'
import type { ComposioStatus, ComposioOperation, ComposioInput, ComposioToolResult } from '../../../shared/src/composio/types.ts'
import { ComposioClient, ComposioApiError, GMAIL_TOOLS, objectValue, validateConnectUrl } from './client.ts'
import { normalizeGmailMessage } from './gmail-message.ts'

// Reserved app scope prevents collision with generic source_apikey::global and never enters user_secret env export.
export const COMPOSIO_CREDENTIAL_ID: CredentialId = {
  type: 'source_apikey', workspaceId: '__artist_os_global__', sourceId: 'composio',
}
interface SavedConnection {
  version: 1
  apiKey: string
  userId: string
  accountId?: string
  pendingAccountId?: string
  pendingUrl?: string
  pendingSince?: number
  status: ComposioStatus
}
interface CredentialStore {
  get(id: CredentialId): Promise<StoredCredential | null>
  set(id: CredentialId, credential: StoredCredential): Promise<void>
  delete(id: CredentialId): Promise<boolean>
}
const NOT_CONFIGURED: ComposioStatus = { configured: false, state: 'not_configured' }

function safeError(error: unknown): string {
  return error instanceof ComposioApiError ? error.message : 'The Composio operation could not be completed. Please try again.'
}
function text(value: unknown, name: string, maximum: number, required = true): string {
  if (typeof value !== 'string' || value.length > maximum || (required && !value.trim())) {
    throw new ComposioApiError(`Invalid ${name}.`)
  }
  return value
}
function email(value: unknown): string {
  const result = text(value, 'email address', 320).trim()
  if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(result)) throw new ComposioApiError('Use a complete email address.')
  return result
}
function recipients(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 20) throw new ComposioApiError('Use at most 20 CC or BCC recipients.')
  return value.map(email)
}
/** Session envelope and toolkit payload wrappers differ; inspect both without executing provider text. */
function unwrapResult(result: Record<string, unknown>): { data: unknown; failed: boolean } {
  let value: unknown = result
  let failed = false
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === 'string' && value.trim().startsWith('{')) {
      try { value = JSON.parse(value) } catch { break }
    }
    const record = objectValue(value)
    if (record.error || record.successful === false) failed = true
    if (!Object.hasOwn(record, 'data')) break
    value = record.data
  }
  return { data: value, failed }
}
function hasWriteReceipt(operation: 'draft' | 'send', value: unknown): boolean {
  const data = objectValue(value)
  const receipt = operation === 'draft'
    ? data.draft_id ?? data.id ?? objectValue(data.draft).id
    : data.id ?? data.messageId ?? objectValue(data.message).id
  return typeof receipt === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(receipt)
}
/** Constructs provider arguments from a strict named operation; arbitrary tool names/account fields never cross this boundary. */
export function gmailArguments(operation: ComposioOperation, input: ComposioInput): Record<string, unknown> {
  const data = objectValue(input)
  if (operation === 'search') {
    const max = data.maxResults ?? 10
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 50) throw new ComposioApiError('maxResults must be between 1 and 50.')
    return {
      user_id: 'me', query: text(data.query, 'search query', 2000), max_results: max,
      verbose: false, include_payload: false,
      ...(data.pageToken !== undefined ? { page_token: text(data.pageToken, 'page token', 4000) } : {}),
    }
  }
  if (operation === 'read') {
    const id = text(data.messageId, 'message ID', 200)
    if (!/^[a-f0-9]+$/i.test(id)) throw new ComposioApiError('Use the Gmail message ID returned by search.')
    return { user_id: 'me', message_id: id, format: 'full' }
  }
  if (operation !== 'draft' && operation !== 'send') throw new ComposioApiError('This Gmail action is not supported.')
  email(data.accountEmail)
  const subject = text(data.subject, 'subject', 998, false)
  if (/[\r\n]/.test(subject)) throw new ComposioApiError('Email subjects cannot contain line breaks.')
  const body = text(data.body, 'email body', 100_000, false)
  if (!subject.trim() && !body.trim()) throw new ComposioApiError('Provide an email subject or body.')
  const cc = recipients(data.cc), bcc = recipients(data.bcc)
  return {
    user_id: 'me', recipient_email: email(data.to), subject, body, is_html: false,
    ...(cc ? { cc } : {}), ...(bcc ? { bcc } : {}),
  }
}

/** This host service is only called through Artist OS's existing tool permission gate. */
export class ComposioService {
  private queue: Promise<unknown> = Promise.resolve()
  private session?: { key: string; userId: string; accountId?: string; id: string; createdAt: number }
  constructor(
    private readonly credentials: CredentialStore = getCredentialManager(),
    private readonly client = new ComposioClient(),
    private readonly now: () => number = Date.now,
  ) {}

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.catch(() => {}).then(action)
    this.queue = pending
    return pending
  }
  private async load(): Promise<SavedConnection | null> {
    const credential = await this.credentials.get(COMPOSIO_CREDENTIAL_ID)
    if (!credential) return null
    let data: SavedConnection
    try { data = JSON.parse(credential.value) as SavedConnection } catch { throw new ComposioApiError('Saved Composio settings are invalid. Replace the API key.') }
    if (data.version !== 1 || typeof data.apiKey !== 'string' || typeof data.userId !== 'string' || !data.status) {
      throw new ComposioApiError('Saved Composio settings are invalid. Replace the API key.')
    }
    return data
  }
  private async save(data: SavedConnection): Promise<void> {
    await this.credentials.set(COMPOSIO_CREDENTIAL_ID, { value: JSON.stringify(data), updatedAt: Date.now() })
  }
  private async sessionId(saved: SavedConnection, accountId?: string): Promise<string> {
    if (this.session?.key === saved.apiKey && this.session.userId === saved.userId && this.session.accountId === accountId
      && this.now() - this.session.createdAt < 5 * 60_000) return this.session.id
    const id = await this.client.createSession(saved.apiKey, saved.userId, accountId)
    this.session = { key: saved.apiKey, userId: saved.userId, accountId, id, createdAt: this.now() }
    return id
  }
  status(): Promise<ComposioStatus> {
    return this.exclusive(async () => {
      try { return { ...((await this.load())?.status ?? NOT_CONFIGURED) } }
      catch (error) { return { configured: true, state: 'error', error: safeError(error) } }
    })
  }
  saveKey(key: string): Promise<ComposioStatus> {
    return this.exclusive(async () => {
      const apiKey = text(key, 'Composio API key', 2048).trim()
      if (/[\s\u0000-\u001f\u007f]/.test(apiKey)) throw new ComposioApiError('The API key cannot contain spaces or control characters.')
      const previous = await this.load().catch(() => null)
      const saved: SavedConnection = previous?.apiKey === apiKey ? previous : {
        version: 1, apiKey, userId: `artist_os_${randomUUID()}`,
        status: { configured: true, state: 'not_connected' },
      }
      // Verify before replacing a working key. New key never inherits another project's account IDs.
      const id = await this.client.createSession(apiKey, saved.userId, saved.accountId)
      await this.save(saved)
      this.session = { key: apiKey, userId: saved.userId, accountId: saved.accountId, id, createdAt: this.now() }
      return { ...saved.status }
    })
  }
  connect(): Promise<{ redirectUrl: string }> {
    return this.exclusive(async () => {
      const saved = await this.load()
      if (!saved) throw new ComposioApiError('Add a Composio project API key in Settings first.')
      // Reopening a sign-in must not create duplicate hosted accounts. A stale link can be replaced deliberately.
      if (saved.status.state === 'pending' && saved.pendingAccountId && saved.pendingUrl && typeof saved.pendingSince === 'number'
        && this.now() - saved.pendingSince >= 0 && this.now() - saved.pendingSince < 10 * 60_000) {
        return { redirectUrl: validateConnectUrl(saved.pendingUrl) }
      }
      const id = await this.sessionId(saved)
      let link: { redirectUrl: string; accountId: string }
      try { link = await this.client.connect(saved.apiKey, id) }
      catch (error) {
        if (error instanceof ComposioApiError && error.status === 404) this.session = undefined
        throw error
      }
      saved.pendingAccountId = link.accountId
      saved.pendingUrl = link.redirectUrl
      saved.pendingSince = this.now()
      saved.status = { configured: true, state: 'pending', accountLabel: saved.status.accountLabel }
      await this.save(saved)
      return { redirectUrl: link.redirectUrl }
    })
  }
  private async refreshSaved(saved: SavedConnection, verifySender = false): Promise<ComposioStatus> {
    const id = saved.pendingAccountId ?? saved.accountId
    if (!id) return saved.status = { configured: true, state: 'not_connected' }
    try {
      const account = await this.client.account(saved.apiKey, id)
      if (account.id !== id || account.user_id !== saved.userId || objectValue(account.toolkit).slug !== 'gmail') {
        throw new ComposioApiError('Composio returned an account belonging to a different connection. Reconnect Gmail.')
      }
      if (account.status === 'ACTIVE' && account.is_disabled !== true && objectValue(account.auth_config).is_disabled !== true) {
        let label = saved.accountId === id ? saved.status.accountLabel : undefined
        let accountEmail = saved.accountId === id ? saved.status.accountEmail : undefined
        saved.accountId = id
        delete saved.pendingAccountId
        delete saved.pendingUrl
        delete saved.pendingSince
        if (!accountEmail || verifySender) {
          // A provider-side reconnect may retain a connection ID; refresh the human-readable sender before every write.
          accountEmail = undefined
          label = undefined
          try {
            const sessionId = await this.sessionId(saved, id)
            const profile = unwrapResult(await this.client.execute(saved.apiKey, sessionId, id, 'GMAIL_GET_PROFILE', { user_id: 'me' }, false))
            const address = objectValue(profile.data).emailAddress
            if (!profile.failed && typeof address === 'string') {
              accountEmail = email(address).toLowerCase()
              label = accountEmail
            }
          } catch (error) {
            // Account status was independently verified; an optional label failure does not revoke the grant.
            if (error instanceof ComposioApiError && error.status === 404) this.session = undefined
          }
        }
        saved.status = { configured: true, state: 'connected', accountLabel: label ?? 'Gmail via Composio', accountId: id,
          ...(accountEmail ? { accountEmail } : {}) }
      } else if (['INITIATED', 'INITIALIZING'].includes(String(account.status))) {
        saved.status = { configured: true, state: 'pending' }
      } else {
        saved.status = { configured: true, state: 'expired', error: 'Gmail needs to be reconnected. Open Connect Gmail and authorize again.' }
      }
    } catch (error) {
      saved.status = { configured: true, state: error instanceof ComposioApiError && error.status === 404 ? 'expired' : 'error', error: safeError(error) }
    }
    await this.save(saved)
    return { ...saved.status }
  }
  refresh(): Promise<ComposioStatus> {
    return this.exclusive(async () => {
      const saved = await this.load()
      return saved ? this.refreshSaved(saved) : { ...NOT_CONFIGURED }
    })
  }
  disconnect(): Promise<ComposioStatus> {
    return this.exclusive(async () => {
      await this.credentials.delete(COMPOSIO_CREDENTIAL_ID)
      this.session = undefined
      return { ...NOT_CONFIGURED }
    })
  }
  execute(operation: ComposioOperation, input: ComposioInput): Promise<ComposioToolResult> {
    return this.exclusive(async () => {
      try {
        const args = gmailArguments(operation, input)
        const saved = await this.load()
        if (!saved) throw new ComposioApiError('Connect Gmail through Composio in Settings first.')
        const write = operation === 'draft' || operation === 'send'
        const requestedAccount = objectValue(input).accountId
        if (write && (!saved.accountId || requestedAccount !== saved.accountId)) {
          throw new ComposioApiError('The Gmail account changed. Check connection status and approve this action for the current account.')
        }
        const current = await this.refreshSaved(saved, write)
        if (current.state !== 'connected' || !saved.accountId) throw new ComposioApiError(current.error ?? 'Complete the Gmail connection in Settings first.')
        if (write && requestedAccount !== saved.accountId) {
          throw new ComposioApiError('The Gmail account changed. Check connection status and approve this action for the current account.')
        }
        if (write && (!current.accountEmail || String(objectValue(input).accountEmail).trim().toLowerCase() !== current.accountEmail)) {
          throw new ComposioApiError('The Gmail sender could not be verified or changed. Refresh connection status and approve this action with the verified sender email.')
        }
        const id = await this.sessionId(saved, saved.accountId)
        const result = await this.client.execute(saved.apiKey, id, saved.accountId, GMAIL_TOOLS[operation], args, write)
        const output = unwrapResult(result)
        if (output.failed) {
          return { ok: false, error: 'Gmail did not confirm this action. Check Composio Logs and the account permissions before retrying.', ...(write ? { uncertain: true } : {}) }
        }
        if (result.data === undefined) return { ok: false, error: 'Composio returned no result.', ...(write ? { uncertain: true } : {}) }
        if (write && !hasWriteReceipt(operation as 'draft' | 'send', output.data)) {
          return { ok: false, uncertain: true, error: 'Composio returned no verifiable Gmail receipt. Check Gmail before trying again.' }
        }
        // Provider content is data, never instructions. Host tool wrappers preserve their untrusted-result boundary.
        if (operation === 'read') {
          const message = normalizeGmailMessage(output.data, String(args.message_id))
          if ((!message.body && !Object.keys(objectValue(output.data)).length)
            || (message.bodyFormat === 'unavailable' && !message.snippet && !Object.keys(message.headers).length && !message.attachments.length)) {
            return { ok: false, error: 'Composio returned no readable Gmail message. Check that the message exists and the connection can read message content.' }
          }
          return { ok: true, data: message }
        }
        if (operation === 'search' && (!output.data || typeof output.data !== 'object' || Array.isArray(output.data))) {
          return { ok: false, error: 'Composio returned an invalid Gmail search result. Please try a smaller search.' }
        }
        return { ok: true, data: output.data }
      } catch (error) {
        if (error instanceof ComposioApiError && error.status === 404) this.session = undefined
        return { ok: false, error: safeError(error), ...(error instanceof ComposioApiError && error.uncertain ? { uncertain: true } : {}) }
      }
    })
  }
}

let singleton: ComposioService | undefined
export function getComposioService(): ComposioService { return singleton ??= new ComposioService() }
