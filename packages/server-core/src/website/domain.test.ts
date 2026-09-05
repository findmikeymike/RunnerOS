import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultWebsiteManifest,
  latestChangeReceipt,
  loadWebsiteManifest,
  saveWebsiteManifest,
  websiteRoot,
} from '@craft-agent/shared/website'
import { WebsiteService } from './WebsiteService'

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'website-domain-'))
  mkdirSync(websiteRoot(root), { recursive: true })
  writeFileSync(join(websiteRoot(root), 'placeholder'), '', 'utf8')
  saveWebsiteManifest(root, {
    ...defaultWebsiteManifest(),
    adapter: 'cloudflare-workers',
    provider: { siteId: 'lowtide', accountId: 'acct-1' },
  })
  return root
}

const CONTEXT = { machineId: 'machine-1', origin: { kind: 'user' as const } }

/** Stand in for the Cloudflare adapter so no credential or network is needed. */
function serviceWithAdapter(overrides: Record<string, unknown> = {}): WebsiteService {
  const service = new WebsiteService()
  Object.defineProperty(service, 'resolveAdapter', {
    value: async () => ({
      id: 'cloudflare-workers',
      capabilities: { previewDeploys: true, functions: true, kv: true, externalDns: false },
      verify: async () => ({ ok: true }),
      createSite: async () => ({ siteId: 'lowtide' }),
      deploy: async () => ({ deployId: 'd1', url: 'https://lowtide.workers.dev' }),
      status: async () => ({ live: true }),
      setDomain: async (domain: string) => ({
        name: domain,
        state: 'pending-dns' as const,
        steps: ['Add the site to Cloudflare', 'Update nameservers at your registrar'],
      }),
      checkDomain: async (domain: string) => ({ name: domain, state: 'active' as const }),
      ...overrides,
    }),
    writable: true,
  })
  return service
}

describe('domain cutover', () => {
  test('a slow domain response preserves newer publish state', async () => {
    const root = workspace()
    try {
      const current = loadWebsiteManifest(root)!
      saveWebsiteManifest(root, { ...current, domain: { name: 'lowtide.com', state: 'pending-dns' } })
      const service = serviceWithAdapter({ checkDomain: async () => {
        const latest = loadWebsiteManifest(root)!
        saveWebsiteManifest(root, { ...latest, urls: { production: 'https://new.example' }, history: [{ id: 'new', target: 'production', at: new Date().toISOString(), url: 'https://new.example', buildHash: 'new', origin: { kind: 'user' }, status: 'live' }] })
        return { name: 'lowtide.com', state: 'active' }
      } })
      expect((await service.checkDomain(root)).ok).toBe(true)
      expect(loadWebsiteManifest(root)!.history[0]!.id).toBe('new')
      expect(loadWebsiteManifest(root)!.urls.production).toBe('https://new.example')
      service.dispose()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test('the previous DNS is recorded before any instruction is given', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      const seen: string[] = []

      const result = await service.setDomain(root, { domain: 'lowtide.com' }, CONTEXT, {
        resolveDns: async (domain) => {
          seen.push(domain)
          return ['A 203.0.113.10', 'NS ns1.oldhost.com']
        },
      })

      expect(result.ok).toBe(true)
      expect(seen).toEqual(['lowtide.com'])

      const receipt = latestChangeReceipt(root, 'domain-cutover')!
      expect(receipt.before?.dns).toEqual(['A 203.0.113.10', 'NS ns1.oldhost.com'])
      // The way back is spelled out, not implied.
      expect(receipt.rollback?.kind).toBe('dns-steps')
      expect(receipt.rollback?.steps?.join(' ')).toContain('203.0.113.10')

      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a pending domain is never reported as active', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      const result = await service.setDomain(root, { domain: 'lowtide.com' }, CONTEXT, {
        resolveDns: async () => [],
      })

      expect(result.ok).toBe(true)
      expect(loadWebsiteManifest(root)!.domain?.state).toBe('pending-dns')
      expect(latestChangeReceipt(root, 'domain-cutover')!.summary).toContain('Started pointing')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a domain with nothing to preserve records no false rollback path', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      await service.setDomain(root, { domain: 'brandnew.com' }, CONTEXT, { resolveDns: async () => [] })

      expect(latestChangeReceipt(root, 'domain-cutover')!.rollback?.kind).toBe('none')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a DNS lookup failure does not block the cutover', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      const result = await service.setDomain(root, { domain: 'lowtide.com' }, CONTEXT, {
        resolveDns: async () => { throw new Error('ENOTFOUND') },
      })
      expect(result.ok).toBe(true)
      expect(latestChangeReceipt(root, 'domain-cutover')!.before?.dns).toEqual([])
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a malformed domain is refused before anything is read or written', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      let resolved = false
      const result = await service.setDomain(root, { domain: 'not a domain' }, CONTEXT, {
        resolveDns: async () => { resolved = true; return [] },
      })

      expect(result.ok).toBe(false)
      expect(resolved).toBe(false)
      expect(loadWebsiteManifest(root)!.domain).toBeUndefined()
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a URL is accepted and normalised to a bare domain', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      await service.setDomain(root, { domain: 'HTTPS://LowTide.com/home' }, CONTEXT, { resolveDns: async () => [] })
      expect(loadWebsiteManifest(root)!.domain?.name).toBe('lowtide.com')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('checking a domain updates its state from the host', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      await service.setDomain(root, { domain: 'lowtide.com' }, CONTEXT, { resolveDns: async () => [] })
      expect(loadWebsiteManifest(root)!.domain?.state).toBe('pending-dns')

      const checked = await service.checkDomain(root)
      expect(checked.ok).toBe(true)
      expect(loadWebsiteManifest(root)!.domain?.state).toBe('active')
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('checking with no domain connected is a no-op', async () => {
    const root = workspace()
    try {
      const service = serviceWithAdapter()
      const result = await service.checkDomain(root)
      expect(result.ok).toBe(true)
      expect(result.domain).toBeUndefined()
      service.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
