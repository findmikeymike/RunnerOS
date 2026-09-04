import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CloudflareWorkersAdapter, assetHash, buildAssetManifest } from './cloudflare'
import { AdapterError, type FetchLike } from './types'

function distWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cf-dist-'))
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents, 'utf8')
  }
  return root
}

interface Call { url: string; method: string; token?: string; body?: unknown }

function fakeFetch(responses: Array<{ ok?: boolean; status?: number; body: unknown }>): {
  fetchImpl: FetchLike
  calls: Call[]
} {
  const calls: Call[] = []
  let index = 0
  const fetchImpl: FetchLike = async (url, init) => {
    const auth = init?.headers?.Authorization
    calls.push({
      url,
      method: init?.method ?? 'GET',
      token: typeof auth === 'string' ? auth.replace('Bearer ', '') : undefined,
      body: init?.body,
    })
    const next = responses[index] ?? responses[responses.length - 1]
    index += 1
    return {
      ok: next?.ok ?? true,
      status: next?.status ?? 200,
      json: async () => next?.body,
      text: async () => JSON.stringify(next?.body),
    }
  }
  return { fetchImpl, calls }
}

function adapter(fetchImpl: FetchLike, zoneId?: string): CloudflareWorkersAdapter {
  return new CloudflareWorkersAdapter({
    token: 'cf-token',
    accountId: 'acct-1',
    scriptName: 'lowtide',
    fetchImpl,
    zoneId,
  })
}

