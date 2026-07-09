import { beforeEach, describe, expect, mock, test } from 'bun:test'
import * as actualConfig from '@craft-agent/shared/config'
import * as actualWorkspaceContext from '@craft-agent/shared/workspace-context'
import {
  CAMPAIGN_CALENDAR_CONTEXT_SLUG,
  createCampaignCalendarItem,
  createCampaignScheduledJob,
  parseCampaignCalendarDocResult,
  serializeCampaignCalendarBody,
  type CampaignCalendar,
} from '@craft-agent/shared/campaign-calendar'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import type { ContextDocMetadata, LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'

const workspaceRoot = '/tmp/runneros-scheduled-work-test'
const workspace = { id: 'ws-1', name: 'Scheduled Work Test', rootPath: workspaceRoot }

let contextDocs = new Map<string, LoadedContextDoc>()
let upsertCalls: string[] = []
let failOnSlug: string | null = null

mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (workspaceId: string) => (
    workspaceId === workspace.id ? workspace : actualConfig.getWorkspaceByNameOrId(workspaceId)
  ),
}))

mock.module('@craft-agent/shared/workspace-context', () => ({
  ...actualWorkspaceContext,
  loadContextDoc: (rootPath: string, slug: string) => (
    rootPath === workspaceRoot
      ? contextDocs.get(slug) ?? null
      : actualWorkspaceContext.loadContextDoc(rootPath, slug)
  ),
  upsertContextDoc: (
    rootPath: string,
    doc: { slug: string; metadata: ContextDocMetadata; body: string },
  ) => {
    if (rootPath !== workspaceRoot) return actualWorkspaceContext.upsertContextDoc(rootPath, doc as never)
    upsertCalls.push(doc.slug)
    if (failOnSlug === doc.slug) throw new Error(`Forced upsert failure for ${doc.slug}`)
    const loaded: LoadedContextDoc = {
      slug: doc.slug,
      metadata: doc.metadata,
      body: doc.body,
      path: `${workspaceRoot}/context/${doc.slug}/CONTEXT.md`,
      workspaceRootPath: workspaceRoot,
    }
    contextDocs.set(doc.slug, loaded)
    return loaded
  },
  loadAllContextDocs: (rootPath: string) => (
    rootPath === workspaceRoot
      ? [...contextDocs.values()]
      : actualWorkspaceContext.loadAllContextDocs(rootPath)
  ),
}))

function ctx(): RequestContext {
  return { clientId: 'c1', workspaceId: workspace.id, webContentsId: 1 }
}

function seedContextDoc(slug: string, body: string, name: string): void {
  contextDocs.set(slug, {
    slug,
    metadata: { name, routing: { mode: 'broadcast' }, enabled: true },
    body,
    path: `${workspaceRoot}/context/${slug}/CONTEXT.md`,
    workspaceRootPath: workspaceRoot,
  })
}

function seedCampaignCalendar(): CampaignCalendar {
  const job = createCampaignScheduledJob({
    runAt: '2026-07-10T15:00:00.000Z',
    timezone: 'America/Chicago',
    actionType: 'post-asset',
    payload: { caption: 'Teaser live Friday.' },
  })
  const item = createCampaignCalendarItem({
    campaignId: workspace.id,
    date: '2026-07-10',
    time: '10:00',
    timezone: 'America/Chicago',
    title: 'Publish teaser',
    kind: 'scheduled-job',
    status: 'needs-approval',
    finalRefs: [{ outputId: 'out-1', slot: 'primary', assetId: 'asset-1', label: 'Primary teaser' }],
    socialProfileRefs: [{ platform: 'instagram', profileId: 'ig-1', label: 'IG main' }],
    accountSetId: 'set-1',
    job,
  })
  const calendar: CampaignCalendar = {
    version: 1,
    campaignId: workspace.id,
    items: [item],
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
  seedContextDoc(
    CAMPAIGN_CALENDAR_CONTEXT_SLUG,
    serializeCampaignCalendarBody(calendar),
    'Campaign Calendar',
  )
  return calendar
}

function readCampaignCalendar(): CampaignCalendar {
  const parsed = parseCampaignCalendarDocResult(contextDocs.get(CAMPAIGN_CALENDAR_CONTEXT_SLUG) ?? undefined, workspace.id)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.calendar
}

function readScheduledWork() {
  const parsed = parseScheduledWorkDocResult(contextDocs.get(SCHEDULED_WORK_CONTEXT_SLUG) ?? undefined, workspace.id)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.work
}

async function registerServer(): Promise<{
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }>
}> {
  const handlers = new Map<string, HandlerFn>()
  const pushCalls: Array<{ channel: string; target: unknown; args: unknown[] }> = []
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
  }
  const deps = {
    wsServer: {
      push(channel: string, target: unknown, ...args: unknown[]) {
        pushCalls.push({ channel, target, args })
      },
    },
  }
  const { registerScheduledWorkHandlers } = await import('./scheduled-work')
  registerScheduledWorkHandlers(server, deps as never)
  return {
    pushCalls,
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`No handler for ${channel}`)
      return handler(ctx(), ...args)
    },
  }
}

