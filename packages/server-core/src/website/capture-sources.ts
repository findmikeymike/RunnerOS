import type { CapturedSubscriber } from '@craft-agent/shared/website'
import type { FetchLike } from './adapters/types'

export interface CaptureFetchResult {
  subscribers: CapturedSubscriber[]
  /** Resume point for the next drain. Undefined means the end was reached. */
  cursor?: string
}

/**
 * Where signups accumulate between the site and the fan list.
 *
 * The site's signup function writes here; the drain reads. Keeping this an
 * interface means the KV and Resend doors differ in one file rather than
 * throughout the loop.
 */
export interface CaptureSource {
  readonly id: 'resend' | 'kv'
  fetchSince(cursor: string | undefined, limit: number): Promise<CaptureFetchResult>
}

interface ResendContact {
  id?: string
  email?: string
  first_name?: string
  created_at?: string
  unsubscribed?: boolean
  properties?: Record<string, unknown>
}

/** Resend caps a contacts page at 100. */
const RESEND_PAGE_MAX = 100

/**
 * Resend Audiences as the inbox.
 *
 * The signup function creates the contact with `aos_*` properties, so the
 * form and the hashed IP survive the round trip and arrive as real consent
 * evidence rather than a bare address.
 */
export class ResendCaptureSource implements CaptureSource {
  readonly id = 'resend' as const

  constructor(
    private readonly options: {
      apiKey: string
      segmentId?: string
      fetchImpl?: FetchLike
    },
  ) {}

  private get fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? ((input, init) => fetch(input, init as RequestInit) as never)
  }

  async fetchSince(cursor: string | undefined, limit: number): Promise<CaptureFetchResult> {
    const params = new URLSearchParams({ limit: String(Math.min(limit, RESEND_PAGE_MAX)) })
    if (cursor) params.set('after', cursor)
    if (this.options.segmentId) params.set('segment_id', this.options.segmentId)

    const response = await this.fetchImpl(`https://api.resend.com/contacts?${params.toString()}`, {
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
    })
    if (!response.ok) {
      throw new Error(`Resend returned ${response.status} while reading signups.`)
    }

    const payload = await response.json().catch(() => undefined) as
      | { data?: ResendContact[]; has_more?: boolean }
      | undefined
    const contacts = payload?.data ?? []

    const subscribers = contacts.flatMap<CapturedSubscriber>(contact => {
      if (!contact.email) return []
      // A contact that already unsubscribed upstream must not be re-imported
      // as a fresh signup.
      if (contact.unsubscribed) return []
      const properties = contact.properties ?? {}
      const releaseId = stringOrUndefined(properties.aos_release)
      return [{
        email: contact.email,
        formId: stringOrUndefined(properties.aos_form_id) ?? 'newsletter',
        capturedAt: contact.created_at ?? new Date().toISOString(),
        ipHash: stringOrUndefined(properties.aos_ip_hash),
        firstName: contact.first_name || undefined,
        ...(releaseId ? { reward: { kind: 'download' as const, releaseId } } : {}),
      }]
    })

    const last = contacts.at(-1)
    return {
      subscribers,
      cursor: payload?.has_more && last?.id ? last.id : undefined,
    }
  }
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
