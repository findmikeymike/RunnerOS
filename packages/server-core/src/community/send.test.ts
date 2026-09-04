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
  updateEmailJobDraft,
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
    if (url.includes('/unsubscribe')) return { ok: true, status: 200, text: async () => '', json: async () => ({ protocol: 'artist-os-unsubscribe-v1', ready: true }) }
    if (url.includes('/contacts?')) return { ok: true, status: 200, text: async () => '', json: async () => ({ data: [], has_more: false }) }
    const next = url.includes('/domains')
      ? handlers.domains ?? { body: { data: [{ name: 'lowtide.com', status: 'verified' }] } }
      : (handlers.batch ?? [])[batchIndex++] ?? { body: { data: JSON.parse(String(init?.body)).map((_: unknown, i: number) => ({ id: `msg-${i}` })) } }
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

  test('every message carries a working form link without falsely advertising one-click', async () => {
    const { root, jobId } = workspace()
    try {
      const { fetchImpl, calls } = fakeFetch({})
      const mail = service(fetchImpl)
      mail.approve(root, MACHINE, jobId)
      await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)

      const batch = calls.find(call => call.url.includes('/emails/batch'))!
      const messages = JSON.parse(String(batch.body)) as Array<{ headers: Record<string, string>; html: string }>

      expect(messages[0]!.headers['List-Unsubscribe-Post']).toBeUndefined()
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
  test('stale draft writes cannot overwrite a newer decision', () => {
    const { root, jobId } = workspace()
    try {
      const stale = readEmailJob(root, jobId)!
      const mail = service(fakeFetch({}).fetchImpl)
      mail.approve(root, MACHINE, jobId)
      expect(() => updateEmailJobDraft(root, MACHINE, stale, { subject: 'Changed after approval' })).toThrow('changed')
      expect(readEmailJob(root, jobId)!.content.subject).toBe(stale.content.subject)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('a confirmed failed batch can retry without resending accepted recipients', async () => {
    const { root, jobId } = workspace(Array.from({ length: 101 }, (_, i) => ({ email: `fan${i}@example.com` })))
    try {
      const fake = fakeFetch({ batch: [
        { body: { data: Array.from({ length: 100 }, (_, i) => ({ id: `a${i}` })) } },
        { ok: false, status: 429, body: { message: 'Rate limited' } },
        { body: { data: [{ id: 'retry' }] } },
      ] })
      const mail = service(fake.fetchImpl)
      mail.approve(root, MACHINE, jobId)
      expect((await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(false)
      expect(listDeliveries(root, jobId)).toHaveLength(101)
      expect(mail.approve(root, MACHINE, jobId).ok).toBe(true)
      expect((await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(true)
      const batches = fake.calls.filter(call => call.url.includes('/emails/batch'))
      expect(JSON.parse(String(batches[2]!.body))).toHaveLength(1)
      expect(listDeliveries(root, jobId)).toHaveLength(101)
      expect(readEmailJob(root, jobId)!.send?.sentCount).toBe(101)
      expect(readEmailJob(root, jobId)!.status).toBe('sent')
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 20000)

  test('two simultaneous send calls admit only one broadcast', async () => {
    const { root, jobId } = workspace()
    try {
      const fake = fakeFetch({})
      const mail = service(fake.fetchImpl)
      mail.approve(root, MACHINE, jobId)
      const results = await Promise.all([
        mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN),
        mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN),
      ])
      expect(results.filter(row => row.ok)).toHaveLength(1)
      expect(fake.calls.filter(call => call.url.includes('/emails/batch'))).toHaveLength(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  test('cancel during preflight cannot be overwritten by send', async () => {
    const { root, jobId } = workspace()
    try {
      const fake = fakeFetch({})
      let release!: () => void
      let entered!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const ready = new Promise<void>(resolve => { entered = resolve })
      const mail = service(async (url, init) => {
        if (url.includes('/domains')) { entered(); await barrier }
        return fake.fetchImpl(url, init)
      })
      mail.approve(root, MACHINE, jobId)
      const pending = mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)
      await ready
      expect(mail.cancel(root, MACHINE, jobId).ok).toBe(true)
      release()
      expect((await pending).ok).toBe(false)
      expect(readEmailJob(root, jobId)!.status).toBe('cancelled')
      expect(fake.calls.filter(call => call.url.includes('/emails/batch'))).toHaveLength(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('preflight failure can be approved and retried without making a new job', async () => {
    const { root, jobId } = workspace()
    try {
      const offline = service(async () => { throw new Error('offline') })
      expect(offline.approve(root, MACHINE, jobId).ok).toBe(true)
      expect((await offline.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(false)
      const fake = fakeFetch({})
      const online = service(fake.fetchImpl)
      expect(online.approve(root, MACHINE, jobId).ok).toBe(true)
      expect((await online.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(true)
      expect(fake.calls.filter(call => call.url.includes('/emails/batch'))).toHaveLength(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('provider opt-outs are applied to existing local fans before sending', async () => {
    const { root, jobId } = workspace()
    try {
      const fake = fakeFetch({})
      const mail = service(async (url, init) => url.includes('/contacts?')
        ? { ok: true, status: 200, text: async () => '', json: async () => ({ data: [{ id: 'c1', email: 'fan@example.com', unsubscribed: true }] }) }
        : fake.fetchImpl(url, init))
      mail.approve(root, MACHINE, jobId)
      expect((await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(false)
      expect(resolveSendAudience(root, readEmailJob(root, jobId)!).members).toHaveLength(0)
      expect(fake.calls.filter(call => call.url.includes('/emails/batch'))).toHaveLength(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('malformed acceptance is uncertain, never fabricated as sent', async () => {
    const { root, jobId } = workspace()
    try {
      const fake = fakeFetch({ batch: [{ body: {} }] })
      const mail = service(fake.fetchImpl)
      mail.approve(root, MACHINE, jobId)
      expect((await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(false)
      expect(listDeliveries(root, jobId)[0]!.error).toContain('uncertain')
      expect(readEmailJob(root, jobId)!.status).toBe('failed')
      expect(mail.approve(root, MACHINE, jobId).ok).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('unavailable unsubscribe page prevents sending', async () => {
    const { root, jobId } = workspace()
    try {
      const fake = fakeFetch({})
      const mail = service(async (url, init) => url.includes('/unsubscribe')
        ? { ok: false, status: 404, text: async () => '', json: async () => ({}) }
        : fake.fetchImpl(url, init))
      mail.approve(root, MACHINE, jobId)
      expect((await mail.send(root, MACHINE, jobId, PROVIDER, ORIGIN)).ok).toBe(false)
      expect(fake.calls.filter(call => call.url.includes('/emails/batch'))).toHaveLength(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
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
      expect(readEmailJob(root, jobId)!.status).toBe('failed')
      expect(listDeliveries(root, jobId)).toHaveLength(150)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 20_000)
})
