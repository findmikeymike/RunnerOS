import {
  canApprove,
  createCommunityEmailJob,
  listCommunityContacts,
  listCommunityEmailJobs,
  listCommunitySuppressions,
  listDeliveries,
  readEmailJob,
  upsertCommunityContact,
  type CommunityContactRecord,
  type CommunityEmailJobRecord,
  type ConsentStatus,
} from '@craft-agent/shared/community'
import type { CommunityMailResult } from './CommunityMailService'

/** Hard ceiling on a list read, so a tool result cannot swallow a context window. */
const MAX_CONTACTS = 200
/** A personal-email lookup is the only path that returns addresses. */
const MAX_ADDRESSED = 10
/** No open in this many days and a fan counts as dormant. */
const DORMANT_DAYS = 90
const DAY_MS = 86_400_000

export interface ListContactsInput {
  segment?: string
  tag?: string
  consent?: ConsentStatus
  city?: string
  query?: string
  limit?: number
  /**
   * Return email addresses. Only for drafting a one-to-one message, and
   * capped hard: a broadcast never needs addresses because the send engine
   * resolves them itself.
   */
  forPersonalEmail?: boolean
}

function daysSince(iso: string | undefined, now: Date): number | undefined {
  if (!iso) return undefined
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? Math.floor((now.getTime() - parsed) / DAY_MS) : undefined
}

/**
 * Read and write access to the fan list for agents.
 *
 * Addresses are withheld by default. An agent choosing an audience or
 * drafting a broadcast never needs them, and a tool result is a far leakier
 * place for a fan's address than the contact record it came from.
 */
