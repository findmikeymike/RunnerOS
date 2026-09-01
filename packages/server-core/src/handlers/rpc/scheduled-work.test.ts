import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as actualConfig from '@craft-agent/shared/config'
import * as actualWorkspaceContext from '@craft-agent/shared/workspace-context'
import * as actualAgentDefinitions from '@craft-agent/shared/agent-definitions'
import * as actualWorkspaces from '@craft-agent/shared/workspaces'
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
  ARTIST_CALENDAR_CONTEXT_SLUG,
  parseArtistCalendarDocResult,
} from '@craft-agent/shared/artist-context'
import {
  createOutputBundle,
  readOutputManifest,
  resolveOutputAssetPath,
} from '@craft-agent/shared/outputs'
import { parseXEditorialSlate, type XEditorialSlate } from '@craft-agent/shared/x-editorial'
import {
  SCHEDULED_WORK_CONTEXT_SLUG,
  parseScheduledWorkDocResult,
  serializeScheduledWorkBody,
  type ScheduledWorkOrder,
} from '@craft-agent/shared/scheduled-work'
import type { ContextDocMetadata, LoadedContextDoc } from '@craft-agent/shared/workspace-context'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import { materializeReleaseKitItem, updateReleaseKitItemUsage } from '@craft-agent/shared/release-kit'

const workspaceRoot = '/tmp/runneros-scheduled-work-test'
const campaignRoot = '/tmp/runneros-scheduled-work-x-campaign-test'
const workspace = { id: 'ws-1', name: 'Scheduled Work Test', rootPath: workspaceRoot, artistWorkspaceScope: 'hq' as const }
const campaignWorkspace = { id: 'campaign-x', name: 'X Campaign', rootPath: campaignRoot, artistWorkspaceScope: 'campaign' as const }

let contextDocs = new Map<string, LoadedContextDoc>()
let upsertCalls: string[] = []
let failOnSlug: string | null = null
let activeAgentSlugs = ['content-genius']
const assertTeamPermission = mock((_rootPath: string, _action: string) => ({ allowed: true }))

