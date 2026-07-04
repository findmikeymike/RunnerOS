import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import * as actualConfig from '@craft-agent/shared/config'
import * as actualSources from '@craft-agent/shared/sources'
import * as actualWorkspaceContext from '@craft-agent/shared/workspace-context'
import type { ContextDocMetadata, LoadedContextDoc } from '@craft-agent/shared/workspace-context'

let contextDocs = new Map<string, LoadedContextDoc>()
let fetchCalls: Array<{ url: string; init?: RequestInit }> = []
let tokenValue: string | null = 'google-token'
let refreshValue: string | null = 'refreshed-token'
let credential: { value?: string | null; refreshToken?: string | null } | null = { value: 'google-token' }

const workspaceRoot = '/tmp/runneros-google-workspace-test'
const workspace = { id: 'ws-1', name: 'Test Workspace', rootPath: workspaceRoot }
const googleSource = {
  tier: 'global',
  workspaceId: workspace.id,
  config: { slug: 'google-calendar', name: 'Google Calendar' },
}

mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (workspaceId: string) => (
    workspaceId === workspace.id ? workspace : actualConfig.getWorkspaceByNameOrId(workspaceId)
  ),
}))

mock.module('@craft-agent/shared/sources', () => ({
  ...actualSources,
  getSourcesBySlugs: (rootPath: string, slugs: string[]) => (
    rootPath === workspaceRoot && slugs.includes('google-calendar')
      ? [googleSource]
      : actualSources.getSourcesBySlugs(rootPath, slugs)
  ),
  getSourceCredentialManager: () => ({
    getToken: async () => tokenValue,
    refresh: async () => refreshValue,
    loadEffective: async () => credential,
  }),
}))

mock.module('@craft-agent/shared/workspace-context', () => ({
  ...actualWorkspaceContext,
  loadContextDoc: (rootPath: string, slug: string) => rootPath === workspaceRoot
    ? contextDocs.get(slug) ?? null
    : actualWorkspaceContext.loadContextDoc(rootPath, slug),
  upsertContextDoc: (rootPath: string, doc: { slug: string; metadata: ContextDocMetadata; body: string }) => {
    if (rootPath !== workspaceRoot) return actualWorkspaceContext.upsertContextDoc(rootPath, doc as never)
    const loaded: LoadedContextDoc = {
      slug: doc.slug,
      metadata: doc.metadata,
      body: doc.body,
      path: `${workspaceRoot}/${doc.slug}.md`,
      workspaceRootPath: workspaceRoot,
    }
    contextDocs.set(doc.slug, loaded)
    return loaded
  },
  loadAllContextDocs: (rootPath: string) => rootPath === workspaceRoot ? [...contextDocs.values()] : actualWorkspaceContext.loadAllContextDocs(rootPath),
}))

function calendarBody(events: unknown[]): string {
  return [
    '```json',
    JSON.stringify({ version: 1, events, updatedAt: '2026-07-02T00:00:00.000Z' }, null, 2),
    '```',
  ].join('\n')
}

function parseCalendarEvents(): Array<Record<string, unknown>> {
  const body = contextDocs.get('artist-calendar')?.body ?? ''
  const match = body.match(/```json\s*([\s\S]*?)```/i)
  if (!match?.[1]) throw new Error('No calendar JSON was written')
  return (JSON.parse(match[1]) as { events: Array<Record<string, unknown>> }).events
}

function seedArtistCalendar(body: string): void {
  contextDocs.set('artist-calendar', {
    slug: 'artist-calendar',
    metadata: { name: 'Artist Calendar', routing: { mode: 'broadcast' }, enabled: true },
    body,
    path: `${workspaceRoot}/artist-calendar.md`,
    workspaceRootPath: workspaceRoot,
  })
}

