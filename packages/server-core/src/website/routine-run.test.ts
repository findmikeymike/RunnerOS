import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cronForRoutine,
  grantTrustedMode,
  loadSiteContent,
  loadWebsiteManifest,
  recordCleanPublish,
  saveWebsiteManifest,
  type RoutineSignals,
  type WebsiteBrief,
} from '@craft-agent/shared/website'
import { WebsiteService, getSiteBuilderPath, type WebsiteToolResult } from './WebsiteService'

const CONTEXT = { machineId: 'machine-1', origin: { kind: 'automation' as const, automationId: 'site-routine' } }
const TODAY = '2026-09-15'

/** A real scaffolded site, so the routine exercises the actual builder. */
async function site(): Promise<{ root: string; service: WebsiteService }> {
  const root = mkdtempSync(join(tmpdir(), 'website-routine-'))
  const service = new WebsiteService(getSiteBuilderPath())
  const created = await service.create(root, { artistName: 'Low Tide' })
  if (!created.ok) throw new Error(`scaffold failed: ${String(created.error)}`)
  return { root, service }
}

function signals(overrides: Partial<RoutineSignals> = {}): RoutineSignals {
  return { releases: [], shows: [], ...overrides }
}

function brief(result: WebsiteToolResult): WebsiteBrief {
  return result.brief as WebsiteBrief
}

describe('running the routine', () => {
  test('a new show reaches the site, is built, and waits for one click', async () => {
    const { root, service } = await site()
    try {
      const result = await service.runRoutine(root, CONTEXT, {
        today: TODAY,
        signals: signals({
          shows: [{ id: 'denver', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }],
        }),
      })

      expect(result.ok).toBe(true)
      const card = brief(result)
      expect(card.site).toBeDefined()
      expect(card.site!.summary).toContain('Denver')
      expect(card.site!.tier).toBe('one-click')
      // Nothing may reach production without the artist.
      expect(card.site!.deployReceiptId).toBeUndefined()

      expect(loadSiteContent(root)!.shows).toHaveLength(1)
      expect(loadWebsiteManifest(root)!.history).toHaveLength(0)
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('a quiet run says so and writes no changes', async () => {
    const { root, service } = await site()
    try {
      const result = await service.runRoutine(root, CONTEXT, { today: TODAY, signals: signals() })

      expect(result.ok).toBe(true)
      const card = brief(result)
      expect(card.nothingToDo).toBe(true)
      expect(card.site).toBeUndefined()
      expect(result.summary).toBe('Nothing needed on the site this time.')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('the brief is kept on the manifest so the card survives a restart', async () => {
    const { root, service } = await site()
    try {
      await service.runRoutine(root, CONTEXT, {
        today: TODAY,
        signals: signals({ releases: [{ id: 'low-tide', title: 'Low Tide', type: 'single', date: '2026-09-01' }] }),
      })

      const stored = loadWebsiteManifest(root)!.pendingBrief
      expect(stored?.site?.summary).toContain('Low Tide')
      expect(loadWebsiteManifest(root)!.routine?.lastRunAt).toBeTruthy()

      service.clearBrief(root)
      expect(loadWebsiteManifest(root)!.pendingBrief).toBeUndefined()
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('things it noticed but will not fix arrive as notes, not edits', async () => {
    const { root, service } = await site()
    try {
      const result = await service.runRoutine(root, CONTEXT, {
        today: TODAY,
        signals: signals({ auditScore: 40, lastPostAt: '2026-09-12' }),
      })

      const card = brief(result)
      expect(card.site).toBeUndefined()
      expect(card.notes.join(' ')).toContain('40 out of 100')
      expect(card.notes.some(note => note.includes('no news'))).toBe(true)
      // Notes alone are not "nothing to do".
      expect(card.nothingToDo).toBeUndefined()
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('under trusted mode a content change publishes itself and the card offers undo', async () => {
    const { root, service } = await site()
    try {
      let manifest = loadWebsiteManifest(root)!
      for (let i = 0; i < 5; i += 1) manifest = recordCleanPublish(manifest)
      saveWebsiteManifest(root, {
        ...grantTrustedMode(manifest),
        adapter: 'cloudflare-workers',
        provider: { siteId: 'lowtide', accountId: 'acct-1' },
        targetApproval: { approvedAt: '2026-09-01T00:00:00.000Z', approvedBy: 'user', target: 'lowtide.workers.dev' },
      })

      // Stand in for the host so no credential or network is needed.
      Object.defineProperty(service, 'resolveAdapter', {
        value: async () => ({
          id: 'cloudflare-workers',
          capabilities: { previewDeploys: true, functions: true, kv: true, externalDns: false },
          verify: async () => ({ ok: true }),
          createSite: async () => ({ siteId: 'lowtide' }),
          deploy: async () => ({ deployId: 'deploy-1', url: 'https://lowtide.workers.dev' }),
          status: async () => ({ live: true }),
          setDomain: async () => ({ name: 'x', state: 'pending-dns' as const }),
          checkDomain: async () => ({ name: 'x', state: 'pending-dns' as const }),
        }),
        writable: true,
      })

      const result = await service.runRoutine(root, CONTEXT, {
        today: TODAY,
        signals: signals({ shows: [{ id: 'denver', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }] }),
      })

      const card = brief(result)
      expect(card.site!.tier).toBe('trusted')
      expect(card.site!.deployReceiptId).toBeTruthy()
      expect(loadWebsiteManifest(root)!.urls.production).toBe('https://lowtide.workers.dev')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('trusted mode without an approved target still stops rather than publishing', async () => {
    const { root, service } = await site()
    try {
      let manifest = loadWebsiteManifest(root)!
      for (let i = 0; i < 5; i += 1) manifest = recordCleanPublish(manifest)
      // Trusted, but the artist never approved a destination.
      saveWebsiteManifest(root, grantTrustedMode(manifest))

      const result = await service.runRoutine(root, CONTEXT, {
        today: TODAY,
        signals: signals({ shows: [{ id: 'denver', date: '2026-10-02', city: 'Denver', venue: 'Bluebird' }] }),
      })

      expect(brief(result).site!.tier).toBe('one-click')
      expect(loadWebsiteManifest(root)!.history).toHaveLength(0)
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('choosing how often it runs', () => {
  test('the cadence is stored and reported back in plain language', async () => {
    const { root, service } = await site()
    try {
      const weekly = service.setRoutine(root, { cadence: 'weekly', dayOfWeek: 5, hour: 17 })
      expect(weekly.ok).toBe(true)
      expect(weekly.cron).toBe('0 17 * * 5')
      expect(weekly.description).toBe('Every Friday at 5:00 PM')
      expect(loadWebsiteManifest(root)!.routine?.cadence).toBe('weekly')

      const monthly = service.setRoutine(root, { cadence: 'monthly', dayOfMonth: 3 })
      expect(monthly.cron).toBe('0 17 3 * *')
      expect(monthly.description).toBe('The 3rd of each month at 5:00 PM')

      const manual = service.setRoutine(root, { cadence: 'manual' })
      expect(manual.cron).toBeNull()
      expect(manual.description).toBe('Only when you ask')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('changing cadence keeps the hour the artist already picked', async () => {
    const { root, service } = await site()
    try {
      service.setRoutine(root, { cadence: 'weekly', dayOfWeek: 2, hour: 8 })
      const switched = service.setRoutine(root, { cadence: 'monthly', dayOfMonth: 10 })
      expect(switched.cron).toBe('0 8 10 * *')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test('a manual routine has no schedule, so nothing runs unasked', () => {
    expect(cronForRoutine({ cadence: 'manual' })).toBeNull()
  })
})