export class CommunityToolService {
  listContacts(
    workspaceRootPath: string,
    input: ListContactsInput = {},
    now = new Date(),
  ): CommunityMailResult {
    const addressed = input.forPersonalEmail === true
    const limit = Math.min(
      Math.max(input.limit ?? 50, 1),
      addressed ? MAX_ADDRESSED : MAX_CONTACTS,
    )
    const query = input.query?.trim().toLowerCase()

    const matched = listCommunityContacts(workspaceRootPath).filter(contact => {
      if (contact.deletedAt) return false
      if (input.segment && !contact.segments.includes(input.segment)) return false
      if (input.tag && !contact.tags.includes(input.tag)) return false
      if (input.consent && contact.consentStatus !== input.consent) return false
      if (input.city && contact.city?.toLowerCase() !== input.city.toLowerCase()) return false
      if (query) {
        const haystack = `${contact.name ?? ''} ${contact.city ?? ''} ${contact.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })

    return {
      ok: true,
      total: matched.length,
      returned: Math.min(matched.length, limit),
      addressesIncluded: addressed,
      contacts: matched.slice(0, limit).map(contact => ({
        id: contact.id,
        name: contact.name,
        city: contact.city,
        segments: contact.segments,
        tags: contact.tags,
        consentStatus: contact.consentStatus,
        source: contact.source,
        lastContactedAt: contact.lastContactedAt,
        // Withheld unless this is explicitly a one-to-one draft.
        ...(addressed ? { email: contact.email } : {}),
      })),
      ...(addressed
        ? { note: 'Addresses are included because this is a personal email. Do not paste them into a broadcast.' }
        : { note: 'Addresses are withheld. The send engine resolves them from the approved audience.' }),
    }
  }

  /**
   * The health of the list, which is what the agent should read before
   * deciding whether anything is worth sending.
   */
  stats(workspaceRootPath: string, now = new Date()): CommunityMailResult {
    const contacts = listCommunityContacts(workspaceRootPath).filter(contact => !contact.deletedAt)
    const jobs = listCommunityEmailJobs(workspaceRootPath).filter(job => !job.deletedAt)
    const suppressions = listCommunitySuppressions(workspaceRootPath)

    const segments = new Map<string, number>()
    let reachable = 0
    let dormant = 0
    let joinedLast30 = 0

    for (const contact of contacts) {
      if (contact.consentStatus === 'opted-in') reachable += 1
      for (const segment of contact.segments) {
        segments.set(segment, (segments.get(segment) ?? 0) + 1)
      }
      const sinceContact = daysSince(contact.lastContactedAt, now)
      if (sinceContact !== undefined && sinceContact > DORMANT_DAYS) dormant += 1
      const age = daysSince(contact.createdAt, now)
      if (age !== undefined && age <= 30) joinedLast30 += 1
    }

    const sent = jobs
      .filter(job => job.status === 'sent')
      .sort((a, b) => (b.send?.completedAt ?? '').localeCompare(a.send?.completedAt ?? ''))

    const lastSend = sent[0]
    const sinceLastSend = daysSince(lastSend?.send?.completedAt, now)

    return {
      ok: true,
      total: contacts.length,
      reachable,
      joinedLast30,
      dormant,
      suppressed: suppressions.length,
      segments: [...segments.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count),
      lastSend: lastSend
        ? {
          subject: lastSend.content.subject,
          at: lastSend.send?.completedAt,
          recipients: lastSend.send?.sentCount ?? 0,
          daysAgo: sinceLastSend,
        }
        : undefined,
      openJobs: jobs.filter(job => job.status !== 'sent' && job.status !== 'cancelled').length,
      // Said plainly so the agent weighs it rather than deriving it.
      cadenceNote: sinceLastSend === undefined
        ? 'Nothing has ever been sent to this list.'
        : sinceLastSend < 7
          ? `The last email went out ${sinceLastSend} days ago. Another one this soon needs a real reason.`
          : `The last email went out ${sinceLastSend} days ago.`,
    }
  }

  /**
   * Create a draft. Free: drafting costs nobody anything, and a draft the
   * artist rejects is cheaper than an email they wish they had not sent.
   */
  draftEmail(
    workspaceRootPath: string,
    machineId: string,
    input: {
      title: string
      subject: string
      bodyMarkdown: string
      segmentIds: string[]
      purpose?: CommunityEmailJobRecord['purpose']
    },
  ): CommunityMailResult {
    if (!input.subject.trim() || !input.bodyMarkdown.trim()) {
      return { ok: false, error: 'A draft needs both a subject and a body.' }
    }
    if (input.segmentIds.length === 0) {
      return { ok: false, error: 'Choose who this goes to. A broadcast with no segment reaches nobody.' }
    }

    const job = createCommunityEmailJob(workspaceRootPath, machineId, {
      title: input.title,
      subject: input.subject,
      bodyMarkdown: input.bodyMarkdown,
      segmentIds: input.segmentIds,
      purpose: input.purpose ?? 'newsletter',
      transportProvider: 'esp',
    }, { status: 'draft' })

    return {
      ok: true,
      jobId: job.id,
      subject: job.content.subject,
      audience: {
        segments: job.audience.segmentIds,
        recipients: job.audience.estimatedRecipients,
        excludedSuppressed: job.audience.excludedSuppressed,
        excludedUnknownConsent: job.audience.excludedUnknownConsent,
      },
      status: job.status,
      note: job.audience.estimatedRecipients === 0
        ? 'Nobody is in this audience yet, so this cannot be approved as it stands.'
        : 'Drafted. The artist approves it before anything is sent.',
    }
  }

  /**
   * Ask the artist to send. Never sends.
   *
   * An agent proposing and an artist deciding are two different acts, and
   * collapsing them is how a list gets talked to death.
   */
  requestSend(workspaceRootPath: string, jobId: string): CommunityMailResult {
    const job = readEmailJob(workspaceRootPath, jobId)
    if (!job) return { ok: false, error: 'That email no longer exists.' }

    const ready = canApprove(job)
    if (!ready.ok) return { ok: false, error: ready.message, failure: ready.failure }

    return {
      ok: true,
      jobId: job.id,
      needsApproval: true,
      subject: job.content.subject,
      recipients: job.audience.estimatedRecipients,
      segments: job.audience.segmentIds,
      note: `Waiting for the artist to approve sending "${job.content.subject}" to ${job.audience.estimatedRecipients} ${job.audience.estimatedRecipients === 1 ? 'fan' : 'fans'}. Tell them it is ready; do not try to send it yourself.`,
    }
  }

  /** Add or remove tags across a bounded set of contacts. */
  tagContacts(
    workspaceRootPath: string,
    machineId: string,
    input: { contactIds: string[]; addTags?: string[]; removeTags?: string[] },
  ): CommunityMailResult {
    const add = (input.addTags ?? []).map(tag => tag.trim()).filter(Boolean)
    const remove = new Set((input.removeTags ?? []).map(tag => tag.trim()).filter(Boolean))
    if (add.length === 0 && remove.size === 0) {
      return { ok: false, error: 'Nothing to add or remove.' }
    }

    const byId = new Map(listCommunityContacts(workspaceRootPath).map(contact => [contact.id, contact]))
    let updated = 0
    const missing: string[] = []

    for (const id of input.contactIds.slice(0, 500)) {
      const contact = byId.get(id)
      if (!contact || contact.deletedAt || !contact.email) {
        missing.push(id)
        continue
      }
      const next = [...new Set([...contact.tags, ...add])].filter(tag => !remove.has(tag))
      upsertCommunityContact(workspaceRootPath, machineId, {
        id: contact.id,
        email: contact.email,
        tags: next,
        // The computed list is authoritative; merging would make removal a no-op.
        replaceTags: true,
      })
      updated += 1
    }

    return { ok: true, updated, missing: missing.length, note: `${updated} updated.` }
  }

  jobStatus(workspaceRootPath: string, jobId: string): CommunityMailResult {
    const job = readEmailJob(workspaceRootPath, jobId)
    if (!job) return { ok: false, error: 'That email no longer exists.' }
    const deliveries = listDeliveries(workspaceRootPath, jobId)
    return {
      ok: true,
      jobId: job.id,
      subject: job.content.subject,
      status: job.status,
      recipients: job.audience.estimatedRecipients,
      sent: job.send?.sentCount ?? 0,
      failed: job.send?.failedCount ?? 0,
      deliveries: deliveries.length,
    }
  }
}

export type { CommunityContactRecord }