async function registerServer(): Promise<{
  invoke: (channel: string, workspaceId: string) => Promise<unknown>
}> {
  const handlers = new Map<string, (_ctx: unknown, workspaceId: string) => Promise<unknown>>()
  const server = {
    handle: (channel: string, handler: (_ctx: unknown, workspaceId: string) => Promise<unknown>) => {
      handlers.set(channel, handler)
    },
  }
  const { registerGoogleWorkspaceHandlers } = await import('./google-workspace')
  registerGoogleWorkspaceHandlers(server as never, {} as never)
  return {
    invoke: async (channel: string, workspaceId: string) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler({}, workspaceId)
    },
  }
}

describe('google workspace calendar sync', () => {
  beforeEach(() => {
    contextDocs = new Map()
    fetchCalls = []
    tokenValue = 'google-token'
    refreshValue = 'refreshed-token'
    credential = { value: 'google-token' }
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      if (init?.method === 'DELETE') {
        return new Response(null, { status: 204 })
      }
      return Response.json({ id: 'google-event-1', htmlLink: 'https://calendar.google.com/event', etag: 'etag-1' })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    mock.restore()
  })

  test('sync creates Google events and writes sync metadata back to artist calendar context', async () => {
    seedArtistCalendar(calendarBody([{
      id: 'event-1',
      date: '2026-07-03',
      title: 'Video shoot',
      time: '9am',
      workspaceLinks: [],
      relatedPersonIds: [],
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }]))
    const server = await registerServer()

    const result = await server.invoke('googleWorkspace:syncCalendar', workspace.id)

    expect(result).toMatchObject({ ok: true, synced: 1, deleted: 0, failed: 0 })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.init?.method).toBe('POST')
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toMatchObject({
      summary: 'Video shoot',
      start: { dateTime: expect.any(String) },
      extendedProperties: { private: { runnerosEventId: 'event-1' } },
    })
    expect(parseCalendarEvents()[0]?.google).toMatchObject({
      eventId: 'google-event-1',
      htmlLink: 'https://calendar.google.com/event',
      etag: 'etag-1',
      syncStatus: 'synced',
    })
  })

  test('sync deletes tombstoned Google events and removes them from calendar context', async () => {
    seedArtistCalendar(calendarBody([{
      id: 'event-1',
      date: '2026-07-03',
      title: 'Video shoot',
      deletedAt: '2026-07-02T10:00:00.000Z',
      workspaceLinks: [],
      relatedPersonIds: [],
      google: { calendarId: 'primary', eventId: 'google-event-1', syncStatus: 'local-change' },
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T10:00:00.000Z',
    }]))
    const server = await registerServer()

    const result = await server.invoke('googleWorkspace:syncCalendar', workspace.id)

    expect(result).toMatchObject({ ok: true, synced: 0, deleted: 1, failed: 0 })
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0]?.init?.method).toBe('DELETE')
    expect(fetchCalls[0]?.url).toContain('/events/google-event-1')
    expect(parseCalendarEvents()).toEqual([])
  })

  test('status reads stored credential state instead of static source config', async () => {
    credential = { refreshToken: 'refresh-token' }
    const server = await registerServer()

    await expect(server.invoke('googleWorkspace:getCalendarStatus', workspace.id)).resolves.toMatchObject({
      ok: true,
      connected: true,
    })
  })

  test('invalid time fails the event instead of silently creating an all-day event', async () => {
    seedArtistCalendar(calendarBody([{
      id: 'event-1',
      date: '2026-07-03',
      title: 'Video shoot',
      time: 'after lunch-ish',
      workspaceLinks: [],
      relatedPersonIds: [],
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }]))
    const server = await registerServer()

    const result = await server.invoke('googleWorkspace:syncCalendar', workspace.id)

    expect(result).toMatchObject({ ok: false, synced: 0, deleted: 0, failed: 1 })
    expect(fetchCalls).toHaveLength(0)
    expect(parseCalendarEvents()[0]?.google).toMatchObject({ syncStatus: 'error' })
  })
})
