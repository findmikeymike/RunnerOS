import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { materializeReleaseKitItem, resolveReleaseKitItemPath, updateReleaseKitItemUsage } from '@craft-agent/shared/release-kit'
import type { LoadedSource } from '@craft-agent/shared/sources'
import {
  computeScheduledSocialBrowserActionDigest,
  fingerprintScheduledSocialBrowserMedia,
  type ScheduledSocialBrowserExecutionInput,
} from '../scheduled-social-browser-executor'
import { createScheduledSocialProviderRoutes } from '../scheduled-social-provider-executors'

function socialInput(platform = 'x', handle = '@artist', mediaPath?: string): ScheduledSocialBrowserExecutionInput {
  const mediaDigest = mediaPath ? fingerprintScheduledSocialBrowserMedia(mediaPath) : undefined
  const dryRun = {
    action: {
      actionId: 'act_social-1', verb: 'post', platform, profile: 'artist-main', mode: 'browser',
      payload: { text: 'Out now.', media: mediaPath ? [mediaPath] : [] },
      options: { dryRun: true, idempotencyKey: 'idem-1' },
    },
    browserPlan: { accountVerification: { expectedHandle: handle } },
  }
  const actionDigest = computeScheduledSocialBrowserActionDigest(dryRun, mediaDigest)
  const input: ScheduledSocialBrowserExecutionInput = {
    workspaceRootPath: '/workspace',
    order: {
      version: 1, id: 'social-1', owner: { scope: 'campaign', workspaceId: 'campaign-1', campaignId: 'campaign-1' },
      calendarLink: { calendar: 'campaign', itemId: 'calendar-1' }, title: 'Post', type: 'social-publish', status: 'running',
      startAt: '2026-08-31T12:00:00.000Z', timezone: 'UTC', inputRefs: [], approvals: [], runs: [],
      execution: { type: 'social-publish', platform, profileId: 'artist-main', caption: 'Out now.' },
      executionKey: { payloadDigest: 'payload-1', idempotencyKey: 'idem-1' },
      createdAt: '2026-08-31T11:00:00.000Z', updatedAt: '2026-08-31T12:00:00.000Z',
    },
    preview: {
      actionId: 'act_social-1', actionDigest, mediaDigest, platform, profileId: 'artist-main',
      preparedAt: '2026-08-31T11:59:00.000Z', payloadDigest: 'payload-1',
      dryRun,
    },
    approval: {
      id: 'approval-1', approvedAt: '2026-08-31T11:59:00.000Z', expiresAt: '2027-08-31T12:30:00.000Z',
      actionId: 'act_social-1', actionDigest, mediaDigest, payloadDigest: 'payload-1', platform, profileId: 'artist-main',
      approvedBy: { type: 'user', clientId: 'client-1' },
    },
  }
  input.order.socialAction = input.preview
  input.order.socialApproval = input.approval
  return input
}

function source(slug: 'trypost' | 'postiz'): LoadedSource {
  return {
    workspaceId: 'campaign-1', workspaceRootPath: '/workspace', folderPath: '', isBuiltin: true, guide: null,
    config: {
      id: `builtin-${slug}`, name: slug, slug, enabled: true, provider: slug, type: 'mcp',
      mcp: { transport: 'http', url: slug === 'trypost' ? 'https://app.trypost.it/mcp/trypost' : 'https://api.postiz.com/mcp', authType: 'bearer' },
    },
  }
}

const mcpResult = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

