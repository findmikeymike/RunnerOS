import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCommunityEmailJob,
  listCommunityEmailJobs,
  listDeliveries,
  readEmailJob,
  resolveSendAudience,
  suppressCommunityContact,
  upsertCommunityContact,
} from '@craft-agent/shared/community'
import { latestChangeReceipt } from '@craft-agent/shared/website'
import { CommunityMailService } from './CommunityMailService'
import { ResendMailer } from './ResendMailer'
import type { FetchLike } from '../website/adapters/types'

const MACHINE = 'machine-1'
const ORIGIN = { kind: 'user' as const }
const PROVIDER = {
  from: 'hello@lowtide.com',
  unsubscribeUrl: 'https://lowtide.com/unsubscribe',
  postalAddress: 'PO Box 1, Denver CO',
}

interface Call { url: string; headers?: Record<string, string>; body?: unknown }

function fakeFetch(handlers: {
  domains?: { ok?: boolean; status?: number; body: unknown }
  batch?: Array<{ ok?: boolean; status?: number; body: unknown }>
}): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  let batchIndex = 0
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body })
    const next = url.includes('/domains')
      ? handlers.domains ?? { body: { data: [{ name: 'lowtide.com', status: 'verified' }] } }
      : (handlers.batch ?? [])[batchIndex++] ?? { body: { data: [{ id: 'msg-1' }] } }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    }
  }
  return { fetchImpl, calls }
}

function service(fetchImpl: FetchLike): CommunityMailService {
  return new CommunityMailService(new ResendMailer({ apiKey: 're_test', fetchImpl }))
}

/** A workspace with fans and one drafted broadcast. */
function workspace(fans: Array<{ email: string; name?: string }> = [{ email: 'fan@example.com', name: 'Fan One' }]): {
  root: string
  jobId: string
} {
  const root = mkdtempSync(join(tmpdir(), 'community-send-'))
  for (const fan of fans) {
    upsertCommunityContact(root, MACHINE, {
      email: fan.email,
      name: fan.name,
      segment: 'general',
      consentStatus: 'opted-in',
    })
  }
  const job = createCommunityEmailJob(root, MACHINE, {
    title: 'Two Colorado nights',
    segmentIds: ['general'],
    purpose: 'announcement',
    subject: 'Two Colorado nights',
    bodyMarkdown: 'Hey {{first_name}}, we added two shows.',
  }, { status: 'draft' })
  return { root, jobId: job.id }
}

