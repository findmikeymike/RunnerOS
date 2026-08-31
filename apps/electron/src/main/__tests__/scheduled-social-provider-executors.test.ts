import { describe, expect, test } from 'bun:test'
import type { LoadedSource } from '@craft-agent/shared/sources'
import type { ScheduledSocialBrowserExecutionInput } from '../scheduled-social-browser-executor'
import { createScheduledSocialProviderRoutes } from '../scheduled-social-provider-executors'

function socialInput(platform = 'x', handle = '@artist'): ScheduledSocialBrowserExecutionInput {
  return {
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
      actionId: 'act_social-1', actionDigest: 'sha256:action', platform, profileId: 'artist-main',
      preparedAt: '2026-08-31T11:59:00.000Z', payloadDigest: 'payload-1',
      dryRun: { browserPlan: { accountVerification: { expectedHandle: handle } } },
    },
    approval: {
      id: 'approval-1', approvedAt: '2026-08-31T11:59:00.000Z', expiresAt: '2026-08-31T12:30:00.000Z',
      actionId: 'act_social-1', actionDigest: 'sha256:action', payloadDigest: 'payload-1', platform, profileId: 'artist-main',
      approvedBy: { type: 'user', clientId: 'client-1' },
    },
  }
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
    await expect(prepared!.execute()).rejects.toThrow(/did not return a live publication URL/i)
  })
})