describe('scheduled social provider adapters', () => {
  test('publishes through TryPost only after exact account discovery and a published receipt', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      listTools: async () => ['list-social-accounts-tool', 'list-content-types-tool', 'create-post-tool', 'publish-post-tool', 'get-post-tool', 'preview-post-tool'].map((name) => ({ name })),
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        if (name === 'list-social-accounts-tool') return mcpResult({ accounts: [{ id: 'account-1', platform: 'x', username: 'artist', status: 'connected' }] })
        if (name === 'list-content-types-tool') return mcpResult({ platforms: [{ content_types: ['x_post'] }] })
        if (name === 'create-post-tool') return mcpResult({ id: 'post-1', status: 'draft' })
        if (name === 'get-post-tool') return mcpResult({ id: 'post-1', status: 'published', platforms: [{ platform_url: 'https://x.com/artist/status/1' }] })
        return mcpResult({ ok: true })
      },
      close: async () => {},
    }
    const routes = createScheduledSocialProviderRoutes({
      loadSources: () => [source('trypost')], getToken: async () => 'token', createMcpClient: () => client,
      fetch: async () => new Response('{}'), sleep: async () => {}, receiptTimeoutMs: 0,
    })
    const prepared = await routes[0]!.prepare(socialInput())
    expect(prepared?.provider).toBe('trypost')
    expect(await prepared!.execute()).toMatchObject({ receiptId: 'trypost:post-1', externalUrl: 'https://x.com/artist/status/1' })
    expect(calls.find((call) => call.name === 'create-post-tool')?.args).toMatchObject({
      content: 'Out now.', platforms: [{ social_account_id: 'account-1', content_type: 'x_post' }],
    })
  })

  test('re-fingerprints approved media before TryPost creates a draft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trypost-final-gate-'))
    const mediaPath = join(root, 'clip.mp4')
    writeFileSync(mediaPath, 'approved-media')
    const calls: string[] = []
    const client = {
      listTools: async () => [
        'list-social-accounts-tool', 'list-content-types-tool', 'create-post-tool', 'publish-post-tool',
        'get-post-tool', 'preview-post-tool', 'request-media-upload-tool', 'attach-media-from-upload-tool',
      ].map((name) => ({ name })),
      callTool: async (name: string) => {
        calls.push(name)
        if (name === 'list-social-accounts-tool') return mcpResult({ accounts: [{ id: 'account-1', platform: 'instagram', username: 'artist', status: 'connected' }] })
        if (name === 'list-content-types-tool') return mcpResult({ platforms: [{ content_types: ['instagram_reel'] }] })
        if (name === 'create-post-tool') return mcpResult({ id: 'should-not-exist' })
        return mcpResult({ ok: true })
      },
      close: async () => {},
    }
    try {
      const routes = createScheduledSocialProviderRoutes({
        loadSources: () => [source('trypost')], getToken: async () => 'token', createMcpClient: () => client,
        resolveMediaPath: () => mediaPath,
      })
      const prepared = await routes[0]!.prepare(socialInput('instagram', '@artist', mediaPath))
      writeFileSync(mediaPath, 'changed-after-approval')

      await expect(prepared!.execute()).rejects.toThrow(/tuple does not match exactly/i)
      expect(calls).not.toContain('create-post-tool')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rechecks Release Kit restrictions immediately before TryPost creates a draft', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trypost-release-kit-gate-'))
    const sourcePath = join(root, 'teaser.mp4')
    writeFileSync(sourcePath, 'approved-teaser')
    const promoted = materializeReleaseKitItem(root, {
      workspaceId: 'campaign-1',
      campaignId: 'campaign-1',
      source: { type: 'upload', originalFileName: 'teaser.mp4' },
      sourcePath,
      category: 'video',
      subtype: 'teaser',
      promotedBy: 'user',
    })
    const mediaPath = resolveReleaseKitItemPath(root, promoted.item.relativePath)
    const calls: string[] = []
    const client = {
      listTools: async () => [
        'list-social-accounts-tool', 'list-content-types-tool', 'create-post-tool', 'publish-post-tool',
        'get-post-tool', 'preview-post-tool', 'request-media-upload-tool', 'attach-media-from-upload-tool',
      ].map((name) => ({ name })),
      callTool: async (name: string) => {
        calls.push(name)
        if (name === 'list-social-accounts-tool') return mcpResult({ accounts: [{ id: 'account-1', platform: 'x', username: 'artist', status: 'connected' }] })
        if (name === 'list-content-types-tool') return mcpResult({ platforms: [{ content_types: ['x_post'] }] })
        if (name === 'create-post-tool') return mcpResult({ id: 'should-not-exist' })
        return mcpResult({ ok: true })
      },
      close: async () => {},
    }
    try {
      const input = socialInput('x', '@artist', mediaPath)
      input.workspaceRootPath = root
      input.order.owner.workspaceId = 'campaign-1'
      input.order.owner.campaignId = 'campaign-1'
      input.order.inputRefs = [{ kind: 'release-kit', itemId: promoted.item.id, sha256: promoted.item.sha256 }]
      const prepared = await createScheduledSocialProviderRoutes({
        loadSources: () => [source('trypost')],
        getToken: async () => 'token',
        createMcpClient: () => client,
      })[0]!.prepare(input)
      updateReleaseKitItemUsage(root, 'campaign-1', 'campaign-1', promoted.item.id, {
        restrictions: { blockedFromUse: true },
      })

      await expect(prepared!.execute()).rejects.toThrow(/blocked from use/i)
      expect(calls).not.toContain('create-post-tool')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('uploads and attaches the exact approved media through TryPost', async () => {
    const root = mkdtempSync(join(tmpdir(), 'trypost-media-'))
    const mediaPath = join(root, 'clip.mp4')
    writeFileSync(mediaPath, 'approved-media')
    const calls: string[] = []
    const uploads: RequestInit[] = []
    const client = {
      listTools: async () => [
        'list-social-accounts-tool', 'list-content-types-tool', 'create-post-tool', 'publish-post-tool',
        'get-post-tool', 'preview-post-tool', 'request-media-upload-tool', 'attach-media-from-upload-tool',
      ].map((name) => ({ name })),
      callTool: async (name: string) => {
        calls.push(name)
        if (name === 'list-social-accounts-tool') return mcpResult({ accounts: [{ id: 'account-1', platform: 'instagram', username: 'artist', status: 'connected' }] })
        if (name === 'list-content-types-tool') return mcpResult({ platforms: [{ content_types: ['instagram_reel'] }] })
        if (name === 'create-post-tool') return mcpResult({ id: 'post-media', status: 'draft' })
        if (name === 'request-media-upload-tool') return mcpResult({ upload_url: 'https://uploads.trypost.test/media', upload_token: 'upload-1' })
        if (name === 'get-post-tool') return mcpResult({ id: 'post-media', status: 'published', platforms: [{ platform_url: 'https://instagram.com/reel/1' }] })
        return mcpResult({ ok: true })
      },
      close: async () => {},
    }
    try {
      const routes = createScheduledSocialProviderRoutes({
        loadSources: () => [source('trypost')], getToken: async () => 'token', createMcpClient: () => client,
        resolveMediaPath: () => mediaPath,
        fetch: async (_input, init) => { uploads.push(init ?? {}); return new Response('{}') },
        sleep: async () => {}, receiptTimeoutMs: 0,
      })
      const prepared = await routes[0]!.prepare(socialInput('instagram', '@artist', mediaPath))

      await expect(prepared!.execute()).resolves.toMatchObject({ receiptId: 'trypost:post-media' })
      expect(uploads).toHaveLength(1)
      expect(uploads[0]?.method).toBe('POST')
      expect(uploads[0]?.body).toBeInstanceOf(FormData)
      expect(calls).toContain('attach-media-from-upload-tool')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('publishes through Postiz and requires a live release URL receipt', async () => {
    const requests: Array<{ url: string; method: string }> = []
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, method: init?.method ?? 'GET' })
      if (url.endsWith('/integrations')) return new Response(JSON.stringify([{ id: 'integration-1', identifier: 'x', profile: 'artist', disabled: false }]))
      if (url.endsWith('/posts') && init?.method === 'POST') return new Response(JSON.stringify([{ postId: 'post-2', integration: 'integration-1' }]))
      if (url.includes('/posts?')) return new Response(JSON.stringify({ posts: [{ id: 'post-2', content: 'Out now.', releaseURL: 'https://x.com/artist/status/2', integration: { id: 'integration-1' } }] }))
      return new Response('not found', { status: 404 })
    }
    const routes = createScheduledSocialProviderRoutes({
      loadSources: () => [source('postiz')], getToken: async () => 'token', fetch: fetcher,
      sleep: async () => {}, receiptTimeoutMs: 0,
    })
    const prepared = await routes[1]!.prepare(socialInput())
    expect(prepared?.provider).toBe('postiz')
    expect(await prepared!.execute()).toMatchObject({ receiptId: 'postiz:post-2', externalUrl: 'https://x.com/artist/status/2' })
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET'])
  })

  test('uploads approved media through Postiz before creating the post', async () => {
    const root = mkdtempSync(join(tmpdir(), 'postiz-media-'))
    const mediaPath = join(root, 'cover.jpg')
    writeFileSync(mediaPath, 'approved-image')
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/integrations')) return new Response(JSON.stringify([{ id: 'integration-1', identifier: 'instagram', profile: 'artist', disabled: false }]))
      if (url.endsWith('/upload')) return new Response(JSON.stringify({ id: 'media-1', path: '/uploads/cover.jpg' }))
      if (url.endsWith('/posts') && init?.method === 'POST') return new Response(JSON.stringify([{ postId: 'post-media', integration: 'integration-1' }]))
      if (url.includes('/posts?')) return new Response(JSON.stringify({ posts: [{ id: 'post-media', content: 'Out now.', releaseURL: 'https://instagram.com/p/1', integration: { id: 'integration-1' } }] }))
      return new Response('not found', { status: 404 })
    }
    try {
      const routes = createScheduledSocialProviderRoutes({
        loadSources: () => [source('postiz')], getToken: async () => 'token', fetch: fetcher,
        resolveMediaPath: () => mediaPath, sleep: async () => {}, receiptTimeoutMs: 0,
      })
      const prepared = await routes[1]!.prepare(socialInput('instagram', '@artist', mediaPath))

      await expect(prepared!.execute()).resolves.toMatchObject({ receiptId: 'postiz:post-media' })
      const upload = requests.find((request) => request.url.endsWith('/upload'))
      expect(upload?.init?.method).toBe('POST')
      expect(upload?.init?.body).toBeInstanceOf(FormData)
      const create = requests.find((request) => request.url.endsWith('/posts') && request.init?.method === 'POST')
      expect(String(create?.init?.body)).toContain('media-1')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('does not select a provider whose account handle is not the approved destination', async () => {
    const routes = createScheduledSocialProviderRoutes({
      loadSources: () => [source('postiz')], getToken: async () => 'token',
      fetch: async () => new Response(JSON.stringify([{ id: 'wrong', identifier: 'x', profile: 'someone-else' }])),
    })
    expect(await routes[1]!.prepare(socialInput())).toBeUndefined()
  })

  test('does not accept an ambiguous same-caption Postiz receipt', async () => {
    const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/integrations')) return new Response(JSON.stringify([{ id: 'integration-1', identifier: 'x', profile: 'artist', disabled: false }]))
      if (url.endsWith('/posts') && init?.method === 'POST') return new Response(JSON.stringify([{ postId: 'post-new', integration: 'integration-1' }]))
      if (url.includes('/posts?')) {
        return new Response(JSON.stringify({ posts: [
          { id: 'post-old-1', content: 'Out now.', releaseURL: 'https://x.com/artist/status/old-1', integration: { id: 'integration-1' } },
          { id: 'post-old-2', content: 'Out now.', releaseURL: 'https://x.com/artist/status/old-2', integration: { id: 'integration-1' } },
        ] }))
      }
      return new Response('not found', { status: 404 })
    }
    const routes = createScheduledSocialProviderRoutes({
      loadSources: () => [source('postiz')], getToken: async () => 'token', fetch: fetcher,
      sleep: async () => {}, receiptTimeoutMs: 0,
    })
    const prepared = await routes[1]!.prepare(socialInput())
    await expect(prepared!.execute()).rejects.toThrow(/ambiguous publication receipt/i)
  })

  test('surfaces terminal and timeout receipt states', async () => {
    for (const terminalStatus of ['failed', 'partially_published']) {
      const tryPostClient = {
        listTools: async () => ['list-social-accounts-tool', 'list-content-types-tool', 'create-post-tool', 'publish-post-tool', 'get-post-tool', 'preview-post-tool'].map((name) => ({ name })),
        callTool: async (name: string) => {
          if (name === 'list-social-accounts-tool') return mcpResult({ accounts: [{ id: 'account-1', platform: 'x', username: 'artist', status: 'connected' }] })
          if (name === 'list-content-types-tool') return mcpResult({ platforms: [{ content_types: ['x_post'] }] })
          if (name === 'create-post-tool') return mcpResult({ id: `post-${terminalStatus}`, status: 'draft' })
          if (name === 'get-post-tool') return mcpResult({ id: `post-${terminalStatus}`, status: terminalStatus })
          return mcpResult({ ok: true })
        },
        close: async () => {},
      }
      const tryPostRoutes = createScheduledSocialProviderRoutes({
        loadSources: () => [source('trypost')], getToken: async () => 'token', createMcpClient: () => tryPostClient,
        sleep: async () => {}, receiptTimeoutMs: 0,
      })
      const tryPost = await tryPostRoutes[0]!.prepare(socialInput())
      await expect(tryPost!.execute()).rejects.toThrow(new RegExp(terminalStatus))
    }

    const postizRoutes = createScheduledSocialProviderRoutes({
      loadSources: () => [source('postiz')], getToken: async () => 'token', receiptTimeoutMs: 0, sleep: async () => {},
      fetch: async (input, init) => {
        const url = String(input)
        if (url.endsWith('/integrations')) return new Response(JSON.stringify([{ id: 'integration-1', identifier: 'x', profile: 'artist', disabled: false }]))
        if (url.endsWith('/posts') && init?.method === 'POST') return new Response(JSON.stringify([{ postId: 'post-pending' }]))
        return new Response(JSON.stringify({ posts: [{ id: 'post-pending', status: 'pending', content: 'Out now.', integration: { id: 'integration-1' } }] }))
      },
    })
    const postiz = await postizRoutes[1]!.prepare(socialInput())
    await expect(postiz!.execute()).rejects.toThrow(/last observed status: pending/i)
  })
})
