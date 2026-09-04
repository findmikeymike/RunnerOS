import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultWebsiteManifest,
  latestChangeReceipt,
  listChangeReceipts,
  loadWebsiteManifest,
  saveWebsiteManifest,
  websiteRoot,
  type CapturedSubscriber,
  type WebsiteManifest,
} from '@craft-agent/shared/website'
import { listCommunityContacts, suppressCommunityContact, upsertCommunityContact } from '@craft-agent/shared/community'
import { WebsiteService } from './WebsiteService'
import { ResendCaptureSource, type CaptureFetchResult, type CaptureSource } from './capture-sources'
import type { FetchLike } from './adapters/types'

function workspace(capture?: Partial<WebsiteManifest['capture']>): string {
  const root = mkdtempSync(join(tmpdir(), 'website-capture-sync-'))
  mkdirSync(websiteRoot(root), { recursive: true })
  writeFileSync(join(websiteRoot(root), 'placeholder'), '', 'utf8')
  saveWebsiteManifest(root, {
    ...defaultWebsiteManifest(),
    capture: { backend: 'resend', formIds: ['newsletter'], ...capture },
  })
  return root
}

function fakeSource(pages: CaptureFetchResult[]): CaptureSource {
  let index = 0
  return {
    id: 'resend',
    fetchSince: async () => pages[Math.min(index++, pages.length - 1)]!,
  }
}

function signup(overrides: Partial<CapturedSubscriber> = {}): CapturedSubscriber {
  return {
    email: 'fan@example.com',
    formId: 'newsletter',
    capturedAt: '2026-09-05T10:00:00.000Z',
    ipHash: 'ip-1',
    ...overrides,
  }
}

const CONTEXT = { machineId: 'machine-1', origin: { kind: 'automation' as const, automationId: 'drain' } }

describe('capture drain', () => {
  test('signups land in Community and produce one receipt with counts', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService()
      const result = await service.syncCapture(root, CONTEXT, {
        source: fakeSource([{
          subscribers: [signup(), signup({ email: 'two@example.com', ipHash: 'ip-2' })],
        }]),
      })

      expect(result.ok).toBe(true)
      expect(result.imported).toBe(2)
      expect(listCommunityContacts(root)).toHaveLength(2)

      const receipt = latestChangeReceipt(root, 'subscriber-import')!
      expect(receipt.counts?.imported).toBe(2)
      expect(receipt.approval.tier).toBe('free')
      // The drain runs unattended, so nobody approved it.
      expect(receipt.approval.approvedBy).toBeUndefined()
      expect(JSON.stringify(receipt)).not.toContain('fan@example.com')

      expect(loadWebsiteManifest(root)!.capture.lastDrainAt).toBeTruthy()
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a suppressed fan is skipped, counted, and never re-added', async () => {
    const root = workspace()
    try {
      upsertCommunityContact(root, 'machine-1', { email: 'gone@example.com' })
      suppressCommunityContact(root, 'machine-1', 'gone@example.com', 'unsubscribed')

      const service = new WebsiteService()
      const result = await service.syncCapture(root, CONTEXT, {
        source: fakeSource([{ subscribers: [signup({ email: 'gone@example.com' })] }]),
      })

      expect(result.imported).toBe(0)
      expect(result.skippedSuppressed).toBe(1)
      expect(latestChangeReceipt(root, 'subscriber-import')!.counts?.skippedSuppressed).toBe(1)
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a drain with nothing new writes no receipt', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService()
      const result = await service.syncCapture(root, CONTEXT, {
        source: fakeSource([{ subscribers: [] }]),
      })

      expect(result.ok).toBe(true)
      expect(result.imported).toBe(0)
      expect(listChangeReceipts(root, { kinds: ['subscriber-import'] })).toHaveLength(0)
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a cursor is stored so the next pass resumes instead of restarting', async () => {
    const root = workspace()
    try {
      const service = new WebsiteService()
      await service.syncCapture(root, CONTEXT, {
        source: fakeSource([{ subscribers: [signup()], cursor: 'contact-99' }]),
      })

      expect(loadWebsiteManifest(root)!.capture.drainCursor).toBe('contact-99')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('with no capture backend the drain is a no-op, not an error', async () => {
    const root = workspace({ backend: 'none' })
    try {
      const service = new WebsiteService()
      const result = await service.syncCapture(root, CONTEXT)
      expect(result.ok).toBe(true)
      expect(result.imported).toBe(0)
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('resend capture source', () => {
  function fetchReturning(body: unknown, ok = true, status = 200): { fetchImpl: FetchLike; urls: string[] } {
    const urls: string[] = []
    return {
      urls,
      fetchImpl: async (url) => {
        urls.push(url)
        return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
      },
    }
  }

  test('contact properties become real consent evidence', async () => {
    const { fetchImpl, urls } = fetchReturning({
      data: [{
        id: 'c1',
        email: 'fan@example.com',
        first_name: 'Fan',
        created_at: '2026-09-05T10:00:00.000Z',
        properties: { aos_form_id: 'sneak-peek', aos_ip_hash: 'ip-9', aos_release: 'low-tide' },
      }],
      has_more: false,
    })

    const result = await new ResendCaptureSource({ apiKey: 're_x', fetchImpl }).fetchSince(undefined, 100)

    expect(result.subscribers).toHaveLength(1)
    expect(result.subscribers[0]).toMatchObject({
      email: 'fan@example.com',
      formId: 'sneak-peek',
      ipHash: 'ip-9',
      firstName: 'Fan',
      reward: { kind: 'download', releaseId: 'low-tide' },
    })
    expect(result.cursor).toBeUndefined()
    expect(urls[0]).toContain('limit=100')
  })

  test('an already-unsubscribed contact is not re-imported as a signup', async () => {
    const { fetchImpl } = fetchReturning({
      data: [{ id: 'c1', email: 'gone@example.com', unsubscribed: true }],
      has_more: false,
    })
    const result = await new ResendCaptureSource({ apiKey: 're_x', fetchImpl }).fetchSince(undefined, 100)
    expect(result.subscribers).toHaveLength(0)
  })

  test('more pages return a cursor and the next call sends it', async () => {
    const { fetchImpl, urls } = fetchReturning({
      data: [{ id: 'c9', email: 'fan@example.com' }],
      has_more: true,
    })
    const source = new ResendCaptureSource({ apiKey: 're_x', fetchImpl })

    expect((await source.fetchSince(undefined, 100)).cursor).toBe('c9')
    await source.fetchSince('c9', 100)
    expect(urls[1]).toContain('after=c9')
  })

  test('a failed read surfaces the status rather than silently importing nothing', async () => {
    const { fetchImpl } = fetchReturning({ message: 'nope' }, false, 401)
    await expect(
      new ResendCaptureSource({ apiKey: 're_bad', fetchImpl }).fetchSince(undefined, 100),
    ).rejects.toThrow(/401/)
  })
})