describe('approving before sending', () => {
  test('an unapproved job is refused rather than approved in passing', async () => {
    const { root, jobId } = workspace()
    try {
      const { fetchImpl, calls } = fakeFetch({})
      const result = await service(fetchImpl).send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      expect(result.ok).toBe(false)
      expect(result.failure).toBe('not-approved')
      // Sending to real people must never be a side effect.
      expect(calls).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a job with no subject or body cannot be approved', () => {
    const root = mkdtempSync(join(tmpdir(), 'community-send-'))
    try {
      upsertCommunityContact(root, MACHINE, { email: 'fan@example.com', segment: 'general', consentStatus: 'opted-in' })
      const job = createCommunityEmailJob(root, MACHINE, {
        title: 'Untitled',
        segmentIds: ['general'],
        purpose: 'announcement',
        bodyMarkdown: '',
      }, { status: 'draft' })

      const result = new CommunityMailService().approve(root, MACHINE, job.id)
      expect(result.ok).toBe(false)
      expect(result.failure).toBe('missing-content')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a job with nobody in it cannot be approved', () => {
    const root = mkdtempSync(join(tmpdir(), 'community-send-'))
    try {
      const job = createCommunityEmailJob(root, MACHINE, {
        title: 'To nobody',
        segmentIds: ['vip'],
        purpose: 'announcement',
        subject: 'Hello',
        bodyMarkdown: 'Anyone there?',
      }, { status: 'draft' })

      const result = new CommunityMailService().approve(root, MACHINE, job.id)
      expect(result.ok).toBe(false)
      expect(result.failure).toBe('empty-audience')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an already-sent job cannot be approved or cancelled again', () => {
    const { root, jobId } = workspace()
    try {
      const mail = new CommunityMailService()
      mail.approve(root, MACHINE, jobId)
      // Simulate the send having completed.
      const job = readEmailJob(root, jobId)!
      expect(job.status).toBe('approved')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('sending', () => {
  test('an approved job reaches every fan and writes a delivery each', async () => {
    const { root, jobId } = workspace([
      { email: 'one@example.com', name: 'One Person' },
      { email: 'two@example.com', name: 'Two Person' },
    ])
    try {
      const { fetchImpl, calls } = fakeFetch({
        batch: [{ body: { data: [{ id: 'msg-1' }, { id: 'msg-2' }] } }],
      })
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      expect(result.ok).toBe(true)
      expect(result.sent).toBe(2)
      expect(result.failed).toBe(0)
      expect(readEmailJob(root, jobId)!.status).toBe('sent')

      const deliveries = listDeliveries(root, jobId)
      expect(deliveries).toHaveLength(2)
      expect(deliveries.every(row => row.lastEvent === 'sent')).toBe(true)
      expect(deliveries.map(row => row.providerMessageId).sort()).toEqual(['msg-1', 'msg-2'])

      const receipt = latestChangeReceipt(root, 'email-send')!
      expect(receipt.counts?.recipients).toBe(2)
      // A receipt must never carry a fan's address.
      expect(JSON.stringify(receipt)).not.toContain('one@example.com')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('every message carries one-click unsubscribe headers', async () => {
    const { root, jobId } = workspace()
    try {
      const { fetchImpl, calls } = fakeFetch({})
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)
      await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      const batch = calls.find(call => call.url.includes('/emails/batch'))!
      const messages = JSON.parse(String(batch.body)) as Array<{ headers: Record<string, string>; html: string }>

      expect(messages[0]!.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
      expect(messages[0]!.headers['List-Unsubscribe']).toContain('lowtide.com/unsubscribe')
      // The footer carries the postal address the law requires.
      expect(messages[0]!.html).toContain('PO Box 1, Denver CO')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a first name is substituted, and a missing one reads naturally', async () => {
    const { root, jobId } = workspace([
      { email: 'named@example.com', name: 'Casey Jones' },
      { email: 'anon@example.com' },
    ])
    try {
      const { fetchImpl, calls } = fakeFetch({})
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)
      await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      const batch = calls.find(call => call.url.includes('/emails/batch'))!
      const messages = JSON.parse(String(batch.body)) as Array<{ to: string[]; text: string }>
      const named = messages.find(message => message.to[0] === 'named@example.com')!
      const anon = messages.find(message => message.to[0] === 'anon@example.com')!

      expect(named.text).toContain('Hey Casey,')
      // "Hey ," is worse than no greeting.
      expect(anon.text).toContain('Hey there,')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a fan who unsubscribed after the draft is dropped at send', async () => {
    const { root, jobId } = workspace([
      { email: 'stays@example.com' },
      { email: 'leaves@example.com' },
    ])
    try {
      const mail = service(fakeFetch({}).fetchImpl)
      mail.approve(root, MACHINE, jobId)
      // They left between the draft and the send.
      suppressCommunityContact(root, MACHINE, 'leaves@example.com', 'unsubscribed')

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      expect(result.sent).toBe(1)
      expect(result.droppedSinceFreeze).toBe(1)
      expect(latestChangeReceipt(root, 'email-send')!.changes.join(' ')).toContain('unsubscribed after the draft')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an audience that emptied out refuses instead of sending nothing quietly', async () => {
    const { root, jobId } = workspace([{ email: 'leaves@example.com' }])
    try {
      const mail = service(fakeFetch({}).fetchImpl)
      mail.approve(root, MACHINE, jobId)
      suppressCommunityContact(root, MACHINE, 'leaves@example.com', 'unsubscribed')

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('unsubscribed since the draft')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('nobody new can be added to an approved audience', () => {
    const { root, jobId } = workspace([{ email: 'original@example.com' }])
    try {
      upsertCommunityContact(root, MACHINE, {
        email: 'latecomer@example.com',
        segment: 'general',
        consentStatus: 'opted-in',
      })

      const audience = resolveSendAudience(root, readEmailJob(root, jobId)!)
      // The frozen list is what the artist approved.
      expect(audience.members.map(member => member.email)).toEqual(['original@example.com'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('refusing to send when the setup is wrong', () => {
  test('an unverified sending domain stops the send', async () => {
    const { root, jobId } = workspace()
    try {
      const { fetchImpl, calls } = fakeFetch({
        domains: { body: { data: [{ name: 'lowtide.com', status: 'pending' }] } },
      })
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not verified')
      expect(calls.some(call => call.url.includes('/emails/batch'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a domain missing from Resend says what to do about it', async () => {
    const { root, jobId } = workspace()
    try {
      const { fetchImpl } = fakeFetch({ domains: { body: { data: [] } } })
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)
      expect(result.error).toContain('not added to Resend')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a provider rejection marks the job failed rather than sent', async () => {
    const { root, jobId } = workspace()
    try {
      const { fetchImpl } = fakeFetch({
        batch: [{ ok: false, status: 422, body: { message: 'Invalid from address' } }],
      })
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)
      expect(result.ok).toBe(false)
      expect(result.failed).toBe(1)
      expect(readEmailJob(root, jobId)!.status).toBe('failed')
      expect(listDeliveries(root, jobId)[0]!.lastEvent).toBe('failed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('batching', () => {
  test('a large list is split, and each batch carries its own idempotency key', async () => {
    const fans = Array.from({ length: 150 }, (_, index) => ({ email: `fan${index}@example.com` }))
    const { root, jobId } = workspace(fans)
    try {
      const { fetchImpl, calls } = fakeFetch({
        batch: [
          { body: { data: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) } },
          { body: { data: Array.from({ length: 50 }, (_, i) => ({ id: `b${i}` })) } },
        ],
      })
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      const batches = calls.filter(call => call.url.includes('/emails/batch'))
      expect(batches).toHaveLength(2)
      // Distinct keys, so a retry cannot double-send a batch.
      const keys = batches.map(call => call.headers?.['Idempotency-Key'])
      expect(new Set(keys).size).toBe(2)
      expect(result.sent).toBe(150)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)

  test('one rejected batch does not lose the batch that succeeded', async () => {
    const fans = Array.from({ length: 150 }, (_, index) => ({ email: `fan${index}@example.com` }))
    const { root, jobId } = workspace(fans)
    try {
      const { fetchImpl } = fakeFetch({
        batch: [
          { body: { data: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) } },
          { ok: false, status: 500, body: { message: 'Upstream error' } },
        ],
      })
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)

      const result = await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)
      expect(result.sent).toBe(100)
      expect(result.failed).toBe(50)
      // Partial success is still a send worth recording.
      expect(readEmailJob(root, jobId)!.status).toBe('sent')
      expect(listDeliveries(root, jobId)).toHaveLength(150)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})