describe('cloudflare asset manifest', () => {
  test('hashes are 32 hex chars over base64 content plus extension', () => {
    const hash = assetHash(Buffer.from('hello'), 'index.html')
    expect(hash).toMatch(/^[a-f0-9]{32}$/)
    // Same bytes, different extension must not collide.
    expect(hash).not.toBe(assetHash(Buffer.from('hello'), 'index.css'))
  })

  test('manifest keys are absolute paths and identical files upload once', () => {
    const dist = distWith({
      'index.html': '<h1>a</h1>',
      'about/index.html': '<h1>a</h1>',
      'styles.css': 'body{}',
    })
    try {
      const { manifest, byHash } = buildAssetManifest(dist)
      expect(Object.keys(manifest).sort()).toEqual(['/about/index.html', '/index.html', '/styles.css'])
      expect(manifest['/index.html']!.size).toBe(10)
      // Two identical .html files share a hash, so only two uploads exist.
      expect(byHash.size).toBe(2)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})

describe('cloudflare deploy', () => {
  test('opens a session, uploads each bucket with the upload jwt, then PUTs the script', async () => {
    const dist = distWith({ 'index.html': '<h1>hi</h1>', 'styles.css': 'body{}' })
    try {
      const { manifest } = buildAssetManifest(dist)
      const hashes = Object.values(manifest).map(entry => entry.hash)

      // Buckets must carry the real hashes so the adapter can resolve them.
      const { fetchImpl: realFetch, calls: realCalls } = fakeFetch([
        { body: { success: true, result: { jwt: 'upload-jwt', buckets: [[hashes[0]!], [hashes[1]!]] } } },
        { body: { success: true, result: {} } },
        { body: { success: true, result: { jwt: 'completion-jwt' } } },
        { body: { success: true, result: { id: 'version-9' } } },
      ])

      const result = await adapter(realFetch).deploy({
        distDir: dist,
        target: 'production',
        buildHash: 'abc123def456',
      })

      expect(result.deployId).toBe('version-9')
      expect(result.url).toBe('https://lowtide.workers.dev')

      expect(realCalls[0]!.url).toContain('/workers/scripts/lowtide/assets-upload-session')
      expect(realCalls[0]!.token).toBe('cf-token')

      // Uploads authenticate with the session jwt, not the account token.
      expect(realCalls[1]!.url).toContain('/workers/assets/upload?base64=true')
      expect(realCalls[1]!.token).toBe('upload-jwt')
      expect(realCalls[2]!.token).toBe('upload-jwt')

      const put = realCalls[3]!
      expect(put.method).toBe('PUT')
      expect(put.url).toContain('/workers/scripts/lowtide')
      expect(put.token).toBe('cf-token')
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  test('a preview deploy targets the preview script', async () => {
    const dist = distWith({ 'index.html': '<h1>hi</h1>' })
    try {
      const { fetchImpl, calls } = fakeFetch([
        { body: { success: true, result: { jwt: undefined, buckets: [] } } },
        { body: { success: true, result: { id: 'v1' } } },
      ])
      // No jwt and no buckets means every asset was already stored.
      await expect(
        adapter(fetchImpl).deploy({ distDir: dist, target: 'preview', buildHash: 'h' }),
      ).rejects.toThrow(/completion token/)
      expect(calls[0]!.url).toContain('/workers/scripts/lowtide-preview/assets-upload-session')
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  test('an empty build is refused before any network call', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'cf-empty-'))
    try {
      const { fetchImpl, calls } = fakeFetch([{ body: { success: true, result: {} } }])
      await expect(
        adapter(fetchImpl).deploy({ distDir: dist, target: 'production', buildHash: 'h' }),
      ).rejects.toThrow(/empty build/)
      expect(calls).toHaveLength(0)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })

  test('cloudflare error bodies surface their message and mark retryability', async () => {
    const dist = distWith({ 'index.html': 'x' })
    try {
      const { fetchImpl } = fakeFetch([
        { ok: false, status: 403, body: { success: false, errors: [{ message: 'Insufficient permissions' }] } },
      ])
      await expect(
        adapter(fetchImpl).deploy({ distDir: dist, target: 'production', buildHash: 'h' }),
      ).rejects.toThrow(/Insufficient permissions/)

      const { fetchImpl: rateLimited } = fakeFetch([
        { ok: false, status: 429, body: { success: false, errors: [{ message: 'Rate limited' }] } },
      ])
      const error = await adapter(rateLimited)
        .deploy({ distDir: dist, target: 'production', buildHash: 'h' })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(AdapterError)
      expect((error as AdapterError).retryable).toBe(true)
    } finally {
      rmSync(dist, { recursive: true, force: true })
    }
  })
})

describe('cloudflare domains', () => {
  test('without a zone the adapter returns nameserver steps and never claims active', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { success: true, result: {} } }])
    const state = await adapter(fetchImpl).setDomain('lowtide.com')

    expect(state.state).toBe('pending-dns')
    expect(state.steps?.length).toBeGreaterThan(0)
    expect(state.steps?.join(' ')).toContain('nameservers')
    expect(calls).toHaveLength(0)
  })

  test('with a zone the domain is attached and reported active', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { success: true, result: { id: 'rec-1' } } }])
    const state = await adapter(fetchImpl, 'zone-1').setDomain('lowtide.com')

    expect(state.state).toBe('active')
    expect(calls[0]!.method).toBe('PUT')
    expect(calls[0]!.url).toContain('/workers/domains/records')
  })

  test('checkDomain reports pending until cloudflare lists the hostname', async () => {
    const { fetchImpl } = fakeFetch([{ body: { success: true, result: [{ hostname: 'other.com' }] } }])
    expect((await adapter(fetchImpl).checkDomain('lowtide.com')).state).toBe('pending-dns')

    const { fetchImpl: attached } = fakeFetch([
      { body: { success: true, result: [{ hostname: 'lowtide.com' }] } },
    ])
    expect((await adapter(attached).checkDomain('lowtide.com')).state).toBe('active')
  })
})

describe('cloudflare verify', () => {
  test('a failing token returns actionable guidance instead of throwing', async () => {
    const { fetchImpl } = fakeFetch([
      { ok: false, status: 403, body: { success: false, errors: [{ message: 'Forbidden' }] } },
    ])
    const result = await adapter(fetchImpl).verify()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Workers Scripts Write')
  })
})