function buildOrder(): ScheduledWorkOrder {
  return {
    version: 1,
    id: 'scheduled-work-1',
    owner: { scope: 'campaign', workspaceId: workspace.id, campaignId: workspace.id },
    calendarLink: { calendar: 'campaign', itemId: 'campaign-item-1' },
    title: 'Publish teaser',
    type: 'social-publish',
    status: 'scheduled',
    startAt: '2026-07-10T15:00:00.000Z',
    timezone: 'America/Chicago',
    execution: {
      type: 'social-publish',
      platform: 'instagram',
      profileId: 'ig-1',
      accountSetId: 'set-1',
      caption: 'Teaser live Friday.',
    },
    inputRefs: [{ kind: 'final', outputId: 'out-1', assetId: 'asset-1', slot: 'primary', label: 'Primary teaser' }],
    approvals: [],
    runs: [],
    executionKey: { payloadDigest: 'digest-1', idempotencyKey: 'idem-1' },
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
}

beforeEach(() => {
  contextDocs = new Map()
  upsertCalls = []
  failOnSlug = null
})

describe('scheduled-work RPC handler', () => {
  test('mutate upserts scheduled-work and broadcasts workspace context changes', async () => {
    const { invoke, pushCalls } = await registerServer()

    const result = await invoke(RPC_CHANNELS.scheduledWork.MUTATE, workspace.id, {
      operation: 'upsert',
      order: buildOrder(),
      expectedUpdatedAt: null,
    })

    expect(result).toMatchObject({ ok: true, item: { id: 'scheduled-work-1' } })
    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG])
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toMatchObject({ channel: RPC_CHANNELS.workspaceContext.CHANGED })
    expect(pushCalls[0]?.args[0]).toBe(workspace.id)
    expect((pushCalls[0]?.args[1] as LoadedContextDoc[]).map((doc) => doc.slug)).toEqual([SCHEDULED_WORK_CONTEXT_SLUG])

    const getResult = await invoke(RPC_CHANNELS.scheduledWork.GET, workspace.id)
    expect(getResult).toMatchObject({
      ok: true,
      work: { items: [{ id: 'scheduled-work-1', title: 'Publish teaser' }] },
    })
  })

  test('mutate rejects stale whole-order updates without writing', async () => {
    const { invoke } = await registerServer()
    const created = await invoke(RPC_CHANNELS.scheduledWork.MUTATE, workspace.id, {
      operation: 'upsert',
      order: buildOrder(),
      expectedUpdatedAt: null,
    }) as { ok: true; item: ScheduledWorkOrder }
    upsertCalls = []

    const stale = await invoke(RPC_CHANNELS.scheduledWork.MUTATE, workspace.id, {
      operation: 'upsert',
      order: { ...buildOrder(), status: 'canceled' },
      expectedUpdatedAt: '2026-07-08T00:00:00.000Z',
    })

    expect(stale).toMatchObject({ ok: false })
    expect(upsertCalls).toEqual([])
    expect(readScheduledWork().items[0]?.updatedAt).toBe(created.item.updatedAt)
    expect(readScheduledWork().items[0]?.status).toBe('scheduled')
  })

  test('migrateCampaign writes scheduled-work before campaign-calendar and is idempotent', async () => {
    seedCampaignCalendar()
    const { invoke, pushCalls } = await registerServer()

    const first = await invoke(RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN, workspace.id)

    expect(first).toMatchObject({ updated: true, migrated: 1 })
    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, CAMPAIGN_CALENDAR_CONTEXT_SLUG])
    expect(pushCalls).toHaveLength(1)

    const scheduled = readScheduledWork()
    expect(scheduled.items).toHaveLength(1)
    expect(scheduled.items[0]?.legacyRef?.campaignJobId).toBeTruthy()

    const calendar = readCampaignCalendar()
    expect(calendar.items).toHaveLength(1)
    expect(calendar.items[0]?.scheduledWorkId).toBe(scheduled.items[0]?.id)
    expect(calendar.items[0]?.job?.id).toBeTruthy()

    upsertCalls = []
    pushCalls.length = 0

    const second = await invoke(RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN, workspace.id)

    expect(second).toMatchObject({ updated: false, migrated: 0 })
    expect(upsertCalls).toEqual([])
    expect(pushCalls).toEqual([])
  })

  test('migrateCampaign recovers from a campaign-calendar write failure without duplicating work orders', async () => {
    seedCampaignCalendar()
    const { invoke, pushCalls } = await registerServer()
    failOnSlug = CAMPAIGN_CALENDAR_CONTEXT_SLUG

    await expect(
      invoke(RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN, workspace.id),
    ).rejects.toThrow(`Forced upsert failure for ${CAMPAIGN_CALENDAR_CONTEXT_SLUG}`)

    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, CAMPAIGN_CALENDAR_CONTEXT_SLUG])
    expect(pushCalls).toEqual([])
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items[0]?.scheduledWorkId).toBeUndefined()

    failOnSlug = null
    upsertCalls = []

    const recovery = await invoke(RPC_CHANNELS.scheduledWork.MIGRATE_CAMPAIGN, workspace.id)

    expect(recovery).toMatchObject({ updated: true, migrated: 0 })
    expect(upsertCalls).toEqual([CAMPAIGN_CALENDAR_CONTEXT_SLUG])
    expect(pushCalls).toHaveLength(1)
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items[0]?.scheduledWorkId).toBe(readScheduledWork().items[0]?.id)
    expect(readCampaignCalendar().items[0]?.job?.id).toBeTruthy()
  })
})
