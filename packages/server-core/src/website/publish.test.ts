import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultWebsiteManifest,
  grantTrustedMode,
  latestChangeReceipt,
  listChangeReceipts,
  loadWebsiteManifest,
  recordCleanPublish,
  saveWebsiteManifest,
  websiteDistDir,
  type WebsiteManifest,
} from '@craft-agent/shared/website'
import { approvePublishTarget, publishSite, rollbackSite, siteHistory } from './publish'
import { hasDeploySnapshot, pruneDeploySnapshots } from './deploy-snapshots'
import type { AdapterDeployInput, SiteDeployAdapter } from './adapters/types'

function workspace(manifest?: Partial<WebsiteManifest>): string {
  const root = mkdtempSync(join(tmpdir(), 'website-publish-'))
  const dist = websiteDistDir(root)
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<h1>site</h1>', 'utf8')
  saveWebsiteManifest(root, {
    ...defaultWebsiteManifest(),
    lastBuild: { at: '2026-09-01T00:00:00.000Z', hash: 'hash-a', designHash: 'design-1', auditScore: 92, warnings: 1, fileCount: 1, bytes: 13 },
    targetApproval: { approvedAt: '2026-09-01T00:00:00.000Z', approvedBy: 'user', target: 'lowtide.workers.dev' },
    ...manifest,
  })
  return root
}

function fakeAdapter(): { adapter: SiteDeployAdapter; deploys: AdapterDeployInput[] } {
  const deploys: AdapterDeployInput[] = []
  let counter = 0
  const adapter = {
    id: 'cloudflare-workers',
    capabilities: { previewDeploys: true, functions: true, kv: true, externalDns: false },
    verify: async () => ({ ok: true as const }),
    createSite: async () => ({ siteId: 'lowtide' }),
    deploy: async (input: AdapterDeployInput) => {
      deploys.push(input)
      counter += 1
      return { deployId: `deploy-${counter}`, url: 'https://lowtide.workers.dev' }
    },
    status: async () => ({ live: true }),
    setDomain: async () => ({ name: 'x', state: 'pending-dns' as const }),
    checkDomain: async () => ({ name: 'x', state: 'pending-dns' as const }),
  } satisfies SiteDeployAdapter
  return { adapter, deploys }
}

function deps(adapter: SiteDeployAdapter, now = '2026-09-05T00:00:00.000Z') {
  return { resolveAdapter: async () => adapter, machineId: 'machine-1', now: () => now }
}

const ORIGIN = { kind: 'automation' as const, automationId: 'weekly' }

function publishInput(overrides: Record<string, unknown> = {}) {
  return {
    target: 'production' as const,
    buildHash: 'hash-a',
    changeClass: 'content-only' as const,
    origin: ORIGIN,
    summary: 'Added the Denver show',
    approval: { boundTo: 'hash-a', approvedAt: '2026-09-05T00:00:00.000Z' },
    ...overrides,
  }
}

