import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import * as actualConfig from '@craft-agent/shared/config'
import * as actualWorkspaceContext from '@craft-agent/shared/workspace-context'
import * as actualAgentDefinitions from '@craft-agent/shared/agent-definitions'
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
  serializeScheduledWorkBody,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import type { ContextDocMetadata, LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'

const workspaceRoot = '/tmp/runneros-scheduled-work-test'
const workspace = { id: 'ws-1', name: 'Scheduled Work Test', rootPath: workspaceRoot }

let contextDocs = new Map<string, LoadedContextDoc>()
let upsertCalls: string[] = []
let failOnSlug: string | null = null
let activeAgentSlugs = ['content-genius']

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

mock.module('@craft-agent/shared/agent-definitions', () => ({
  ...actualAgentDefinitions,
  readActivatedAgents: (rootPath: string) => rootPath === workspaceRoot
    ? { version: 1, active: activeAgentSlugs }
    : actualAgentDefinitions.readActivatedAgents(rootPath),
  loadGlobalAgent: (slug: string) => slug === 'content-genius'
    ? { slug, metadata: { name: 'Content Genius', description: 'Writes campaign content.' }, systemPrompt: 'Write.', path: '/tmp/content-genius', source: 'global' }
    : actualAgentDefinitions.loadGlobalAgent(slug),
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

function seedEmptyCampaignCalendar(): void {
  seedContextDoc(
    CAMPAIGN_CALENDAR_CONTEXT_SLUG,
    serializeCampaignCalendarBody({ version: 1, campaignId: workspace.id, items: [], updatedAt: '2026-07-09T00:00:00.000Z' }),
    'Campaign Calendar',
  )
}

function buildCalendarShell() {
  return createCampaignCalendarItem({
    id: 'campaign-item-1',
    campaignId: workspace.id,
    date: '2026-07-10',
    time: '10:00',
    timezone: 'America/Chicago',
    title: 'Publish teaser',
    kind: 'scheduled-job',
    status: 'scheduled',
    scheduledWorkId: 'scheduled-work-1',
  })
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
    type: 'agent-task',
    status: 'scheduled',
    startAt: '2026-07-10T15:00:00.000Z',
    timezone: 'America/Chicago',
    execution: {
      type: 'agent-task',
      agentSlug: 'content-genius',
      brief: 'Write the teaser.',
      permissionMode: 'safe',
      expectedOutput: { requirement: 'none' },
    },
    inputRefs: [],
    approvals: [],
    runs: [],
    executionKey: { payloadDigest: 'digest-1', idempotencyKey: 'idem-1' },
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
}

function seedAwaitingReviewWork(): ScheduledWorkOrder {
  const order: ScheduledWorkOrder = {
    ...buildOrder(),
    status: 'awaiting-review',
    result: { type: 'agent-task', sessionId: 'session-review-1', outputIds: ['output-review-1'] },
  }
  seedContextDoc(SCHEDULED_WORK_CONTEXT_SLUG, serializeScheduledWorkBody({
    version: 1,
    workspaceId: workspace.id,
    items: [order],
    updatedAt: order.updatedAt,
  }), 'Scheduled Work')
  const item = { ...buildCalendarShell(), status: 'needs-approval' as const }
  seedContextDoc(CAMPAIGN_CALENDAR_CONTEXT_SLUG, serializeCampaignCalendarBody({
    version: 1,
    campaignId: workspace.id,
    items: [item],
    updatedAt: order.updatedAt,
  }), 'Campaign Calendar')
  return order
}

function buildChainInput() {
  const requestId = 'request-chain-1'
  const chainId = `campaign-chain-${requestId}`
  const root: ScheduledWorkOrder = {
    ...buildOrder(),
    id: `${chainId}-0`,
    calendarLink: { calendar: 'campaign', itemId: `${chainId}-calendar-0` },
    chain: { chainId, stepId: `${chainId}-step-0`, ordinal: 0 },
  }
  const child: ScheduledWorkOrder = {
    ...buildOrder(),
    id: `${chainId}-1`,
    calendarLink: { calendar: 'campaign', itemId: `${chainId}-calendar-1` },
    title: 'Review launch copy',
    type: 'review',
    status: 'waiting',
    execution: { type: 'review', reviewerType: 'user' },
    inputRefs: [{ kind: 'produced-output', stepId: `${chainId}-step-0`, bindTo: { kind: 'review-target' } }],
    chain: {
      chainId,
      stepId: `${chainId}-step-1`,
      ordinal: 1,
      predecessor: { orderId: root.id, stepId: `${chainId}-step-0`, releaseOn: 'success' },
    },
    executionKey: { payloadDigest: 'digest-child', idempotencyKey: 'idem-child' },
  }
  return {
    requestId,
    orders: [root, child] as [ScheduledWorkOrder, ScheduledWorkOrder],
    calendarItems: [
      createCampaignCalendarItem({ id: root.calendarLink.itemId, campaignId: workspace.id, date: '2026-07-10', time: '10:00', timezone: root.timezone, title: root.title, kind: 'scheduled-job', status: 'scheduled', scheduledWorkId: root.id }),
      createCampaignCalendarItem({ id: child.calendarLink.itemId, campaignId: workspace.id, date: '2026-07-10', time: '10:00', timezone: child.timezone, title: child.title, kind: 'scheduled-job', status: 'draft', scheduledWorkId: child.id }),
    ] as ReturnType<typeof buildCalendarShell>[],
  }
}

function stableTestJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableTestJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableTestJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

beforeEach(() => {
  contextDocs = new Map()
  upsertCalls = []
  failOnSlug = null
  activeAgentSlugs = ['content-genius']
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

  test('scheduleCampaign creates one work order and one linked calendar shell idempotently', async () => {
    seedEmptyCampaignCalendar()
    const { invoke, pushCalls } = await registerServer()
    const input = { order: buildOrder(), calendarItem: buildCalendarShell() }

    const first = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, input)

    expect(first).toMatchObject({ updated: true, order: { id: 'scheduled-work-1' }, calendarItem: { id: 'campaign-item-1' } })
    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, CAMPAIGN_CALENDAR_CONTEXT_SLUG])
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items).toHaveLength(1)
    expect(readCampaignCalendar().items[0]?.job).toBeUndefined()

    upsertCalls = []
    pushCalls.length = 0
    const second = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, input)

    expect(second).toMatchObject({ updated: false })
    expect(upsertCalls).toEqual([])
    expect(pushCalls).toEqual([])
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items).toHaveLength(1)
  })

  test('scheduleCampaignChain creates two linked orders and shells idempotently', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    const input = buildChainInput()

    const first = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN, workspace.id, input)
    expect(first).toMatchObject({ updated: true, orders: [{ status: 'scheduled' }, { status: 'waiting' }] })
    expect(readScheduledWork().items).toHaveLength(2)
    expect(readCampaignCalendar().items).toHaveLength(2)

    upsertCalls = []
    const second = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN, workspace.id, input)
    expect(second).toMatchObject({ updated: false })
    expect(upsertCalls).toEqual([])
  })

  test('scheduleCampaignChain rejects unsupported or mismatched topology', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    const input = buildChainInput()
    input.orders[1] = { ...input.orders[1], chain: { ...input.orders[1].chain!, predecessor: { ...input.orders[1].chain!.predecessor!, orderId: 'wrong-parent' } } }

    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN, workspace.id, input))
      .rejects.toThrow('chain is invalid')
    expect(contextDocs.has(SCHEDULED_WORK_CONTEXT_SLUG)).toBe(false)
  })

  test('scheduleCampaignChain rejects changed schedule data while healing a partial write', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    const input = buildChainInput()
    failOnSlug = CAMPAIGN_CALENDAR_CONTEXT_SLUG
    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN, workspace.id, input)).rejects.toThrow('Forced upsert failure')
    expect(readScheduledWork().items).toHaveLength(2)

    failOnSlug = null
    const changed = buildChainInput()
    changed.orders[0] = { ...changed.orders[0], title: 'Changed after partial write' }
    changed.calendarItems[0] = { ...changed.calendarItems[0]!, title: 'Changed after partial write' }
    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN_CHAIN, workspace.id, changed))
      .rejects.toThrow('different execution data')
    expect(readCampaignCalendar().items).toHaveLength(0)
  })

  test('scheduleHq creates HQ work and an Artist Calendar shell idempotently', async () => {
    const { invoke } = await registerServer()
    const order: ScheduledWorkOrder = {
      ...buildOrder(),
      id: 'hq-work-1',
      owner: { scope: 'hq', workspaceId: workspace.id },
      calendarLink: { calendar: 'hq', itemId: 'hq-work-1-calendar' },
    }
    const input = { requestId: 'hq-1', orders: [order] }

    const first = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_HQ, workspace.id, input)
    expect(first).toMatchObject({ updated: true, orders: [{ id: 'hq-work-1' }] })
    expect(contextDocs.get('artist-calendar')?.body).toContain('hq-work-1-calendar')
    upsertCalls = []
    const second = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_HQ, workspace.id, input)
    expect(second).toMatchObject({ updated: false })
    expect(upsertCalls).toEqual([])
  })

  test('scheduleHq rejects review and social work the HQ surface cannot service', async () => {
    const { invoke } = await registerServer()
    const order: ScheduledWorkOrder = {
      ...buildOrder(),
      id: 'hq-review-1',
      owner: { scope: 'hq', workspaceId: workspace.id },
      calendarLink: { calendar: 'hq', itemId: 'hq-review-1-calendar' },
      type: 'review',
      execution: { type: 'review', reviewerType: 'user' },
    }
    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_HQ, workspace.id, { requestId: 'hq-review', orders: [order] }))
      .rejects.toThrow('standalone agent and workflow')
    expect(contextDocs.has(SCHEDULED_WORK_CONTEXT_SLUG)).toBe(false)
  })

  test('approveCampaignSocial binds only an untampered exact dry-run', async () => {
    const dryRun = {
      action: {
        actionId: 'act_social-order-1', platform: 'x', profile: 'artist-main',
        payload: { text: 'Out Friday.' }, options: { dryRun: true, idempotencyKey: 'social-idem-1' },
      },
      browserPlan: { accountVerification: { verificationTargetKnown: true } },
    }
    const actionDigest = `sha256:${createHash('sha256').update(stableTestJson({ action: dryRun.action, browserPlan: dryRun.browserPlan, mediaDigest: undefined })).digest('hex')}`
    const order: ScheduledWorkOrder = {
      ...buildOrder(), id: 'social-order-1', calendarLink: { calendar: 'campaign', itemId: 'social-calendar-1' },
      startAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      title: 'Publish teaser', type: 'social-publish', status: 'needs-approval',
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-main', caption: 'Out Friday.' },
      executionKey: { payloadDigest: 'social-payload-1', idempotencyKey: 'social-idem-1' },
      socialAction: { actionId: 'act_social-order-1', actionDigest, platform: 'x', profileId: 'artist-main', preparedAt: '2026-07-10T14:00:00.000Z', payloadDigest: 'social-payload-1', dryRun },
    }
    seedContextDoc(SCHEDULED_WORK_CONTEXT_SLUG, serializeScheduledWorkBody({ version: 1, workspaceId: workspace.id, items: [order], updatedAt: order.updatedAt }), 'Scheduled Work')
    const item = createCampaignCalendarItem({ id: 'social-calendar-1', campaignId: workspace.id, date: '2026-07-10', time: '10:00', timezone: order.timezone, title: order.title, kind: 'scheduled-job', status: 'needs-approval', scheduledWorkId: order.id })
    seedContextDoc(CAMPAIGN_CALENDAR_CONTEXT_SLUG, serializeCampaignCalendarBody({ version: 1, campaignId: workspace.id, items: [item], updatedAt: order.updatedAt }), 'Campaign Calendar')
    const { invoke } = await registerServer()

    const approved = await invoke(RPC_CHANNELS.scheduledWork.APPROVE_CAMPAIGN_SOCIAL, workspace.id, { orderId: order.id, calendarItemId: item.id, expectedUpdatedAt: order.updatedAt })
    expect(approved).toMatchObject({ order: { socialApproval: { actionId: 'act_social-order-1', actionDigest } } })
  })

  test('scheduleCampaign rejects client-supplied terminal history in a new shell', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    const calendarItem = buildCalendarShell()
    calendarItem.runHistory = [{
      id: 'fake-run',
      jobId: 'fake-job',
      status: 'done',
      startedAt: '2026-07-09T00:00:00.000Z',
    }]

    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, {
      order: buildOrder(),
      calendarItem,
    })).rejects.toThrow('shell does not match')
    expect(contextDocs.has(SCHEDULED_WORK_CONTEXT_SLUG)).toBe(false)
  })

  test('scheduleCampaign rejects semantic shell and order mismatches', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    const calendarItem = buildCalendarShell()
    calendarItem.title = 'Different visible work'

    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, {
      order: buildOrder(),
      calendarItem,
    })).rejects.toThrow('shell does not match')
    expect(contextDocs.has(SCHEDULED_WORK_CONTEXT_SLUG)).toBe(false)
  })

  test('scheduleCampaign rejects an agent that is not active at write time', async () => {
    seedEmptyCampaignCalendar()
    activeAgentSlugs = []
    const { invoke } = await registerServer()

    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, {
      order: buildOrder(),
      calendarItem: buildCalendarShell(),
    })).rejects.toThrow('not active')
    expect(contextDocs.has(SCHEDULED_WORK_CONTEXT_SLUG)).toBe(false)
  })

  test('scheduleCampaign heals a failed calendar-shell write without duplicating work', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    const input = { order: buildOrder(), calendarItem: buildCalendarShell() }
    failOnSlug = CAMPAIGN_CALENDAR_CONTEXT_SLUG

    await expect(invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, input))
      .rejects.toThrow(`Forced upsert failure for ${CAMPAIGN_CALENDAR_CONTEXT_SLUG}`)
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items).toHaveLength(0)

    failOnSlug = null
    upsertCalls = []
    const recovered = await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, input)

    expect(recovered).toMatchObject({ updated: true })
    expect(upsertCalls).toEqual([CAMPAIGN_CALENDAR_CONTEXT_SLUG])
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items).toHaveLength(1)
  })

  test('cancelCampaign cancels work first and heals a failed calendar removal', async () => {
    seedEmptyCampaignCalendar()
    const { invoke } = await registerServer()
    await invoke(RPC_CHANNELS.scheduledWork.SCHEDULE_CAMPAIGN, workspace.id, {
      order: buildOrder(),
      calendarItem: buildCalendarShell(),
    })
    failOnSlug = CAMPAIGN_CALENDAR_CONTEXT_SLUG
    upsertCalls = []

    await expect(invoke(RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN, workspace.id, {
      orderId: 'scheduled-work-1',
      calendarItemId: 'campaign-item-1',
    })).rejects.toThrow(`Forced upsert failure for ${CAMPAIGN_CALENDAR_CONTEXT_SLUG}`)
    expect(readScheduledWork().items[0]?.status).toBe('canceled')
    expect(readCampaignCalendar().items[0]?.deletedAt).toBeUndefined()

    failOnSlug = null
    upsertCalls = []
    const recovered = await invoke(RPC_CHANNELS.scheduledWork.CANCEL_CAMPAIGN, workspace.id, {
      orderId: 'scheduled-work-1',
      calendarItemId: 'campaign-item-1',
    })

    expect(recovered).toMatchObject({ updated: true, order: { status: 'canceled' } })
    expect(upsertCalls).toEqual([CAMPAIGN_CALENDAR_CONTEXT_SLUG])
    expect(readCampaignCalendar().items[0]?.deletedAt).toBeTruthy()
  })

  test('decideCampaign approves awaiting work without replacing its execution result', async () => {
    const order = seedAwaitingReviewWork()
    const { invoke } = await registerServer()

    const result = await invoke(RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN, workspace.id, {
      orderId: order.id,
      calendarItemId: order.calendarLink.itemId,
      expectedUpdatedAt: order.updatedAt,
      decision: 'approved',
    })

    expect(result).toMatchObject({
      order: {
        status: 'done',
        result: { type: 'agent-task', sessionId: 'session-review-1', outputIds: ['output-review-1'] },
        reviewDecision: { decision: 'approved', reviewerType: 'user' },
      },
      calendarItem: { status: 'done' },
    })
  })

  test('decideCampaign requires notes for requested changes', async () => {
    const order = seedAwaitingReviewWork()
    const { invoke } = await registerServer()

    await expect(invoke(RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN, workspace.id, {
      orderId: order.id,
      calendarItemId: order.calendarLink.itemId,
      expectedUpdatedAt: order.updatedAt,
      decision: 'changes-requested',
    })).rejects.toThrow('Explain the changes')
    expect(readScheduledWork().items[0]?.status).toBe('awaiting-review')
  })

  test('decideCampaign heals a failed calendar update without changing the recorded decision', async () => {
    const order = seedAwaitingReviewWork()
    const { invoke } = await registerServer()
    const input = {
      orderId: order.id,
      calendarItemId: order.calendarLink.itemId,
      expectedUpdatedAt: order.updatedAt,
      decision: 'changes-requested' as const,
      notes: 'Tighten the opening line.',
    }
    failOnSlug = CAMPAIGN_CALENDAR_CONTEXT_SLUG

    await expect(invoke(RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN, workspace.id, input))
      .rejects.toThrow(`Forced upsert failure for ${CAMPAIGN_CALENDAR_CONTEXT_SLUG}`)
    const decidedAt = readScheduledWork().items[0]?.reviewDecision?.decidedAt
    expect(readScheduledWork().items[0]?.status).toBe('needs-attention')
    expect(readCampaignCalendar().items[0]?.status).toBe('needs-approval')

    failOnSlug = null
    const recovered = await invoke(RPC_CHANNELS.scheduledWork.DECIDE_CAMPAIGN, workspace.id, input)
    expect(recovered).toMatchObject({ order: { status: 'needs-attention' }, calendarItem: { status: 'failed' } })
    expect(readScheduledWork().items[0]?.reviewDecision?.decidedAt).toBe(decidedAt)
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