mock.module('@craft-agent/shared/config', () => ({
  ...actualConfig,
  getWorkspaceByNameOrId: (workspaceId: string) => (
    workspaceId === workspace.id
      ? workspace
      : workspaceId === campaignWorkspace.id
        ? campaignWorkspace
        : actualConfig.getWorkspaceByNameOrId(workspaceId)
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

mock.module('@craft-agent/shared/workspaces', () => ({
  ...actualWorkspaces,
  assertTeamPermission,
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

function readArtistCalendar() {
  const parsed = parseArtistCalendarDocResult(contextDocs.get(ARTIST_CALENDAR_CONTEXT_SLUG) ?? undefined)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.calendar
}

function seedXEditorialSlate(options?: {
  scheduledFor?: string | null
  format?: 'post' | 'thread'
  text?: string
  secondCandidate?: { text: string; scheduledFor: string }
  asset?: { campaignId: string; itemId: string; sha256: string; label: string }
}) {
  const scheduledFor = options?.scheduledFor === undefined
    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    : options.scheduledFor
  const format = options?.format ?? 'post'
  const slate: XEditorialSlate = {
    schemaVersion: 1,
    slateId: 'xslate_test_1',
    title: 'Daily X Slate — Test',
    createdAt: new Date().toISOString(),
    timezone: 'America/Chicago',
    profile: { platform: 'x', profileId: 'artist-main' },
    context: { scope: 'hq', campaignId: null, campaignName: null, campaignWeight: 'none' },
    research: { summary: 'Artist worldview research.', researchedAt: new Date().toISOString(), sources: [] },
    candidates: [{
      id: 'post_1',
      revision: 1,
      lane: 'worldview',
      format,
      text: options?.text ?? 'Art should leave a bruise, not a brochure.',
      thread: format === 'thread'
        ? [options?.text ?? 'Art should leave a bruise, not a brochure.', 'The cleanest idea is not always the truest one.']
        : null,
      rationale: 'Matches the artist belief system.',
      researchBasis: 'artist-truth',
      sourceIds: [],
      campaignId: options?.asset?.campaignId ?? null,
      scheduledFor,
      timingBasis: 'editorial-default',
      asset: options?.asset ? { kind: 'release-kit' as const, ...options.asset } : null,
      status: 'proposed',
    }, ...(options?.secondCandidate ? [{
      id: 'post_2',
      revision: 1,
      lane: 'worldview' as const,
      format: 'post' as const,
      text: options.secondCandidate.text,
      thread: null,
      rationale: 'Second candidate for schedule review.',
      researchBasis: 'artist-truth' as const,
      sourceIds: [],
      campaignId: null,
      scheduledFor: options.secondCandidate.scheduledFor,
      timingBasis: 'editorial-default' as const,
      asset: null,
      status: 'proposed' as const,
    }] : [])],
  }
  const manifest = createOutputBundle(workspaceRoot, {
    id: '11111111-2222-4333-8444-555555555555',
    workspaceId: workspace.id,
    title: slate.title,
    kind: 'collection',
    content: `${JSON.stringify(slate, null, 2)}\n`,
    contentMimeType: 'application/json',
    origin: { source: 'session', sessionId: 'session-x', agentSlug: 'x-editorial' },
    approval: { state: 'pending' },
    tags: ['artist-x-slate'],
  })
  return { manifest, slate }
}

function readPersistedXSlate(outputId: string): XEditorialSlate {
  const manifest = readOutputManifest(workspaceRoot, outputId)
  if (!manifest?.primary) throw new Error('X slate output is missing.')
  const path = resolveOutputAssetPath(workspaceRoot, outputId, manifest.primary.path)
  if (!path) throw new Error('X slate asset path is invalid.')
  const parsed = parseXEditorialSlate(readFileSync(path, 'utf-8'))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.slate
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
    validateSocialProfile: async () => ({ ready: true }),
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
  rmSync(workspaceRoot, { recursive: true, force: true })
  rmSync(campaignRoot, { recursive: true, force: true })
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(campaignRoot, { recursive: true })
  contextDocs = new Map()
  upsertCalls = []
  failOnSlug = null
  activeAgentSlugs = ['content-genius']
  assertTeamPermission.mockClear()
})

describe('scheduled-work RPC handler', () => {
  test('Daily X Slate approval mints exact text authorization and links HQ Calendar', async () => {
    const { manifest } = seedXEditorialSlate()
    const { invoke } = await registerServer()

    const result = await invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve',
      outputId: manifest.id,
      candidateId: 'post_1',
      expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    }) as { slate: XEditorialSlate; scheduledWorkId: string; calendarItemId: string; outputUpdatedAt: string }

    expect(result.slate.candidates[0]).toMatchObject({
      status: 'scheduled',
      scheduledWorkId: result.scheduledWorkId,
      calendarItemId: result.calendarItemId,
    })
    const order = readScheduledWork().items[0]
    expect(order).toMatchObject({
      owner: { scope: 'hq', workspaceId: workspace.id },
      status: 'needs-approval',
      execution: {
        type: 'social-publish',
        platform: 'x',
        profileId: 'artist-main',
        caption: 'Art should leave a bruise, not a brochure.',
      },
      inputRefs: [],
      authorizationPolicy: 'durable-v1',
      authorization: {
        authorizedBy: { type: 'user', clientId: 'c1', source: 'x-editorial-ui' },
        definition: {
          kind: 'x-editorial',
          xEditorialRef: { outputId: manifest.id, slateId: 'xslate_test_1', candidateId: 'post_1', revision: 1 },
        },
      },
    })
    expect(order?.authorization?.payloadDigest).toBe(order?.executionKey.payloadDigest)
    expect(readArtistCalendar().events[0]).toMatchObject({
      id: result.calendarItemId,
      scheduledWorkId: result.scheduledWorkId,
      workspaceLinks: [],
    })
    expect(readPersistedXSlate(manifest.id).candidates[0]?.status).toBe('scheduled')
    expect(readOutputManifest(workspaceRoot, manifest.id)?.approval?.state).toBe('approved')
    expect(assertTeamPermission).toHaveBeenCalledWith(workspaceRoot, 'social.publish.approve')
  })

  test('Daily X Slate approval pins exact Campaign Release Kit media in the signed authorization', async () => {
    const sourcePath = `${campaignRoot}/lyric-clip.mp4`
    writeFileSync(sourcePath, 'approved-lyric-clip')
    const promoted = materializeReleaseKitItem(campaignRoot, {
      workspaceId: campaignWorkspace.id,
      campaignId: campaignWorkspace.id,
      source: { type: 'campaign-asset', assetId: 'clip-1' },
      sourcePath,
      category: 'video',
      subtype: 'lyric-clip',
      promotedBy: 'user',
    })
    const { manifest } = seedXEditorialSlate({
      asset: {
        campaignId: campaignWorkspace.id,
        itemId: promoted.item.id,
        sha256: promoted.item.sha256,
        label: promoted.item.title,
      },
    })
    const { invoke } = await registerServer()

    const result = await invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    }) as { scheduledWorkId: string }

    const order = readScheduledWork().items.find((candidate) => candidate.id === result.scheduledWorkId)
    expect(order?.inputRefs).toEqual([{
      kind: 'release-kit', itemId: promoted.item.id, sha256: promoted.item.sha256, label: promoted.item.title,
    }])
    expect(order?.authorization?.definition).toMatchObject({
      kind: 'x-editorial',
      releaseKitRef: {
        campaignId: campaignWorkspace.id,
        itemId: promoted.item.id,
        sha256: promoted.item.sha256,
      },
    })
    expect(readArtistCalendar().events[0]?.workspaceLinks).toEqual([{
      workspaceId: campaignWorkspace.id,
      role: 'campaign-context',
      linkedAt: expect.any(String),
    }])
  })

  test('editing a scheduled X candidate cancels the old exact schedule and requires reapproval', async () => {
    const { manifest } = seedXEditorialSlate()
    const { invoke } = await registerServer()
    const approved = await invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    }) as { slate: XEditorialSlate; outputUpdatedAt: string }

    const edited = await invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'edit', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: approved.outputUpdatedAt,
      text: 'Art should leave a mark, not read like a brochure.',
      scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    }) as { slate: XEditorialSlate }

    expect(edited.slate.candidates[0]).toMatchObject({
      revision: 2,
      status: 'proposed',
      text: 'Art should leave a mark, not read like a brochure.',
    })
    expect(edited.slate.candidates[0]?.scheduledWorkId).toBeUndefined()
    expect(readScheduledWork().items[0]?.status).toBe('canceled')
    expect(readArtistCalendar().events[0]?.deletedAt).toBeTruthy()
    expect(readOutputManifest(workspaceRoot, manifest.id)?.approval?.state).toBe('pending')
  })

  test('Daily X Slate refuses native thread approval without creating schedule records', async () => {
    const { manifest } = seedXEditorialSlate({ format: 'thread' })
    const { invoke } = await registerServer()

    await expect(invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    })).rejects.toThrow(/thread/i)
    expect(readScheduledWork().items).toHaveLength(0)
    expect(readArtistCalendar().events).toHaveLength(0)
    expect(readPersistedXSlate(manifest.id).candidates[0]?.status).toBe('proposed')
  })

  test('Daily X Slate refuses an over-limit standard post before creating schedule records', async () => {
    const { manifest } = seedXEditorialSlate({ text: 'x'.repeat(281) })
    const { invoke } = await registerServer()

    await expect(invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    })).rejects.toThrow(/Shorten by 1 character/)
    expect(readScheduledWork().items).toHaveLength(0)
    expect(readArtistCalendar().events).toHaveLength(0)
  })

  test('Daily X Slate refuses a second X post in the same minute', async () => {
    const scheduledFor = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { manifest } = seedXEditorialSlate({
      scheduledFor,
      secondCandidate: { text: 'A different thought for the same minute.', scheduledFor },
    })
    const { invoke } = await registerServer()
    const first = await invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    }) as { outputUpdatedAt: string }

    await expect(invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_2', expectedRevision: 1,
      expectedOutputUpdatedAt: first.outputUpdatedAt,
    })).rejects.toThrow(/time slot/i)
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readArtistCalendar().events).toHaveLength(1)
  })

  test('Daily X Slate refuses duplicate normalized copy inside seven days', async () => {
    const firstTime = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const secondTime = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
    const { manifest } = seedXEditorialSlate({
      scheduledFor: firstTime,
      secondCandidate: { text: '  ART SHOULD LEAVE A BRUISE, NOT A BROCHURE.  ', scheduledFor: secondTime },
    })
    const { invoke } = await registerServer()
    const first = await invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_1', expectedRevision: 1,
      expectedOutputUpdatedAt: manifest.updatedAt,
    }) as { outputUpdatedAt: string }

    await expect(invoke(RPC_CHANNELS.scheduledWork.MUTATE_X_EDITORIAL_CANDIDATE, workspace.id, {
      action: 'approve', outputId: manifest.id, candidateId: 'post_2', expectedRevision: 1,
      expectedOutputUpdatedAt: first.outputUpdatedAt,
    })).rejects.toThrow(/exact X post/i)
    expect(readScheduledWork().items).toHaveLength(1)
  })

  test('authorizeReleaseKitSocial mints human-bound authorization and writes one linked calendar item', async () => {
    seedEmptyCampaignCalendar()
    const sourcePath = `${workspaceRoot}/source.png`
    writeFileSync(sourcePath, 'approved-image')
    const released = materializeReleaseKitItem(workspaceRoot, {
      workspaceId: workspace.id, campaignId: workspace.id,
      source: { type: 'upload', originalFileName: 'source.png' }, sourcePath,
      category: 'artwork', subtype: 'cover-art', title: 'Release cover', promotedBy: 'user',
    })
    const { invoke } = await registerServer()
    const startAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

    const result = await invoke(RPC_CHANNELS.scheduledWork.AUTHORIZE_RELEASE_KIT_SOCIAL, workspace.id, {
      requestId: 'release-cover-post-1', releaseKitItemId: released.item.id,
      platform: 'instagram', profileId: 'artist-main', caption: 'Out now.', startAt, timezone: 'America/Chicago',
    }) as { order: ScheduledWorkOrder; calendarItem: { scheduledWorkId?: string } }

    expect(result.order).toMatchObject({
      status: 'needs-approval', authorizationPolicy: 'durable-v1',
      inputRefs: [{ kind: 'release-kit', itemId: released.item.id, sha256: released.item.sha256 }],
      authorization: { authorizedBy: { type: 'user', clientId: 'c1', source: 'release-kit-ui' } },
    })
    expect(result.order.authorization?.payloadDigest).toBe(result.order.executionKey.payloadDigest)
    expect(result.calendarItem.scheduledWorkId).toBe(result.order.id)
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items).toHaveLength(1)
    expect(assertTeamPermission).toHaveBeenCalledWith(workspaceRoot, 'social.publish.approve')
  })

  test('authorizeReleaseKitSocial refuses a hard-restricted final', async () => {
    seedEmptyCampaignCalendar()
    const sourcePath = `${workspaceRoot}/source.png`
    writeFileSync(sourcePath, 'approved-image')
    const released = materializeReleaseKitItem(workspaceRoot, {
      workspaceId: workspace.id, campaignId: workspace.id,
      source: { type: 'upload', originalFileName: 'source.png' }, sourcePath,
      category: 'artwork', subtype: 'cover-art', promotedBy: 'user',
    })
    updateReleaseKitItemUsage(workspaceRoot, workspace.id, workspace.id, released.item.id, {
      restrictions: { needsRightsClearance: true },
    })
    const { invoke } = await registerServer()

    await expect(invoke(RPC_CHANNELS.scheduledWork.AUTHORIZE_RELEASE_KIT_SOCIAL, workspace.id, {
      requestId: 'restricted-post-1', releaseKitItemId: released.item.id,
      platform: 'instagram', profileId: 'artist-main', caption: 'Out now.',
      startAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), timezone: 'America/Chicago',
    })).rejects.toThrow(/rights clearance/i)
    expect(readScheduledWork().items).toHaveLength(0)
  })

  test('reauthorizeReleaseKitSocial reports exact changes and updates the existing linked records', async () => {
    seedEmptyCampaignCalendar()
    const sourcePath = `${workspaceRoot}/source.png`
    writeFileSync(sourcePath, 'approved-image')
    const released = materializeReleaseKitItem(workspaceRoot, {
      workspaceId: workspace.id, campaignId: workspace.id,
      source: { type: 'upload', originalFileName: 'source.png' }, sourcePath,
      category: 'artwork', subtype: 'cover-art', title: 'Release cover', promotedBy: 'user',
    })
    const alternatePath = `${workspaceRoot}/alternate.png`
    writeFileSync(alternatePath, 'approved-alternate-image')
    const alternate = materializeReleaseKitItem(workspaceRoot, {
      workspaceId: workspace.id, campaignId: workspace.id,
      source: { type: 'upload', originalFileName: 'alternate.png' }, sourcePath: alternatePath,
      category: 'images', subtype: 'social-image', title: 'Alternate image', promotedBy: 'user',
    })
    const { invoke } = await registerServer()
    const firstStart = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const created = await invoke(RPC_CHANNELS.scheduledWork.AUTHORIZE_RELEASE_KIT_SOCIAL, workspace.id, {
      requestId: 'release-cover-edit-1', releaseKitItemId: released.item.id,
      title: 'First title', platform: 'instagram', profileId: 'artist-main', caption: 'First caption',
      startAt: firstStart, timezone: 'America/Chicago',
    }) as { order: ScheduledWorkOrder; calendarItem: { id: string } }
    const secondStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const result = await invoke(RPC_CHANNELS.scheduledWork.REAUTHORIZE_RELEASE_KIT_SOCIAL, workspace.id, {
      orderId: created.order.id, calendarItemId: created.calendarItem.id, expectedUpdatedAt: created.order.updatedAt,
      releaseKitItemId: alternate.item.id, title: 'Second title', platform: 'x', profileId: 'artist-alt', accountSetId: 'social-set',
      caption: 'Second caption', platformOptions: { replyControl: 'mentioned' }, startAt: secondStart, timezone: 'UTC',
    }) as { order: ScheduledWorkOrder; changes: Array<{ field: string; before: string; after: string }> }

    expect(result.changes.map((change) => change.field)).toEqual(['title', 'asset', 'account', 'caption', 'options', 'time', 'timezone'])
    expect(result.order).toMatchObject({
      id: created.order.id, title: 'Second title', startAt: secondStart,
      execution: { type: 'social-publish', platform: 'x', profileId: 'artist-alt', caption: 'Second caption' },
      authorization: { authorizedBy: { type: 'user', source: 'calendar-ui' } },
    })
    expect(result.order.authorization?.payloadDigest).not.toBe(created.order.authorization?.payloadDigest)
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items).toHaveLength(1)
    expect(readCampaignCalendar().items[0]?.scheduledWorkId).toBe(created.order.id)
  })

  test('manual social approval rejects a durable schedule authorization', async () => {
    seedEmptyCampaignCalendar()
    const sourcePath = `${workspaceRoot}/source.png`
    writeFileSync(sourcePath, 'approved-image')
    const released = materializeReleaseKitItem(workspaceRoot, {
      workspaceId: workspace.id, campaignId: workspace.id,
      source: { type: 'upload', originalFileName: 'source.png' }, sourcePath,
      category: 'artwork', subtype: 'cover-art', promotedBy: 'user',
    })
    const { invoke } = await registerServer()
    const created = await invoke(RPC_CHANNELS.scheduledWork.AUTHORIZE_RELEASE_KIT_SOCIAL, workspace.id, {
      requestId: 'durable-manual-approval', releaseKitItemId: released.item.id,
      platform: 'instagram', profileId: 'artist-main', caption: 'Out now.',
      startAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), timezone: 'UTC',
    }) as { order: ScheduledWorkOrder; calendarItem: { id: string } }

    await expect(invoke(RPC_CHANNELS.scheduledWork.APPROVE_CAMPAIGN_SOCIAL, workspace.id, {
      orderId: created.order.id, calendarItemId: created.calendarItem.id, expectedUpdatedAt: created.order.updatedAt,
    })).rejects.toThrow(/authorized when scheduled/i)
  })

  test('mutate upserts scheduled-work and broadcasts workspace context changes', async () => {
    const { invoke, pushCalls } = await registerServer()

    const result = await invoke(RPC_CHANNELS.scheduledWork.MUTATE, workspace.id, {
      operation: 'upsert',
      order: buildOrder(),
      expectedUpdatedAt: null,
    })

    expect(result).toMatchObject({ ok: true, item: { id: 'scheduled-work-1' } })
    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, 'hq-state-of-play'])
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toMatchObject({ channel: RPC_CHANNELS.workspaceContext.CHANGED })
    expect(pushCalls[0]?.args[0]).toBe(workspace.id)
    expect((pushCalls[0]?.args[1] as LoadedContextDoc[]).map((doc) => doc.slug)).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, 'hq-state-of-play'])
    expect(assertTeamPermission).toHaveBeenCalledWith(workspaceRoot, 'files.write')

    const getResult = await invoke(RPC_CHANNELS.scheduledWork.GET, workspace.id)
    expect(getResult).toMatchObject({
      ok: true,
      work: { items: [{ id: 'scheduled-work-1', title: 'Publish teaser' }] },
    })
  })

  test('mutate rejects renderer-authored durable authorization', async () => {
    const { invoke } = await registerServer()
    const forged = {
      ...buildOrder(),
      type: 'social-publish' as const,
      execution: { type: 'social-publish' as const, platform: 'x', profileId: 'artist', caption: 'Forged.' },
      authorizationPolicy: 'durable-v1' as const,
      authorization: {
        id: 'forged', authorizedAt: new Date().toISOString(), payloadDigest: 'forged',
        authorizedBy: { type: 'user' as const, clientId: 'forged', source: 'release-kit-ui' as const },
        definition: {
          title: 'Forged', releaseKitRef: { itemId: 'kit', sha256: 'a'.repeat(64) },
          platform: 'x', profileId: 'artist', caption: 'Forged.', startAt: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC',
        },
      },
    }

    await expect(invoke(RPC_CHANNELS.scheduledWork.MUTATE, workspace.id, {
      operation: 'upsert', order: forged, expectedUpdatedAt: null,
    })).rejects.toThrow(/only be minted by the host/i)
    expect(contextDocs.has(SCHEDULED_WORK_CONTEXT_SLUG)).toBe(false)
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
    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, CAMPAIGN_CALENDAR_CONTEXT_SLUG, 'hq-state-of-play'])
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
    expect(assertTeamPermission).toHaveBeenCalledWith(workspaceRoot, 'social.publish.approve')
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
    expect(upsertCalls).toEqual([CAMPAIGN_CALENDAR_CONTEXT_SLUG, 'hq-state-of-play'])
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
    expect(upsertCalls).toEqual([CAMPAIGN_CALENDAR_CONTEXT_SLUG, 'hq-state-of-play'])
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
    expect(upsertCalls).toEqual([SCHEDULED_WORK_CONTEXT_SLUG, CAMPAIGN_CALENDAR_CONTEXT_SLUG, 'hq-state-of-play'])
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
    expect(upsertCalls).toEqual([CAMPAIGN_CALENDAR_CONTEXT_SLUG, 'hq-state-of-play'])
    expect(pushCalls).toHaveLength(1)
    expect(readScheduledWork().items).toHaveLength(1)
    expect(readCampaignCalendar().items[0]?.scheduledWorkId).toBe(readScheduledWork().items[0]?.id)
    expect(readCampaignCalendar().items[0]?.job?.id).toBeTruthy()
  })
})