describe('preview publishing', () => {
  test('a preview deploy needs no approval and writes no receipt', async () => {
    const root = workspace({ targetApproval: undefined })
    try {
      const { adapter, deploys } = fakeAdapter()
      const result = await publishSite(root, publishInput({ target: 'preview', approval: undefined }), deps(adapter))

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.tier).toBe('free')
        expect(result.receiptId).toBeUndefined()
      }
      expect(deploys[0]!.target).toBe('preview')
      expect(listChangeReceipts(root)).toHaveLength(0)
      // Previews are not retained; only production can be rolled back to.
      expect(hasDeploySnapshot(root, 'deploy-1')).toBe(false)
      expect(loadWebsiteManifest(root)!.urls.preview).toBe('https://lowtide.workers.dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('production publishing', () => {
  test('without target approval it refuses and never calls the adapter', async () => {
    const root = workspace({ targetApproval: undefined })
    try {
      const { adapter, deploys } = fakeAdapter()
      const result = await publishSite(root, publishInput(), deps(adapter))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.failure).toBe('no-target-approval')
        expect(result.needsApproval).toBe(true)
      }
      expect(deploys).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('approving the target once unblocks publishing', async () => {
    const root = workspace({ targetApproval: undefined })
    try {
      approvePublishTarget(root, 'lowtide.workers.dev', { now: '2026-09-04T00:00:00.000Z' })
      const { adapter } = fakeAdapter()
      const result = await publishSite(root, publishInput(), deps(adapter))
      expect(result.ok).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a bound approval publishes, retains a snapshot, and writes a receipt matching the hash', async () => {
    const root = workspace()
    try {
      const { adapter } = fakeAdapter()
      const result = await publishSite(root, publishInput({ why: ['A show was added to the calendar'] }), deps(adapter))

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.tier).toBe('one-click')

      const receipt = latestChangeReceipt(root, 'site-publish')!
      expect(receipt.after?.buildHash).toBe('hash-a')
      expect(receipt.after?.deployId).toBe('deploy-1')
      expect(receipt.approval.tier).toBe('one-click')
      expect(receipt.approval.approvedBy).toBe('user')
      expect(receipt.audit?.score).toBe(92)
      expect(receipt.why).toEqual(['A show was added to the calendar'])
      expect(receipt.rollback?.kind).toBe('none')

      expect(hasDeploySnapshot(root, 'deploy-1')).toBe(true)
      const manifest = loadWebsiteManifest(root)!
      expect(manifest.urls.production).toBe('https://lowtide.workers.dev')
      expect(manifest.history[0]!.status).toBe('live')
      expect(manifest.publishPolicy.cleanPublishStreak).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a rebuild between approval and publish invalidates the approval', async () => {
    const root = workspace()
    try {
      const { adapter, deploys } = fakeAdapter()
      // The artist approved hash-a, but the site was rebuilt to hash-b.
      const manifest = loadWebsiteManifest(root)!
      saveWebsiteManifest(root, { ...manifest, lastBuild: { ...manifest.lastBuild!, hash: 'hash-b' } })

      const result = await publishSite(root, publishInput(), deps(adapter))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe('stale-build')
      expect(deploys).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an approval bound to a different hash is refused', async () => {
    const root = workspace()
    try {
      const { adapter, deploys } = fakeAdapter()
      const result = await publishSite(
        root,
        publishInput({ approval: { boundTo: 'hash-old', approvedAt: '2026-09-04T00:00:00.000Z' } }),
        deps(adapter),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.failure).toBe('hash-changed')
        expect(result.needsApproval).toBe(true)
      }
      expect(deploys).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('no approval at all is refused with needsApproval', async () => {
    const root = workspace()
    try {
      const { adapter, deploys } = fakeAdapter()
      const result = await publishSite(root, publishInput({ approval: undefined }), deps(adapter))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe('no-approval')
      expect(deploys).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('trusted mode', () => {
  test('content-only publishes with no approval and records the trusted tier', async () => {
    let manifest = defaultWebsiteManifest()
    for (let i = 0; i < 5; i += 1) manifest = recordCleanPublish(manifest)
    const root = workspace({ publishPolicy: grantTrustedMode(manifest).publishPolicy })
    try {
      const { adapter } = fakeAdapter()
      const result = await publishSite(root, publishInput({ approval: undefined }), deps(adapter))

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.tier).toBe('trusted')

      const receipt = latestChangeReceipt(root, 'site-publish')!
      expect(receipt.approval.tier).toBe('trusted')
      expect(receipt.approval.approvedBy).toBeUndefined()
      expect(receipt.rollback?.kind).toBe('none')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a design change still stops for approval under trusted mode', async () => {
    let manifest = defaultWebsiteManifest()
    for (let i = 0; i < 5; i += 1) manifest = recordCleanPublish(manifest)
    const root = workspace({ publishPolicy: grantTrustedMode(manifest).publishPolicy })
    try {
      const { adapter, deploys } = fakeAdapter()
      const result = await publishSite(
        root,
        publishInput({ changeClass: 'design', approval: undefined }),
        deps(adapter),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.needsApproval).toBe(true)
      expect(deploys).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a template edit mislabelled as content-only is still caught and stopped', async () => {
    let seed = defaultWebsiteManifest()
    for (let i = 0; i < 5; i += 1) seed = recordCleanPublish(seed)
    const root = workspace({ publishPolicy: grantTrustedMode(seed).publishPolicy })
    try {
      const { adapter } = fakeAdapter()
      // First publish establishes what design is currently live.
      await publishSite(root, publishInput({ approval: undefined }), deps(adapter))

      // Templates changed, but the caller claims this is only content.
      const manifest = loadWebsiteManifest(root)!
      saveWebsiteManifest(root, {
        ...manifest,
        lastBuild: { ...manifest.lastBuild!, designHash: 'design-2' },
      })

      const { adapter: second, deploys } = fakeAdapter()
      const result = await publishSite(
        root,
        publishInput({ changeClass: 'content-only', approval: undefined }),
        deps(second),
      )

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.needsApproval).toBe(true)
      expect(deploys).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('an unchanged design keeps a content publish on the trusted path', async () => {
    let seed = defaultWebsiteManifest()
    for (let i = 0; i < 5; i += 1) seed = recordCleanPublish(seed)
    const root = workspace({ publishPolicy: grantTrustedMode(seed).publishPolicy })
    try {
      const { adapter } = fakeAdapter()
      await publishSite(root, publishInput({ approval: undefined }), deps(adapter))
      const second = await publishSite(root, publishInput({ approval: undefined }), deps(adapter))

      expect(second.ok).toBe(true)
      if (second.ok) expect(second.tier).toBe('trusted')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the fifth clean publish offers trusted mode exactly once', async () => {
    const root = workspace()
    try {
      const { adapter } = fakeAdapter()
      const offers: boolean[] = []
      for (let i = 0; i < 6; i += 1) {
        const result = await publishSite(root, publishInput(), deps(adapter))
        if (result.ok) offers.push(Boolean(result.trustedModeOffered))
      }
      expect(offers).toEqual([false, false, false, false, true, false])
      // Being offered must not enable it.
      expect(loadWebsiteManifest(root)!.publishPolicy.contentOnly).toBe('needs-you')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('rollback', () => {
  test('restores the previous deploy, writes a receipt, and revokes trusted mode', async () => {
    let seed = defaultWebsiteManifest()
    for (let i = 0; i < 5; i += 1) seed = recordCleanPublish(seed)
    const root = workspace({ publishPolicy: grantTrustedMode(seed).publishPolicy })
    try {
      const { adapter } = fakeAdapter()
      await publishSite(root, publishInput({ approval: undefined }), deps(adapter))
      await publishSite(root, publishInput({ approval: undefined }), deps(adapter))

      const result = await rollbackSite(root, { origin: { kind: 'user' } }, deps(adapter))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.trustedModeRevoked).toBe(true)

      const manifest = loadWebsiteManifest(root)!
      expect(manifest.publishPolicy.contentOnly).toBe('needs-you')
      expect(manifest.publishPolicy.cleanPublishStreak).toBe(0)
      expect(manifest.publishPolicy.trustedRevokedAt).toBeTruthy()
      expect(manifest.history[0]!.status).toBe('live')
      expect(manifest.history.find(entry => entry.id === 'deploy-2')!.status).toBe('rolled-back')

      const receipt = latestChangeReceipt(root, 'site-rollback')!
      expect(receipt.before?.deployId).toBe('deploy-2')
      expect(receipt.after?.buildHash).toBe('hash-a')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rollback is refused when the retained build is gone', async () => {
    const root = workspace()
    try {
      const { adapter } = fakeAdapter()
      await publishSite(root, publishInput(), deps(adapter))
      await publishSite(root, publishInput(), deps(adapter))
      // Retention dropped the older build.
      pruneDeploySnapshots(root, 1)

      const result = await rollbackSite(root, { origin: { kind: 'user' } }, deps(adapter))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/no longer retained/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('frequent previews never evict production history, so rollback still resolves', async () => {
    const root = workspace()
    try {
      const { adapter } = fakeAdapter()
      await publishSite(root, publishInput(), deps(adapter))
      await publishSite(root, publishInput(), deps(adapter))

      // The weekly routine previews on every run; a shared cap would bury
      // the production records that rollback resolves against.
      for (let i = 0; i < 60; i += 1) {
        await publishSite(root, publishInput({ target: 'preview', approval: undefined }), deps(adapter))
      }

      const manifest = loadWebsiteManifest(root)!
      const production = manifest.history.filter(entry => entry.target === 'production')
      expect(production).toHaveLength(2)

      const result = await rollbackSite(root, { origin: { kind: 'user' } }, deps(adapter))
      expect(result.ok).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('history marks which deploys can still be rolled back to', async () => {
    const root = workspace()
    try {
      const { adapter } = fakeAdapter()
      await publishSite(root, publishInput(), deps(adapter))
      await publishSite(root, publishInput(), deps(adapter))

      const history = siteHistory(root)
      expect(history[0]!.status).toBe('live')
      expect(history[0]!.canRollBackTo).toBe(false)
      expect(history[1]!.canRollBackTo).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
